import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { decryptSecret, encryptSecret, maskKey, randomId, sha256, timingSafeEqualStr } from "../crypto.js";
import { DEFAULT_SETTINGS, getSettings, setSettings } from "../db.js";
import { effectiveStatus, getHealth } from "../health.js";
import { PROVIDER_TYPES, getAdapter } from "../adapters/registry.js";
import {
  errorStatus,
  sendWithFailover,
  streamWithFailover,
  type Attempt,
  type MakeRequestOptions,
  type StreamOutcome,
} from "../router.js";
import { appendAssistantMessage, resolveConversation } from "../context.js";
import { estimateUsage, promptChars, recordRequest } from "../usage.js";
import { writeWithBackpressure } from "../sse.js";
import type { ProviderRow } from "../router.js";
import type { ProviderStatus } from "../status.js";
import type { CanonicalMessage, CanonicalRequest, ProviderType, ResolvedProvider, Usage } from "../types.js";

interface ProviderOut {
  id: number;
  model_id: number;
  model_name: string;
  name: string;
  type: ProviderType;
  base_url: string;
  upstream_model: string;
  priority: number;
  enabled: number;
  status: ProviderStatus;
  last_error: string | null;
  cooldown_until: number | null;
  api_key_masked: string;
  requests: number;
  failures: number;
}

