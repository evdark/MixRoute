import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { makeApp, seedModel, seedProvider, createApiKey, ADMIN_HEADERS, type TestContext } from "./setup.js";
import { startMockUpstream, type MockUpstream } from "./helpers.js";

describe("security", () => {
  let ctx: TestContext;
  let mock: MockUpstream;

  beforeAll(async () => {
    ctx = await makeApp();
    mock = await startMockUpstream({}, () => ({ content: "ok" }));
  });

  afterAll(async () => {
    await mock.close();
    await ctx.close();
  });

  function chat(auth?: string, extraHeaders: Record<string, string> = {}) {
    return ctx.app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        "content-type": "application/json",
        ...(auth ? { authorization: `Bearer ${auth}` } : {}),
        ...extraHeaders,
      },
      payload: { model: "sec-model", messages: [{ role: "user", content: "hi" }] } as any,
    });
  }

  it("rejects requests without an API key", async () => {
    const res = await chat();
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("invalid_api_key");
  });

  it("rejects invalid API keys", async () => {
    const res = await chat("rk_live_totally_bogus");
    expect(res.statusCode).toBe(401);
  });

  it("rejects revoked API keys", async () => {
    const key = createApiKey(ctx.db, "to-revoke");
    const keyRow = ctx.db.prepare("SELECT id FROM api_keys WHERE hash = ?").get(
      (await import("../src/crypto.js")).sha256(key)
    ) as { id: number };
    ctx.db.prepare("UPDATE api_keys SET revoked = 1 WHERE id = ?").run(keyRow.id);

    const res = await chat(key);
    expect(res.statusCode).toBe(401);
  });

  it("rejects admin requests with a wrong password", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/admin/api/providers",
      headers: { "x-admin-password": "wrong" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("accepts admin requests with the correct password", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/admin/api/overview",
      headers: ADMIN_HEADERS,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("models");
  });

  it("never returns provider secrets through the API", async () => {
    const rawKey = "sk-super-secret-1234567890";
    const modelId = seedModel(ctx.db, "sec-model");
    seedProvider(ctx.db, {
      modelId,
      name: "Secret Provider",
      baseUrl: mock.url,
      apiKey: rawKey,
      upstreamModel: "sec-m",
    });

    const res = await ctx.app.inject({
      method: "GET",
      url: "/admin/api/providers",
      headers: ADMIN_HEADERS,
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).not.toContain(rawKey);
    const provider = res.json().providers[0];
    expect(provider.api_key_masked).toContain("•");
    expect(provider.api_key_masked).not.toContain(rawKey);
  });

  it("enforces router-side rate limiting", async () => {
    await ctx.app.inject({
      method: "PUT",
      url: "/admin/api/settings",
      headers: ADMIN_HEADERS,
      payload: { rate_limit_rpm: "2" },
    });
    const key = createApiKey(ctx.db, "ratelimited");

    expect((await chat(key)).statusCode).toBe(200);
    expect((await chat(key)).statusCode).toBe(200);
    const third = await chat(key);
    expect(third.statusCode).toBe(429);
    expect(third.headers["retry-after"]).toBeTruthy();

    await ctx.app.inject({
      method: "PUT",
      url: "/admin/api/settings",
      headers: ADMIN_HEADERS,
      payload: { rate_limit_rpm: "0" },
    });
  });

  it("de-duplicates requests by x-router-request-id", async () => {
    const key = createApiKey(ctx.db, "idempotent");
    const first = await chat(key, { "x-router-request-id": "idem-123" });
    expect(first.statusCode).toBe(200);
    const second = await chat(key, { "x-router-request-id": "idem-123" });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("duplicate_request_id");
  });

  it("serves /v1/models to authenticated clients only", async () => {
    const anon = await ctx.app.inject({ method: "GET", url: "/v1/models" });
    expect(anon.statusCode).toBe(401);

    const key = createApiKey(ctx.db, "models-list");
    const res = await ctx.app.inject({
      method: "GET",
      url: "/v1/models",
      headers: { authorization: `Bearer ${key}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().object).toBe("list");
    expect(res.json().data.some((m: any) => m.id === "sec-model")).toBe(true);
  });

  it("exposes an unauthenticated health endpoint", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
  });
});
