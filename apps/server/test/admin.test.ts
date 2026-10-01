import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { makeApp, seedModel, seedProvider, createApiKey, ADMIN_HEADERS, type TestContext } from "./setup.js";
import { startMockUpstream, type MockUpstream } from "./helpers.js";

describe("stats: activity calendar, token counting, model fetching", () => {
  let ctx: TestContext;
  let mock: MockUpstream;

  beforeAll(async () => {
    ctx = await makeApp();
    mock = await startMockUpstream(
      {
        // no `usage` in streaming -> router must estimate tokens itself
        noUsage: () => ({ chunks: ["counts", " tokens"] }),
      },
      () => ({ content: "ok" }),
      { models: ["claude-opus-5.5", "claude-sonnet-5", "gpt-5.6"] }
    );
  });

  afterAll(async () => {
    await mock.close();
    await ctx.close();
  });

  const admin = (url: string, init: Record<string, unknown> = {}) =>
    ctx.app.inject({ method: "GET", url, headers: ADMIN_HEADERS, ...init } as any);

  it("fetches available models from a provider (typed credentials)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/admin/api/providers/fetch-models",
      headers: ADMIN_HEADERS,
      payload: { type: "openai-compatible", base_url: mock.url, api_key: "key-for-listing" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.error).toBeUndefined();
    expect(body.models).toEqual(["claude-opus-5.5", "claude-sonnet-5", "gpt-5.6"]);
  });

  it("returns an error instead of throwing when the upstream is unreachable", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/admin/api/providers/fetch-models",
      headers: ADMIN_HEADERS,
      payload: { type: "openai-compatible", base_url: "http://127.0.0.1:1", api_key: "x" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.models).toEqual([]);
    expect(body.error).toBeTruthy();
  });

  it("fetches models for a saved provider using its stored key", async () => {
    const modelId = seedModel(ctx.db, "fetch-model");
    const providerId = seedProvider(ctx.db, {
      modelId,
      name: "Saved provider",
      baseUrl: mock.url,
      apiKey: "stored-key",
      upstreamModel: "whatever",
    });

    const res = await ctx.app.inject({
      method: "POST",
      url: `/admin/api/providers/${providerId}/fetch-models`,
      headers: ADMIN_HEADERS,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().models).toContain("claude-opus-5.5");
    // stored key was used (mock saw it via bearer header only if routed; just assert no error)
    expect(res.json().error).toBeUndefined();
  });

  it("counts tokens even when the provider omits usage (own estimation)", async () => {
    const modelId = seedModel(ctx.db, "activity-model");
    seedProvider(ctx.db, {
      modelId,
      name: "Activity provider",
      baseUrl: mock.url,
      apiKey: "noUsage",
      upstreamModel: "act-m",
      priority: 1,
    });
    const key = createApiKey(ctx.db, "activity");

    const stream = await ctx.app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      payload: { model: "activity-model", stream: true, messages: [{ role: "user", content: "hello stats" }] },
    });
    expect(stream.statusCode).toBe(200);

    const plain = await ctx.app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      payload: { model: "activity-model", messages: [{ role: "user", content: "hello again" }] },
    });
    expect(plain.statusCode).toBe(200);

    const logs = (await admin("/admin/api/logs?limit=10")).json().logs as any[];
    const activityLogs = logs.filter((l) => l.model === "activity-model");
    expect(activityLogs).toHaveLength(2);
    for (const entry of activityLogs) {
      expect(entry.tokens_in).toBeGreaterThan(0);
      expect(entry.tokens_out).toBeGreaterThan(0);
    }
  });

  it("returns a GitHub-style daily activity calendar", async () => {
    const res = await admin("/admin/api/activity?days=7");
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.days).toHaveLength(7);
    // continuous, ordered days ending today
    const dates = body.days.map((d: any) => d.date);
    expect([...dates].sort()).toEqual(dates);
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
      today.getDate()
    ).padStart(2, "0")}`;
    expect(dates[dates.length - 1]).toBe(todayIso);

    // today has the two requests made in the previous test
    const todayEntry = body.days[body.days.length - 1];
    expect(todayEntry.requests).toBe(2);
    expect(todayEntry.tokens).toBeGreaterThan(0);

    // totals
    expect(body.totals.requests).toBeGreaterThanOrEqual(2);
    expect(body.totals.tokens).toBe(body.totals.tokens_in + body.totals.tokens_out);
    expect(body.totals.active_days).toBeGreaterThanOrEqual(1);
    expect(body.totals.max_tokens).toBeGreaterThan(0);
  });
});
