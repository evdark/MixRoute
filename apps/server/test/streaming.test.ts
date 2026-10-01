import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { makeApp, seedModel, seedProvider, createApiKey, type TestContext } from "./setup.js";
import { startMockUpstream, type MockUpstream } from "./helpers.js";

function parseSSE(payload: string) {
  const events = payload
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim());
  return events;
}

describe("streaming", () => {
  let ctx: TestContext;
  let mock: MockUpstream;
  let key: string;

  beforeAll(async () => {
    ctx = await makeApp();
    mock = await startMockUpstream({
      s1: () => ({ chunks: ["Hello", " from", " upstream"], usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } }),
      s429: () => ({ status: 429 }),
      s2: () => ({ chunks: ["streamed", " from", " second"] }),
      sDie: () => ({ chunks: ["partial"], dieAfterChunks: true }),
      sOK: () => ({ content: "non-stream" }),
    });
    key = createApiKey(ctx.db, "stream-test");
  });

  afterAll(async () => {
    await mock.close();
    await ctx.close();
  });

  function chat(body: Record<string, unknown>) {
    return ctx.app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      payload: body as any,
    });
  }

  it("streams SSE chunks and terminates with [DONE]", async () => {
    const modelId = seedModel(ctx.db, "stream-model");
    seedProvider(ctx.db, {
      modelId,
      name: "Stream #1",
      baseUrl: mock.url,
      apiKey: "s1",
      upstreamModel: "stream-m",
      priority: 1,
    });

    const res = await chat({
      model: "stream-model",
      stream: true,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    const events = parseSSE(res.payload);
    expect(events[events.length - 1]).toBe("[DONE]");

    const text = events
      .filter((e) => e !== "[DONE]")
      .map((e) => JSON.parse(e))
      .flatMap((c) => (c.choices ?? []).map((ch: any) => ch.delta?.content ?? ""))
      .join("");
    expect(text).toBe("Hello from upstream");

    // usage is forwarded
    expect(res.payload).toContain('"prompt_tokens":7');

    // request logged as successful streaming request
    const logs = (
      await ctx.app.inject({ method: "GET", url: "/admin/api/logs", headers: { "x-admin-password": "admin" } })
    ).json().logs;
    const entry = logs.find((l: any) => l.model === "stream-model");
    expect(entry.ok).toBe(1);
    expect(entry.streaming).toBe(1);
    expect(entry.tokens_in).toBe(7);
    expect(entry.tokens_out).toBe(3);

    // assistant message persisted
    const convId = res.headers["x-router-conversation-id"];
    const msgs = ctx.db
      .prepare("SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY position")
      .all(String(convId)) as { role: string; content: string }[];
    expect(msgs).toHaveLength(2);
    expect(JSON.parse(msgs[1].content).content).toBe("Hello from upstream");
  });

  it("fails over to another provider before the stream starts", async () => {
    const modelId = seedModel(ctx.db, "stream-failover-model");
    seedProvider(ctx.db, {
      modelId,
      name: "SF 429",
      baseUrl: mock.url,
      apiKey: "s429",
      upstreamModel: "sf-m",
      priority: 1,
    });
    seedProvider(ctx.db, {
      modelId,
      name: "SF OK",
      baseUrl: mock.url,
      apiKey: "s2",
      upstreamModel: "sf-m",
      priority: 2,
    });

    const res = await chat({
      model: "stream-failover-model",
      stream: true,
      messages: [{ role: "user", content: "hi" }],
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    const events = parseSSE(res.payload);
    const text = events
      .filter((e) => e !== "[DONE]")
      .map((e) => JSON.parse(e))
      .flatMap((c) => (c.choices ?? []).map((ch: any) => ch.delta?.content ?? ""))
      .join("");
    expect(text).toBe("streamed from second");
    expect(res.payload).toContain("[DONE]");
  });

  it("does NOT retry after the stream started (no duplicated text)", async () => {
    const modelId = seedModel(ctx.db, "stream-die-model");
    seedProvider(ctx.db, {
      modelId,
      name: "Dies mid-stream",
      baseUrl: mock.url,
      apiKey: "sDie",
      upstreamModel: "sd-m",
      priority: 1,
    });
    seedProvider(ctx.db, {
      modelId,
      name: "Backup (must not be used)",
      baseUrl: mock.url,
      apiKey: "s2",
      upstreamModel: "sd-m",
      priority: 2,
    });

    const s2Before = mock.received.filter((r) => r.apiKey === "s2").length;
    const res = await chat({
      model: "stream-die-model",
      stream: true,
      messages: [{ role: "user", content: "hi" }],
    });

    // headers were already 200 when the provider died
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain("partial");
    expect(res.payload).not.toContain("[DONE]");

    // backup provider was never replayed into
    const s2After = mock.received.filter((r) => r.apiKey === "s2").length;
    expect(s2After).toBe(s2Before);

    // failure recorded
    const logs = (
      await ctx.app.inject({ method: "GET", url: "/admin/api/logs", headers: { "x-admin-password": "admin" } })
    ).json().logs;
    const entry = logs.find((l: any) => l.model === "stream-die-model" && l.ok === 0);
    expect(entry).toBeTruthy();
    expect(entry.error).toBeTruthy();
  });

  it("supports non-stream requests through the same model", async () => {
    const modelId = seedModel(ctx.db, "mixed-model");
    seedProvider(ctx.db, {
      modelId,
      name: "Mixed #1",
      baseUrl: mock.url,
      apiKey: "sOK",
      upstreamModel: "mx-m",
      priority: 1,
    });

    const res = await chat({ model: "mixed-model", messages: [{ role: "user", content: "hi" }] });
    expect(res.statusCode).toBe(200);
    expect(res.json().choices[0].message.content).toBe("non-stream");
  });
});
