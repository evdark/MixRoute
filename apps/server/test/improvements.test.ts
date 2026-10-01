import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { makeApp, seedModel, seedProvider, createApiKey, ADMIN_HEADERS, type TestContext } from "./setup.js";
import { startMockUpstream, sleep, type MockUpstream } from "./helpers.js";
import { runHealthChecks } from "../src/healthcheck.js";
import { decryptSecret } from "../src/crypto.js";

describe("improvements: probe, degrade, health, config io, playground", () => {
  let ctx: TestContext;
  let mock: MockUpstream;
  let key: string;

  beforeAll(async () => {
    ctx = await makeApp();
    mock = await startMockUpstream({
      // first call 429 (simulates an outage), afterwards recovered
      flaky: (() => {
        let calls = 0;
        return () => {
          calls += 1;
          return calls === 1 ? { status: 429 } : { content: "recovered" };
        };
      })(),
      probeA: () => ({ content: "from-probeA", delayMs: 150 }), // slow: holds the probe claim
      probeB: () => ({ content: "from-probeB" }),
      degraded: (body) =>
        body.response_format ? { status: 400 } : { content: "degraded-ok" },
      ov429: () => ({ status: 429 }),
      pg: () => ({ content: "playground says hi" }),
    });
    key = createApiKey(ctx.db, "improvements");
  });

  afterAll(async () => {
    await mock.close();
    await ctx.close();
  });

  function chat(body: Record<string, unknown>, headers: Record<string, string> = {}) {
    return ctx.app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...headers },
      payload: body as any,
    });
  }

  function countReceived(apiKey: string): number {
    return mock.received.filter((r) => r.apiKey === apiKey).length;
  }

  function setStrategy(strategy: string) {
    return ctx.app.inject({
      method: "PUT",
      url: "/admin/api/settings",
      headers: ADMIN_HEADERS,
      payload: { routing_strategy: strategy },
    });
  }

  function health(providerId: number) {
    return ctx.db.prepare("SELECT * FROM provider_health WHERE provider_id = ?").get(providerId) as any;
  }

  // -------------------------------------------------------------------------

  it("half-open: after cooldown expiry the provider must pass one probe before rejoining", async () => {
    await setStrategy("priority");
    await ctx.app.inject({
      method: "PUT",
      url: "/admin/api/settings",
      headers: ADMIN_HEADERS,
      payload: { cooldown_429_ms: "1" },
    });
    const modelId = seedModel(ctx.db, "probe-model");
    const flakyId = seedProvider(ctx.db, {
      modelId,
      name: "Probe Flaky",
      baseUrl: mock.url,
      apiKey: "flaky",
      upstreamModel: "p-m",
      priority: 1,
    });
    seedProvider(ctx.db, {
      modelId,
      name: "Probe Stable",
      baseUrl: mock.url,
      apiKey: "probeB",
      upstreamModel: "p-m",
      priority: 2,
    });

    // 1) outage: 429 -> failover to Stable, cooldown + probe_pending set
    const r1 = await chat({ model: "probe-model", messages: [{ role: "user", content: "1" }] });
    expect(r1.statusCode).toBe(200);
    expect(r1.json().choices[0].message.content).toBe("from-probeB");
    const h1 = health(flakyId);
    expect(h1.probe_pending).toBe(1);
    expect(h1.cooldown_until).toBeTruthy();

    // 2) cooldown expires -> the NEXT request probes the flaky provider first
    await sleep(30);
    const r2 = await chat({ model: "probe-model", messages: [{ role: "user", content: "2" }] });
    expect(r2.statusCode).toBe(200);
    expect(r2.json().choices[0].message.content).toBe("recovered"); // probe hit first, recovered
    const h2 = health(flakyId);
    expect(h2.probe_pending).toBe(0);
    expect(h2.status).toBe("online");
    expect(h2.cooldown_until).toBeNull();

    // 3) rejoined the rotation normally (still priority 1)
    const r3 = await chat({ model: "probe-model", messages: [{ role: "user", content: "3" }] });
    expect(r3.json().choices[0].message.content).toBe("recovered");
    expect(countReceived("flaky")).toBe(3);
  });

  it("half-open: a concurrent request does not double-probe a recovering provider", async () => {
    await setStrategy("priority");
    const modelId = seedModel(ctx.db, "concurrent-probe-model");
    const slowId = seedProvider(ctx.db, {
      modelId,
      name: "Slow Probe",
      baseUrl: mock.url,
      apiKey: "probeA",
      upstreamModel: "c-m",
      priority: 1,
    });
    seedProvider(ctx.db, {
      modelId,
      name: "Healthy B",
      baseUrl: mock.url,
      apiKey: "probeB",
      upstreamModel: "c-m",
      priority: 2,
    });

    // force the half-open state: cooldown expired, probe pending
    ctx.db
      .prepare(
        "UPDATE provider_health SET cooldown_until = ?, probe_pending = 1, status = 'error' WHERE provider_id = ?"
      )
      .run(Date.now() - 1000, slowId);

    const before = countReceived("probeA");
    const p1 = chat({ model: "concurrent-probe-model", messages: [{ role: "user", content: "p1" }] });
    await sleep(30); // p1 is in flight and owns the probe claim
    const p2 = await chat({ model: "concurrent-probe-model", messages: [{ role: "user", content: "p2" }] });

    expect(p2.statusCode).toBe(200);
    expect(p2.json().choices[0].message.content).toBe("from-probeB"); // routed around the probe

    const r1 = await p1;
    expect(r1.statusCode).toBe(200);
    expect(r1.json().choices[0].message.content).toBe("from-probeA"); // exactly one probe

    expect(countReceived("probeA")).toBe(before + 1);
    expect(health(slowId).probe_pending).toBe(0);
  });

  // -------------------------------------------------------------------------

  it("degrades gracefully on 400: retries the same provider without unsupported params", async () => {
    const modelId = seedModel(ctx.db, "degrade-model");
    const id = seedProvider(ctx.db, {
      modelId,
      name: "Strict Provider",
      baseUrl: mock.url,
      apiKey: "degraded",
      upstreamModel: "d-m",
      priority: 1,
    });

    const before = countReceived("degraded");
    const res = await chat({
      model: "degrade-model",
      messages: [{ role: "user", content: "hi" }],
      response_format: { type: "json_object" },
      seed: 42,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().choices[0].message.content).toBe("degraded-ok");

    const calls = mock.received.filter((r) => r.apiKey === "degraded").slice(before);
    expect(calls.length).toBe(2); // original 400 + degraded retry, same provider
    expect(calls[0].body.response_format).toBeTruthy();
    expect(calls[1].body.response_format).toBeUndefined(); // stripped
    expect(calls[1].body.seed).toBeUndefined();

    // not counted as a failure — the retry succeeded
    const h = health(id);
    expect(h.status).toBe("online");
    expect(h.failures).toBe(0);
    expect(h.requests).toBe(1);
  });

  // -------------------------------------------------------------------------

  it("overview exposes recent errors and api-key presence", async () => {
    // a brand-new instance has no router key and no failures
    const fresh = await makeApp();
    const freshRes = await fresh.app.inject({
      method: "GET",
      url: "/admin/api/overview",
      headers: ADMIN_HEADERS,
    });
    expect(freshRes.json().has_api_key).toBe(false);
    expect(freshRes.json().errors).toEqual([]);
    await fresh.app.close();

    // this instance already has a key (used by chat()) and now gets a failure
    const modelId = seedModel(ctx.db, "ov-model");
    seedProvider(ctx.db, {
      modelId,
      name: "OV 429",
      baseUrl: mock.url,
      apiKey: "ov429",
      upstreamModel: "ov-m",
      priority: 1,
    });
    const fail = await ctx.app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      payload: { model: "ov-model", messages: [{ role: "user", content: "hi" }] } as any,
    });
    expect(fail.statusCode).toBeGreaterThanOrEqual(400);

    const res = await ctx.app.inject({ method: "GET", url: "/admin/api/overview", headers: ADMIN_HEADERS });
    const body = res.json();
    expect(body.has_api_key).toBe(true);
    expect(body.errors.length).toBeGreaterThanOrEqual(1);
    expect(body.errors[0].ok).toBe(0);
    expect(body.errors[0].model).toBe("ov-model");
  });

  it("settings accept health_check_interval_ms", async () => {
    await ctx.app.inject({
      method: "PUT",
      url: "/admin/api/settings",
      headers: ADMIN_HEADERS,
      payload: { health_check_interval_ms: "30000" },
    });
    const res = await ctx.app.inject({ method: "GET", url: "/admin/api/settings", headers: ADMIN_HEADERS });
    expect(res.json().settings.health_check_interval_ms).toBe("30000");
  });

  // -------------------------------------------------------------------------

  it("exports config without secrets", async () => {
    const modelId = seedModel(ctx.db, "exported-model", { aliases: ["exp"] });
    seedProvider(ctx.db, {
      modelId,
      name: "Exported P",
      baseUrl: mock.url,
      apiKey: "super-secret-key",
      upstreamModel: "e-m",
      priority: 7,
    });

    const res = await ctx.app.inject({ method: "GET", url: "/admin/api/export", headers: ADMIN_HEADERS });
    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data.version).toBe(1);
    expect(typeof data.exported_at).toBe("number");
    expect(data.settings.routing_strategy).toBeTruthy();

    const m = data.models.find((x: any) => x.name === "exported-model");
    expect(m).toBeTruthy();
    expect(m.aliases).toContain("exp");
    const p = m.providers[0];
    expect(p.name).toBe("Exported P");
    expect(p.type).toBe("openai-compatible");
    expect(p.base_url).toBe(mock.url);
    expect(p.upstream_model).toBe("e-m");
    expect(p.priority).toBe(7);
    expect(p).not.toHaveProperty("api_key");
    expect(p).not.toHaveProperty("api_key_enc");
    expect(JSON.stringify(data)).not.toContain("super-secret-key");
  });

  it("imports config: merge skips existing, replace wipes and recreates", async () => {
    const payload = {
      version: 1,
      settings: { routing_strategy: "priority" },
      models: [
        {
          name: "imported-model",
          input_cost: 1,
          output_cost: 2,
          aliases: ["imp"],
          providers: [
            { name: "Imported P", type: "openai-compatible", base_url: "http://localhost:9", upstream_model: "i-m", priority: 5, enabled: 1 },
          ],
        },
      ],
    };

    // merge: adds the new model, keeps existing ones
    let res = await ctx.app.inject({
      method: "POST",
      url: "/admin/api/import",
      headers: ADMIN_HEADERS,
      payload: { mode: "merge", data: payload },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().imported).toEqual({ models: 1, providers: 1 });
    expect(res.json().errors).toEqual([]);
    const names = (ctx.db.prepare("SELECT name FROM models").all() as any[]).map((r) => r.name);
    expect(names).toContain("imported-model");
    expect(names).toContain("exported-model");

    // imported provider has an EMPTY key (secrets are never transferred)
    const row = ctx.db.prepare("SELECT * FROM providers WHERE name = 'Imported P'").get() as any;
    expect(decryptSecret(row.api_key_enc)).toBe("");

    // merge again: everything already exists -> reported, nothing imported
    res = await ctx.app.inject({
      method: "POST",
      url: "/admin/api/import",
      headers: ADMIN_HEADERS,
      payload: { mode: "merge", data: payload },
    });
    expect(res.json().imported).toEqual({ models: 0, providers: 0 });
    expect(res.json().errors[0]).toContain("уже существует");

    // replace: old models are gone, only the payload remains
    res = await ctx.app.inject({
      method: "POST",
      url: "/admin/api/import",
      headers: ADMIN_HEADERS,
      payload: { mode: "replace", data: payload },
    });
    expect(res.json().imported).toEqual({ models: 1, providers: 1 });
    const after = (ctx.db.prepare("SELECT name FROM models").all() as any[]).map((r) => r.name);
    expect(after).toEqual(["imported-model"]);

    // invalid payload is rejected
    res = await ctx.app.inject({
      method: "POST",
      url: "/admin/api/import",
      headers: ADMIN_HEADERS,
      payload: { mode: "replace", data: { models: "nope" } },
    });
    expect(res.statusCode).toBe(400);
  });

  // -------------------------------------------------------------------------

  it("playground: non-streaming returns content + __mixroute_meta", async () => {
    const modelId = seedModel(ctx.db, "pg-model");
    seedProvider(ctx.db, {
      modelId,
      name: "PG P",
      baseUrl: mock.url,
      apiKey: "pg",
      upstreamModel: "g-m",
      priority: 1,
    });

    const res = await ctx.app.inject({
      method: "POST",
      url: "/admin/api/playground",
      headers: ADMIN_HEADERS,
      payload: { model: "pg-model", messages: [{ role: "user", content: "hi" }], stream: false },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.choices[0].message.content).toBe("playground says hi");
    expect(body.__mixroute_meta.provider_name).toBe("PG P");
    expect(body.__mixroute_meta.provider_id).toBeGreaterThan(0);
    expect(body.__mixroute_meta.usage.total_tokens).toBeGreaterThan(0);
    expect(body.__mixroute_meta.conversation_id).toBeTruthy();
    expect(body.__mixroute_meta.attempts).toEqual([]);
  });

  it("playground: streaming yields SSE chunks, meta event and [DONE]", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/admin/api/playground",
      headers: ADMIN_HEADERS,
      payload: { model: "pg-model", messages: [{ role: "user", content: "stream please" }], stream: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    const raw = res.payload;
    expect(raw).toContain("chat.completion.chunk");
    expect(raw).toContain("__mixroute_meta");
    expect(raw).toContain('"provider_name":"PG P"');
    expect(raw.trimEnd().endsWith("data: [DONE]")).toBe(true);

    const events = raw
      .split("\n\n")
      .filter((e) => e.startsWith("data: ") && !e.includes("[DONE]"))
      .map((e) => JSON.parse(e.slice(6)));
    const metaEvent = events.find((e) => e.__mixroute_meta);
    expect(metaEvent).toBeTruthy();
    expect(metaEvent.__mixroute_meta.conversation_id).toBeTruthy();
    // no choices on the meta event, chunks carry choices
    expect(metaEvent.choices).toBeUndefined();
    expect(events.filter((e) => Array.isArray(e.choices)).length).toBeGreaterThan(0);
  });

  it("playground: unknown model returns 404", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/admin/api/playground",
      headers: ADMIN_HEADERS,
      payload: { model: "no-such-model", messages: [{ role: "user", content: "hi" }] },
    });
    expect(res.statusCode).toBe(404);
  });

  // -------------------------------------------------------------------------

  it("health checker pings stale providers without touching request counters", async () => {
    await ctx.app.inject({
      method: "PUT",
      url: "/admin/api/settings",
      headers: ADMIN_HEADERS,
      payload: { health_check_interval_ms: "60000" },
    });

    const okModel = seedModel(ctx.db, "hc-ok-model");
    const okId = seedProvider(ctx.db, {
      modelId: okModel,
      name: "HC OK",
      baseUrl: mock.url,
      apiKey: "pg",
      upstreamModel: "hc-m",
    });
    const badModel = seedModel(ctx.db, "hc-bad-model");
    const badId = seedProvider(ctx.db, {
      modelId: badModel,
      name: "HC Dead",
      baseUrl: "http://127.0.0.1:1", // connection refused
      apiKey: "dead",
      upstreamModel: "hc-m",
    });

    const pinged = await runHealthChecks(ctx.db);
    expect(pinged).toBeGreaterThanOrEqual(2);

    const okH = health(okId);
    expect(okH.status).toBe("online");
    expect(okH.last_checked_at).toBeTruthy();
    expect(okH.requests).toBe(0); // pings are not routed requests
    expect(okH.failures).toBe(0);

    const badH = health(badId);
    expect(badH.status).toBe("error");
    expect(badH.last_error).toBeTruthy();

    // everything is fresh now -> a second run pings nobody
    const again = await runHealthChecks(ctx.db);
    expect(again).toBe(0);
  });

  it("health checker is disabled with health_check_interval_ms = 0", async () => {
    await ctx.app.inject({
      method: "PUT",
      url: "/admin/api/settings",
      headers: ADMIN_HEADERS,
      payload: { health_check_interval_ms: "0" },
    });
    const modelId = seedModel(ctx.db, "hc-off-model");
    seedProvider(ctx.db, {
      modelId,
      name: "HC Off",
      baseUrl: mock.url,
      apiKey: "pg",
      upstreamModel: "o-m",
    });
    expect(await runHealthChecks(ctx.db)).toBe(0);
  });

  // -------------------------------------------------------------------------

  it("graceful drain: /v1 rejects new requests with 503 while admin API stays up", async () => {
    (ctx.app as any).shuttingDown = true;
    try {
      const res = await chat({ model: "pg-model", messages: [{ role: "user", content: "hi" }] });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe("shutting_down");

      // admin side keeps answering during drain (needed for observability)
      const admin = await ctx.app.inject({ method: "GET", url: "/admin/api/overview", headers: ADMIN_HEADERS });
      expect(admin.statusCode).toBe(200);
    } finally {
      (ctx.app as any).shuttingDown = false;
    }
  });

  it("SSE writer: waits for drain on backpressure, resolves closed on disconnect", async () => {
    const { EventEmitter } = await import("node:events");
    const { writeWithBackpressure } = await import("../src/sse.js");

    class FakeRes extends EventEmitter {
      writableEnded = false;
      destroyed = false;
      blocked = false;
      writes: string[] = [];
      write(p: string) {
        this.writes.push(p);
        return !this.blocked;
      }
    }

    // fast client: write() accepted immediately
    const fast = new FakeRes();
    expect(await writeWithBackpressure(fast as any, "a")).toBe("ok");
    expect(fast.writes).toEqual(["a"]);

    // slow client: write() buffered -> resolves only after 'drain'
    const slow = new FakeRes();
    slow.blocked = true;
    let settled = false;
    const p = writeWithBackpressure(slow as any, "b").then((r) => {
      settled = true;
      return r;
    });
    await sleep(10);
    expect(settled).toBe(false); // still waiting for the socket
    slow.emit("drain");
    expect(await p).toBe("ok");

    // client disconnects while buffered -> 'closed'
    const gone = new FakeRes();
    gone.blocked = true;
    const p2 = writeWithBackpressure(gone as any, "c");
    await sleep(5);
    gone.emit("close");
    expect(await p2).toBe("closed");

    // already-destroyed socket
    const dead = new FakeRes();
    dead.destroyed = true;
    expect(await writeWithBackpressure(dead as any, "d")).toBe("closed");
  });
});
