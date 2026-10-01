import { openDb, type Db } from "../src/db.js";
import { buildApp } from "../src/server.js";
import { encryptSecret, sha256, randomId } from "../src/crypto.js";
import type { FastifyInstance } from "fastify";

export const ADMIN_HEADERS = { "x-admin-password": process.env.ADMIN_PASSWORD ?? "admin" };

export interface TestContext {
  db: Db;
  app: FastifyInstance;
  close: () => Promise<void>;
}

export async function makeApp(): Promise<TestContext> {
  const db = openDb(":memory:");
  const app = await buildApp({ db, logger: false });
  return {
    db,
    app,
    close: async () => {
      await app.close();
      // Intentionally NOT closing the sqlite handle here: better-sqlite3
      // finalizers running after the vitest worker environment is torn down
      // crash the worker. The in-memory db is reclaimed with the process.
    },
  };
}

export function seedModel(
  db: Db,
  name: string,
  opts: { input_cost?: number; output_cost?: number; aliases?: string[] } = {}
): number {
  const info = db
    .prepare("INSERT INTO models (name, input_cost, output_cost, created_at) VALUES (?, ?, ?, ?)")
    .run(name, opts.input_cost ?? 0, opts.output_cost ?? 0, Date.now());
  const id = Number(info.lastInsertRowid);
  for (const alias of opts.aliases ?? []) {
    db.prepare("INSERT INTO aliases (alias, model_id) VALUES (?, ?)").run(alias, id);
  }
  return id;
}

export interface SeedProviderOpts {
  modelId: number;
  name: string;
  baseUrl: string;
  apiKey: string;
  upstreamModel: string;
  priority?: number;
  enabled?: boolean;
  type?: string;
}

export function seedProvider(db: Db, opts: SeedProviderOpts): number {
  const info = db
    .prepare(
      `INSERT INTO providers (model_id, name, type, base_url, api_key_enc, upstream_model, priority, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      opts.modelId,
      opts.name,
      opts.type ?? "openai-compatible",
      opts.baseUrl,
      encryptSecret(opts.apiKey),
      opts.upstreamModel,
      opts.priority ?? 100,
      opts.enabled === false ? 0 : 1,
      Date.now()
    );
  const id = Number(info.lastInsertRowid);
  db.prepare("INSERT INTO provider_health (provider_id) VALUES (?) ON CONFLICT(provider_id) DO NOTHING").run(id);
  return id;
}

export function createApiKey(db: Db, name = "test"): string {
  const key = `rk_test_${randomId(16)}`;
  db.prepare("INSERT INTO api_keys (name, prefix, hash, created_at) VALUES (?, ?, ?, ?)").run(
    name,
    key.slice(0, 12),
    sha256(key),
    Date.now()
  );
  return key;
}

export function chatPayload(messages: any[], extra: Record<string, unknown> = {}) {
  return { model: undefined, messages, ...extra };
}