function badRequest(reply: FastifyReply, message: string) {
  return reply.code(400).send({ error: message });
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", async (request, reply) => {
    const header = request.headers["x-admin-password"];
    const provided = typeof header === "string" ? header : "";
    if (!provided || !timingSafeEqualStr(provided, config.adminPassword)) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  function modelById(id: number) {
    return app.db.prepare("SELECT * FROM models WHERE id = ?").get(id) as
      | { id: number; name: string; input_cost: number; output_cost: number; created_at: number }
      | undefined;
  }

  function aliasesOf(modelId: number): string[] {
    return (
      app.db.prepare("SELECT alias FROM aliases WHERE model_id = ? ORDER BY alias").all(modelId) as {
        alias: string;
      }[]
    ).map((a) => a.alias);
  }

  function providerOut(row: ProviderRow): ProviderOut {
    const health = getHealth(app.db, row.id);
    let masked = "";
    try {
      masked = maskKey(decryptSecret(row.api_key_enc));
    } catch {
      masked = "••••••••";
    }
    const model = modelById(row.model_id);
    return {
      id: row.id,
      model_id: row.model_id,
      model_name: model?.name ?? "",
      name: row.name,
      type: row.type,
      base_url: row.base_url,
      upstream_model: row.upstream_model,
      priority: row.priority,
      enabled: row.enabled,
      status: effectiveStatus(row.enabled, health),
      last_error: health.last_error,
      cooldown_until: health.cooldown_until,
      api_key_masked: masked,
      requests: health.requests,
      failures: health.failures,
    };
  }

  function providersOf(modelId: number): ProviderOut[] {
    const rows = app.db
      .prepare("SELECT * FROM providers WHERE model_id = ? ORDER BY priority ASC, id ASC")
      .all(modelId) as ProviderRow[];
    return rows.map(providerOut);
  }

  function modelOut(m: { id: number; name: string; input_cost: number; output_cost: number }) {
    const providers = providersOf(m.id);
    const active = providers.filter((p) => p.enabled);
    const healthy = active.filter((p) => p.status === "online" || p.status === "rate_limited");
    return {
      id: m.id,
      name: m.name,
      input_cost: m.input_cost,
      output_cost: m.output_cost,
      aliases: aliasesOf(m.id),
      providers,
      provider_count: providers.length,
      healthy_count: healthy.length,
    };
  }

  function allModels() {
    return (app.db.prepare("SELECT * FROM models ORDER BY name").all() as any[]).map(modelOut);
  }

  function parseLog(row: any) {
    return {
      request_id: row.request_id,
      conversation_id: row.conversation_id,
      model: row.model,
      provider_name: row.provider_name,
      status: row.status,
      ok: row.ok,
      streaming: row.streaming,
      duration_ms: row.duration_ms,
      tokens_in: row.tokens_in,
      tokens_out: row.tokens_out,
      cost: row.cost,
      error: row.error,
      failover: row.failover ? JSON.parse(row.failover) : null,
      created_at: row.created_at,
    };
  }

  function resolvedFromInput(input: any): ResolvedProvider {
    return {
      id: 0,
      name: input.name ?? "test",
      type: input.type,
      base_url: String(input.base_url ?? "").trim(),
      api_key: String(input.api_key ?? ""),
      upstream_model: String(input.upstream_model ?? "").trim(),
    };
  }

  // ---------- Overview ----------

  app.get("/admin/api/overview", async (_request, reply) => {
    const models = allModels();
    const enabledProviders = app.db
      .prepare("SELECT COUNT(*) AS c FROM providers WHERE enabled = 1")
      .get() as { c: number };
    const recent = (
      app.db.prepare("SELECT * FROM requests ORDER BY created_at DESC LIMIT 12").all() as any[]
    ).map(parseLog);
    const errors = (
      app.db
        .prepare("SELECT * FROM requests WHERE ok = 0 ORDER BY created_at DESC LIMIT 5")
        .all() as any[]
    ).map(parseLog);
    const keys = app.db
      .prepare("SELECT COUNT(*) AS c FROM api_keys WHERE revoked = 0")
      .get() as { c: number };
    return reply.send({
      status: enabledProviders.c > 0 ? "operational" : "no_providers",
      models,
      recent,
      errors,
      has_api_key: keys.c > 0,
    });
  });

  // ---------- Models ----------

  app.get("/admin/api/models", async (_request, reply) => reply.send({ models: allModels() }));

  app.post("/admin/api/models", async (request, reply) => {
    const body = request.body as any;
    const name = String(body?.name ?? "").trim();
    if (!name) return badRequest(reply, "Model name is required");
    const exists = app.db.prepare("SELECT id FROM models WHERE name = ?").get(name);
    if (exists) return badRequest(reply, `Model "${name}" already exists`);
    const info = app.db
      .prepare("INSERT INTO models (name, input_cost, output_cost, created_at) VALUES (?, ?, ?, ?)")
      .run(name, Number(body.input_cost ?? 0) || 0, Number(body.output_cost ?? 0) || 0, Date.now());
    const modelId = Number(info.lastInsertRowid);
    for (const alias of (body.aliases ?? []) as string[]) {
      const a = String(alias).trim();
      if (a) {
        app.db
          .prepare("INSERT OR REPLACE INTO aliases (alias, model_id) VALUES (?, ?)")
          .run(a, modelId);
      }
    }
    return reply.code(201).send({ model: modelOut(modelById(modelId)!) });
  });

  app.patch<{ Params: { id: string } }>("/admin/api/models/:id", async (request, reply) => {
    const model = modelById(Number(request.params.id));
    if (!model) return reply.code(404).send({ error: "Model not found" });
    const body = request.body as any;
    app.db
      .prepare("UPDATE models SET name = ?, input_cost = ?, output_cost = ? WHERE id = ?")
      .run(
        body?.name !== undefined ? String(body.name).trim() || model.name : model.name,
        body?.input_cost !== undefined ? Number(body.input_cost) || 0 : model.input_cost,
        body?.output_cost !== undefined ? Number(body.output_cost) || 0 : model.output_cost,
        model.id
      );
    return reply.send({ model: modelOut(modelById(model.id)!) });
  });

  app.delete<{ Params: { id: string } }>("/admin/api/models/:id", async (request, reply) => {
    app.db.prepare("DELETE FROM models WHERE id = ?").run(Number(request.params.id));
    return reply.send({ ok: true });
  });

  app.post<{ Params: { id: string } }>("/admin/api/models/:id/aliases", async (request, reply) => {
    const model = modelById(Number(request.params.id));
    if (!model) return reply.code(404).send({ error: "Model not found" });
    const alias = String((request.body as any)?.alias ?? "").trim();
    if (!alias) return badRequest(reply, "Alias is required");
    const taken = app.db.prepare("SELECT model_id FROM aliases WHERE alias = ?").get(alias);
    if (taken) return badRequest(reply, `Alias "${alias}" already exists`);
    app.db.prepare("INSERT INTO aliases (alias, model_id) VALUES (?, ?)").run(alias, model.id);
    return reply.send({ ok: true });
  });

  app.delete<{ Params: { alias: string } }>("/admin/api/aliases/:alias", async (request, reply) => {
    app.db.prepare("DELETE FROM aliases WHERE alias = ?").run(request.params.alias);
    return reply.send({ ok: true });
  });

  // ---------- Providers ----------

  app.get("/admin/api/providers", async (_request, reply) => {
    const rows = app.db.prepare("SELECT * FROM providers ORDER BY priority ASC, id ASC").all() as ProviderRow[];
    return reply.send({ providers: rows.map(providerOut) });
  });

  app.post("/admin/api/providers", async (request, reply) => {
    const body = request.body as any;
    const modelId = Number(body?.model_id);
    const name = String(body?.name ?? "").trim();
    const type = String(body?.type ?? "");
    const baseUrl = String(body?.base_url ?? "").trim();
    const apiKey = String(body?.api_key ?? "");
    const upstreamModel = String(body?.upstream_model ?? "").trim();

    if (!modelById(modelId)) return badRequest(reply, "Valid model_id is required");
    if (!name) return badRequest(reply, "Provider name is required");
    if (!PROVIDER_TYPES.includes(type as ProviderType))
      return badRequest(reply, `Provider type must be one of: ${PROVIDER_TYPES.join(", ")}`);
    if (!baseUrl) return badRequest(reply, "Base URL is required");
    if (!apiKey) return badRequest(reply, "API key is required");
    if (!upstreamModel) return badRequest(reply, "Upstream model is required");

    const info = app.db
      .prepare(
        `INSERT INTO providers (model_id, name, type, base_url, api_key_enc, upstream_model, priority, enabled, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        modelId,
        name,
        type,
        baseUrl,
        encryptSecret(apiKey),
        upstreamModel,
        Number(body?.priority) || 100,
        body?.enabled === 0 || body?.enabled === false ? 0 : 1,
        Date.now()
      );
    const id = Number(info.lastInsertRowid);
    app.db
      .prepare("INSERT INTO provider_health (provider_id) VALUES (?) ON CONFLICT(provider_id) DO NOTHING")
      .run(id);
    return reply.code(201).send({ provider: providerOut(app.db.prepare("SELECT * FROM providers WHERE id = ?").get(id) as ProviderRow) });
  });

  app.patch<{ Params: { id: string } }>("/admin/api/providers/:id", async (request, reply) => {
    const row = app.db.prepare("SELECT * FROM providers WHERE id = ?").get(Number(request.params.id)) as
      | ProviderRow
      | undefined;
    if (!row) return reply.code(404).send({ error: "Provider not found" });
    const body = request.body as any;
    const next = {
      name: body?.name !== undefined ? String(body.name).trim() || row.name : row.name,
      type: body?.type !== undefined && PROVIDER_TYPES.includes(body.type) ? body.type : row.type,
      base_url: body?.base_url !== undefined ? String(body.base_url).trim() || row.base_url : row.base_url,
      upstream_model:
        body?.upstream_model !== undefined ? String(body.upstream_model).trim() || row.upstream_model : row.upstream_model,
      priority: body?.priority !== undefined ? Number(body.priority) || 0 : row.priority,
      enabled: body?.enabled !== undefined ? (body.enabled ? 1 : 0) : row.enabled,
      model_id: body?.model_id !== undefined && modelById(Number(body.model_id)) ? Number(body.model_id) : row.model_id,
    };
    app.db
      .prepare(
        `UPDATE providers SET name = ?, type = ?, base_url = ?, upstream_model = ?, priority = ?, enabled = ?, model_id = ?
         WHERE id = ?`
      )
      .run(next.name, next.type, next.base_url, next.upstream_model, next.priority, next.enabled, next.model_id, row.id);
    if (body?.api_key !== undefined && String(body.api_key).trim()) {
      app.db.prepare("UPDATE providers SET api_key_enc = ? WHERE id = ?").run(encryptSecret(String(body.api_key)), row.id);
    }
    if (next.enabled && !row.enabled) {
      app.db.prepare("UPDATE provider_health SET cooldown_until = NULL WHERE provider_id = ?").run(row.id);
    }
    const updated = app.db.prepare("SELECT * FROM providers WHERE id = ?").get(row.id) as ProviderRow;
    return reply.send({ provider: providerOut(updated) });
  });

  app.delete<{ Params: { id: string } }>("/admin/api/providers/:id", async (request, reply) => {
    app.db.prepare("DELETE FROM providers WHERE id = ?").run(Number(request.params.id));
    return reply.send({ ok: true });
  });

  async function runTest(input: any) {
    const provider = resolvedFromInput(input);
    if (!provider.base_url || !provider.api_key || !provider.upstream_model || !PROVIDER_TYPES.includes(provider.type)) {
      return { ok: false, error: "type, base_url, api_key and upstream_model are required" };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const result = await getAdapter(provider.type).test(provider, controller.signal);
      return result;
    } finally {
      clearTimeout(timer);
    }
  }

  app.post<{ Params: { id: string } }>("/admin/api/providers/:id/test", async (request, reply) => {
    const row = app.db.prepare("SELECT * FROM providers WHERE id = ?").get(Number(request.params.id)) as
      | ProviderRow
      | undefined;
    if (!row) return reply.code(404).send({ error: "Provider not found" });
    let apiKey = "";
    try {
      apiKey = decryptSecret(row.api_key_enc);
    } catch {
      return reply.send({ ok: false, error: "Unable to decrypt stored API key" });
    }
    return reply.send(
      await runTest({
        type: row.type,
        base_url: row.base_url,
        api_key: apiKey,
        upstream_model: row.upstream_model,
      })
    );
  });

  app.post("/admin/api/providers/test", async (request, reply) => reply.send(await runTest(request.body)));

  // ---------- Fetch available models from an upstream ----------

  async function runFetchModels(input: any): Promise<{ models: string[]; error?: string }> {
    const provider = resolvedFromInput(input);
    if (!provider.base_url || !provider.api_key || !PROVIDER_TYPES.includes(provider.type)) {
      return { models: [], error: "type, base_url и api_key обязательны" };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const models = await getAdapter(provider.type).listModels(provider, controller.signal);
      return { models };
    } catch (err) {
      return { models: [], error: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timer);
    }
  }

  app.post("/admin/api/providers/fetch-models", async (request, reply) =>
    reply.send(await runFetchModels(request.body))
  );

  app.post<{ Params: { id: string } }>("/admin/api/providers/:id/fetch-models", async (request, reply) => {
    const row = app.db.prepare("SELECT * FROM providers WHERE id = ?").get(Number(request.params.id)) as
      | ProviderRow
      | undefined;
    if (!row) return reply.code(404).send({ error: "Provider not found" });
    let apiKey = "";
    try {
      apiKey = decryptSecret(row.api_key_enc);
    } catch {
      return reply.send({ models: [], error: "Не удалось расшифровать сохранённый API-ключ" });
    }
    return reply.send(
      await runFetchModels({
        type: row.type,
        base_url: row.base_url,
        api_key: apiKey,
        upstream_model: row.upstream_model,
      })
    );
  });

  // ---------- Router API keys ----------

  app.get("/admin/api/keys", async (_request, reply) => {
    const keys = app.db
      .prepare("SELECT id, name, prefix, created_at, last_used_at, revoked FROM api_keys ORDER BY created_at DESC")
      .all();
    return reply.send({ keys });
  });

  app.post("/admin/api/keys", async (request, reply) => {
    const name = String((request.body as any)?.name ?? "").trim() || "Default";
    const key = `rk_live_${randomId(24)}`;
    const info = app.db
      .prepare("INSERT INTO api_keys (name, prefix, hash, created_at) VALUES (?, ?, ?, ?)")
      .run(name, key.slice(0, 12), sha256(key), Date.now());
    const record = app.db
      .prepare("SELECT id, name, prefix, created_at, last_used_at, revoked FROM api_keys WHERE id = ?")
      .get(Number(info.lastInsertRowid));
    return reply.code(201).send({ key, record });
  });

  app.delete<{ Params: { id: string } }>("/admin/api/keys/:id", async (request, reply) => {
    app.db.prepare("UPDATE api_keys SET revoked = 1 WHERE id = ?").run(Number(request.params.id));
    return reply.send({ ok: true });
  });

  // ---------- Settings ----------

  app.get("/admin/api/settings", async (_request, reply) => reply.send({ settings: getSettings(app.db) }));

  app.put("/admin/api/settings", async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const allowed = new Set([
      "routing_strategy",
      "retry_count",
      "timeout_ms",
      "cooldown_429_ms",
      "cooldown_5xx_ms",
      "cooldown_timeout_ms",
      "cooldown_auth_ms",
      "rate_limit_rpm",
      "health_check_interval_ms",
      "default_model",
    ]);
    if (
      body.routing_strategy !== undefined &&
      !["round_robin", "priority", "least_used"].includes(String(body.routing_strategy))
    ) {
      return badRequest(reply, "routing_strategy must be round_robin, priority or least_used");
    }
    const values: Record<string, string> = {};
    for (const [k, v] of Object.entries(body)) {
      if (allowed.has(k) && v !== undefined && v !== null) values[k] = String(v);
    }
    setSettings(app.db, values);
    return reply.send({ settings: getSettings(app.db) });
  });

  // ---------- Logs ----------

  app.get<{ Querystring: { limit?: string; offset?: string; q?: string } }>(
    "/admin/api/logs",
    async (request, reply) => {
      const limit = Math.min(500, Math.max(1, Number(request.query.limit ?? 100) || 100));
      const offset = Math.max(0, Number(request.query.offset ?? 0) || 0);
      const q = (request.query.q ?? "").trim();
      let rows: any[];
      if (q) {
        const like = `%${q}%`;
        rows = app.db
          .prepare(
            `SELECT * FROM requests
             WHERE model LIKE ? OR provider_name LIKE ? OR error LIKE ? OR request_id LIKE ?
             ORDER BY created_at DESC LIMIT ? OFFSET ?`
          )
          .all(like, like, like, like, limit, offset) as any[];
      } else {
        rows = app.db
          .prepare("SELECT * FROM requests ORDER BY created_at DESC LIMIT ? OFFSET ?")
          .all(limit, offset) as any[];
      }
      return reply.send({ logs: rows.map(parseLog) });
    }
  );

  // ---------- Usage stats ----------

  app.get<{ Querystring: { range?: string } }>("/admin/api/stats", async (request, reply) => {
    const range = request.query.range ?? "today";
    const now = new Date();
    let since: number;
    if (range === "7d") since = now.getTime() - 7 * 86400_000;
    else if (range === "30d") since = now.getTime() - 30 * 86400_000;
    else since = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    const totals = app.db
      .prepare(
        `SELECT COUNT(*) AS requests,
                COALESCE(SUM(ok), 0) AS successful,
                COALESCE(SUM(tokens_in), 0) AS tokens_in,
                COALESCE(SUM(tokens_out), 0) AS tokens_out,
                COALESCE(SUM(cost), 0) AS cost
         FROM requests WHERE created_at >= ?`
      )
      .get(since) as any;

    const providers = app.db
      .prepare(
        `SELECT provider_id,
                COALESCE(MAX(provider_name), 'unknown') AS provider_name,
                COUNT(*) AS requests,
                COALESCE(SUM(ok), 0) AS successful,
                COALESCE(SUM(tokens_in), 0) AS tokens_in,
                COALESCE(SUM(tokens_out), 0) AS tokens_out,
                COALESCE(SUM(cost), 0) AS cost
         FROM requests WHERE created_at >= ? AND provider_id IS NOT NULL
         GROUP BY provider_id ORDER BY requests DESC`
      )
      .all(since) as any[];

    const requests = totals.requests ?? 0;
    const successful = totals.successful ?? 0;
    return reply.send({
      stats: {
        range,
        requests,
        successful,
        failed: requests - successful,
        tokens_in: totals.tokens_in ?? 0,
        tokens_out: totals.tokens_out ?? 0,
        cost: totals.cost ?? 0,
        providers: providers.map((p) => ({
          provider_id: p.provider_id,
          provider_name: p.provider_name,
          requests: p.requests,
          successful: p.successful,
          failed: p.requests - p.successful,
          tokens_in: p.tokens_in,
          tokens_out: p.tokens_out,
          cost: p.cost,
        })),
      },
    });
  });

  // ---------- Daily activity (GitHub-style calendar) ----------

  app.get<{ Querystring: { days?: string } }>("/admin/api/activity", async (request, reply) => {
    const days = Math.min(366, Math.max(7, Number(request.query.days ?? 120) || 120));
    const now = new Date();
    const since = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - (days - 1) * 86400_000;

    const rows = app.db
      .prepare(
        `SELECT date(created_at / 1000, 'unixepoch', 'localtime') AS date,
                COUNT(*) AS requests,
                COALESCE(SUM(ok), 0) AS successful,
                COALESCE(SUM(tokens_in), 0) AS tokens_in,
                COALESCE(SUM(tokens_out), 0) AS tokens_out,
                COALESCE(SUM(cost), 0) AS cost
         FROM requests WHERE created_at >= ?
         GROUP BY date ORDER BY date ASC`
      )
      .all(since) as {
      date: string;
      requests: number;
      successful: number;
      tokens_in: number;
      tokens_out: number;
      cost: number;
    }[];

    const byDate = new Map(rows.map((r) => [r.date, r]));
    const dayList: {
      date: string;
      requests: number;
      successful: number;
      tokens_in: number;
      tokens_out: number;
      tokens: number;
      cost: number;
    }[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(since + i * 86400_000);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
      ).padStart(2, "0")}`;
      const row = byDate.get(iso);
      const tokens = row ? row.tokens_in + row.tokens_out : 0;
      dayList.push({
        date: iso,
        requests: row?.requests ?? 0,
        successful: row?.successful ?? 0,
        tokens_in: row?.tokens_in ?? 0,
        tokens_out: row?.tokens_out ?? 0,
        tokens,
        cost: row?.cost ?? 0,
      });
    }

    const totals = dayList.reduce(
      (acc, d) => ({
        requests: acc.requests + d.requests,
        successful: acc.successful + d.successful,
        tokens_in: acc.tokens_in + d.tokens_in,
        tokens_out: acc.tokens_out + d.tokens_out,
        tokens: acc.tokens + d.tokens,
        cost: acc.cost + d.cost,
        active_days: acc.active_days + (d.requests > 0 ? 1 : 0),
        max_tokens: Math.max(acc.max_tokens, d.tokens),
      }),
      { requests: 0, successful: 0, tokens_in: 0, tokens_out: 0, tokens: 0, cost: 0, active_days: 0, max_tokens: 0 }
    );
    totals.cost = Number(totals.cost.toFixed(6));

    return reply.send({ days: dayList, totals });
  });

  // ---------- Config export / import (no secrets) ----------

  app.get("/admin/api/export", async (_request, reply) => {
    const models = (app.db.prepare("SELECT * FROM models ORDER BY name").all() as any[]).map((m) => ({
      name: m.name,
      input_cost: m.input_cost,
      output_cost: m.output_cost,
      aliases: aliasesOf(m.id),
      providers: (
        app.db
          .prepare("SELECT * FROM providers WHERE model_id = ? ORDER BY priority ASC, id ASC")
          .all(m.id) as ProviderRow[]
      ).map((p) => ({
        name: p.name,
        type: p.type,
        base_url: p.base_url,
        upstream_model: p.upstream_model,
        priority: p.priority,
        enabled: p.enabled,
      })),
    }));
    return reply.send({
      version: 1,
      exported_at: Date.now(),
      settings: getSettings(app.db),
      models,
    });
  });

  app.post("/admin/api/import", async (request, reply) => {
    const body = (request.body ?? {}) as any;
    const mode = body.mode === "replace" ? "replace" : "merge";
    const data = body.data;
    if (!data || typeof data !== "object" || !Array.isArray(data.models)) {
      return badRequest(reply, "data.models must be an array");
    }

    const errors: string[] = [];
    const counters = { models: 0, providers: 0 };
    const seen = new Set<string>();

    const insertModel = app.db.prepare(
      "INSERT INTO models (name, input_cost, output_cost, created_at) VALUES (?, ?, ?, ?)"
    );
    const insertAlias = app.db.prepare(
      "INSERT OR REPLACE INTO aliases (alias, model_id) VALUES (?, ?)"
    );
    const insertProvider = app.db.prepare(
      `INSERT INTO providers (model_id, name, type, base_url, api_key_enc, upstream_model, priority, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const modelExists = app.db.prepare("SELECT id FROM models WHERE name = ?");
    const providerExists = app.db.prepare("SELECT id FROM providers WHERE model_id = ? AND name = ?");

    const applyImport = app.db.transaction(() => {
      if (mode === "replace") {
        app.db.prepare("DELETE FROM models").run(); // cascades aliases + providers
      }

      for (const raw of data.models as any[]) {
        const name = String(raw?.name ?? "").trim();
        if (!name) {
          errors.push("Пропущена модель без имени");
          continue;
        }
        if (seen.has(name)) {
          errors.push(`Модель "${name}" встречается дважды — пропущена`);
          continue;
        }
        seen.add(name);

        const existing = mode === "merge" ? modelExists.get(name) : undefined;
        if (existing) {
          errors.push(`Модель "${name}" уже существует — пропущена`);
          continue;
        }

        const info = insertModel.run(
          name,
          Number(raw?.input_cost ?? 0) || 0,
          Number(raw?.output_cost ?? 0) || 0,
          Date.now()
        );
        const modelId = Number(info.lastInsertRowid);
        counters.models += 1;

        for (const alias of (raw?.aliases ?? []) as unknown[]) {
          const a = String(alias ?? "").trim();
          if (a) insertAlias.run(a, modelId);
        }

        for (const p of (raw?.providers ?? []) as any[]) {
          const pName = String(p?.name ?? "").trim();
          const type = String(p?.type ?? "");
          const baseUrl = String(p?.base_url ?? "").trim();
          if (!pName || !PROVIDER_TYPES.includes(type as ProviderType) || !baseUrl) {
            errors.push(`Провайдер "${pName || "?"}" модели "${name}" некорректен — пропущен`);
            continue;
          }
          if (mode === "merge" && providerExists.get(modelId, pName)) {
            errors.push(`Провайдер "${pName}" модели "${name}" уже существует — пропущен`);
            continue;
          }
          // secrets are never exported: imported providers start with an empty key
          insertProvider.run(
            modelId,
            pName,
            type,
            baseUrl,
            encryptSecret(""),
            String(p?.upstream_model ?? "").trim(),
            Number(p?.priority ?? 100) || 100,
            p?.enabled === 0 ? 0 : 1,
            Date.now()
          );
          counters.providers += 1;
        }
      }

      if (data.settings && typeof data.settings === "object" && !Array.isArray(data.settings)) {
        const values: Record<string, string> = {};
        for (const [k, v] of Object.entries(data.settings as Record<string, unknown>)) {
          if (k in DEFAULT_SETTINGS && v !== undefined && v !== null) values[k] = String(v);
        }
        setSettings(app.db, values);
      }
    });

    try {
      applyImport();
    } catch (err) {
      return reply
        .code(400)
        .send({ error: err instanceof Error ? err.message : "Import failed" });
    }

    return reply.send({ ok: true, imported: counters, errors });
  });

  // ---------- Playground (chat against the router without a router API key) ----------

  // same "strict provider" parameter set as /v1 — dropped on a 400/422 retry
  const PLAYGROUND_DEGRADE_PARAMS = new Set([
    "response_format",
    "stream_options",
    "frequency_penalty",
    "presence_penalty",
    "seed",
    "logit_bias",
    "logprobs",
    "top_logprobs",
    "parallel_tool_calls",
    "n",
    "user",
  ]);

  app.post("/admin/api/playground", async (request, reply) => {
    const body = (request.body ?? {}) as any;
    const requested = String(body?.model ?? "").trim();
    if (!requested) return badRequest(reply, "model is required");

    const alias = app.db.prepare("SELECT model_id FROM aliases WHERE alias = ?").get(requested) as
      | { model_id: number }
      | undefined;
    const modelRow = alias
      ? (app.db.prepare("SELECT name FROM models WHERE id = ?").get(alias.model_id) as
          | { name: string }
          | undefined)
      : (app.db.prepare("SELECT name FROM models WHERE name = ?").get(requested) as
          | { name: string }
          | undefined);
    if (!modelRow) {
      return reply.code(404).send({ error: `Model '${requested}' does not exist` });
    }
    const modelName = modelRow.name;

    const messages = body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return badRequest(reply, "'messages' must be a non-empty array");
    }
    for (const m of messages) {
      if (!m || typeof m !== "object" || typeof m.role !== "string") {
        return badRequest(reply, "Each message must have a 'role'");
      }
    }

    const stream = body?.stream === true;
    const requestId = randomId(12);
    const conversation = resolveConversation(app.db, {
      model: modelName,
      messages: messages as CanonicalMessage[],
    });

    const { model: _m, messages: _msg, stream: _s, conversation_id: _c, ...rest } = body ?? {};
    const makeRequest = (
      provider: ResolvedProvider,
      opts?: MakeRequestOptions
    ): CanonicalRequest => {
      const base = opts?.degraded
        ? Object.fromEntries(Object.entries(rest as Record<string, unknown>).filter(([k]) => !PLAYGROUND_DEGRADE_PARAMS.has(k)))
        : rest;
      return {
        ...(base as Record<string, unknown>),
        model: provider.upstream_model,
        messages: conversation.messages,
        stream,
      };
    };

    const controller = new AbortController();
    const onClose = () => {
      if (!reply.raw.writableEnded) controller.abort();
    };
    reply.raw.on("close", onClose);
    const started = Date.now();

    let attempts: Attempt[] = [];
    let write: ((payload: string) => Promise<boolean>) | null = null;

    const metaOf = (
      providerName: string,
      providerId: number | null,
      attempts: Attempt[],
      usage: Usage | null
    ) => ({
      provider_name: providerName,
      provider_id: providerId,
      attempts,
      duration_ms: Date.now() - started,
      usage,
      conversation_id: conversation.id,
    });

    try {
      if (!stream) {
        const outcome = await sendWithFailover(app.db, modelName, makeRequest, controller.signal);
        const content = outcome.response.choices?.[0]?.message?.content ?? "";
        const usage =
          (outcome.response.usage as Usage | undefined) ??
          estimateUsage(promptChars(conversation.messages), String(content ?? "").length);
        appendAssistantMessage(app.db, conversation.id, content);
        recordRequest(app.db, {
          request_id: requestId,
          conversation_id: conversation.id,
          model: modelName,
          provider_id: outcome.provider.row.id,
          provider_name: outcome.provider.row.name,
          status: 200,
          ok: true,
          streaming: false,
          duration_ms: outcome.durationMs,
          usage,
          attempts: outcome.attempts,
        });
        return reply.send({
          ...outcome.response,
          model: modelName,
          __mixroute_meta: metaOf(outcome.provider.row.name, outcome.provider.row.id, outcome.attempts, usage),
        });
      }

      // ---- streaming ----
      const gen = streamWithFailover(app.db, modelName, makeRequest, controller.signal);
      let headersSent = false;
      let partial = "";
      let meta: StreamOutcome | undefined;
      let usageForwarded = false;
      let clientGone = false;

      write = async (payload: string): Promise<boolean> => {
        if (!headersSent) {
          reply.raw.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          });
          headersSent = true;
        }
        if ((await writeWithBackpressure(reply.raw, payload)) === "closed") {
          clientGone = true;
          return false;
        }
        return true;
      };

      while (true) {
        const next = await gen.next();
        if (next.done) {
          meta = next.value;
          break;
        }
        attempts = next.value.attempts;
        const choice = next.value.chunk.choices?.[0];
        if (choice?.delta?.content) partial += choice.delta.content;
        if (next.value.chunk.usage) usageForwarded = true;
        if (!(await write(`data: ${JSON.stringify(next.value.chunk)}\n\n`))) break;
      }

      if (clientGone) {
        await gen.return(undefined as unknown as StreamOutcome);
        return reply;
      }

      const content = meta?.content ?? partial;
      const usage =
        (meta?.usage as Usage | undefined) ??
        estimateUsage(promptChars(conversation.messages), content.length);
      if (meta && meta.usage && !usageForwarded) {
        await write(
          `data: ${JSON.stringify({
            id: `chatcmpl-${requestId}`,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: modelName,
            choices: [],
            usage: meta.usage,
          })}\n\n`
        );
      }
      await write(
        `data: ${JSON.stringify({
          id: `chatcmpl-${requestId}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: modelName,
          __mixroute_meta: metaOf(
            meta?.provider.row.name ?? "?",
            meta?.provider.row.id ?? null,
            meta?.attempts ?? attempts,
            usage
          ),
        })}\n\n`
      );
      await write("data: [DONE]\n\n");
      reply.raw.end();

      appendAssistantMessage(app.db, conversation.id, content);
      recordRequest(app.db, {
        request_id: requestId,
        conversation_id: conversation.id,
        model: modelName,
        provider_id: meta?.provider.row.id ?? null,
        provider_name: meta?.provider.row.name ?? null,
        status: 200,
        ok: true,
        streaming: true,
        duration_ms: Date.now() - started,
        usage,
        attempts: meta?.attempts ?? [],
      });
      return reply;
    } catch (err) {
      const status = errorStatus(err);
      const message = err instanceof Error ? err.message : String(err);
      if (status === 499) {
        // client disconnected — no penalty, nothing to record
        if (reply.raw.headersSent) reply.raw.end();
        return reply;
      }
      recordRequest(app.db, {
        request_id: requestId,
        conversation_id: conversation.id,
        model: modelName,
        provider_id: null,
        provider_name: attemptsName(attempts),
        status,
        ok: false,
        streaming: stream,
        duration_ms: Date.now() - started,
        usage: null,
        error: message,
        attempts,
      });
      request.log.error({ err }, "playground request failed");
      if (!reply.raw.headersSent) {
        return reply.code(status).send({ error: { message, type: "api_error" } });
      }
      await writeWithBackpressure(reply.raw, `\n\n: mixroute error — ${message.replace(/[\r\n]+/g, " ")}\n\n`);
      reply.raw.end();
      return reply;
    } finally {
      reply.raw.off("close", onClose);
    }
  });

  function attemptsName(attempts: Attempt[]): string | null {
    return attempts.length ? attempts[attempts.length - 1].provider : null;
  }
}
