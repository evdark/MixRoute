import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { makeApp, seedModel, seedProvider, createApiKey, ADMIN_HEADERS, type TestContext } from "./setup.js";
import { startMockUpstream, type MockUpstream } from "./helpers.js";

describe("context engine", () => {
  let ctx: TestContext;
  let mock: MockUpstream;
  let key: string;

  beforeAll(async () => {
    ctx = await makeApp();
    mock = await startMockUpstream({
      keyA: (body) => ({ content: `reply-to-${body.messages.length}` }),
      keyB: (body) => ({ content: `B-reply-to-${body.messages.length}` }),
      keyC: (body) => ({ content: `C-reply-to-${body.messages.length}` }),
    });
    key = createApiKey(ctx.db, "context-test");
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

  it("keeps one continuous conversation across provider switches", async () => {
    const modelId = seedModel(ctx.db, "ctx-model-a");
    seedProvider(ctx.db, {
      modelId,
      name: "Provider A",
      baseUrl: mock.url,
      apiKey: "keyA",
      upstreamModel: "model-a",
      priority: 1,
    });
    const providerB = seedProvider(ctx.db, {
      modelId,
      name: "Provider B",
      baseUrl: mock.url,
      apiKey: "keyB",
      upstreamModel: "model-b",
      priority: 2,
    });

    const first = await chat({
      model: "ctx-model-a",
      messages: [{ role: "user", content: "hello" }],
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().choices[0].message.content).toBe("reply-to-1");
    const conversationId = first.headers["x-router-conversation-id"];
    expect(conversationId).toBeTruthy();

    // Provider A goes away — the client keeps talking as if nothing happened
    await ctx.app.inject({
      method: "PATCH",
      url: `/admin/api/providers/${providerB - 1}`,
      headers: ADMIN_HEADERS,
      payload: { enabled: 0 },
    });

    const second = await chat({
      model: "ctx-model-a",
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "reply-to-1" },
        { role: "user", content: "and now?" },
      ],
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().choices[0].message.content).toBe("B-reply-to-3");
    // same conversation, provider-independent context
    expect(second.headers["x-router-conversation-id"]).toBe(conversationId);

    // Provider B received the FULL context, not just the new message
    const bRequests = mock.received.filter((r) => r.apiKey === "keyB");
    expect(bRequests).toHaveLength(1);
    expect(bRequests[0].body.messages).toHaveLength(3);
    expect(bRequests[0].body.messages.map((m: any) => m.role)).toEqual(["user", "assistant", "user"]);

    const stored = ctx.db
      .prepare("SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ?")
      .get(String(conversationId)) as { c: number };
    expect(stored.c).toBe(4); // user + assistant + user + assistant
  });

  it("rebuilds full context from storage for explicit conversation_id", async () => {
    const modelId = seedModel(ctx.db, "ctx-model-b");
    seedProvider(ctx.db, {
      modelId,
      name: "Provider C",
      baseUrl: mock.url,
      apiKey: "keyC",
      upstreamModel: "model-c",
      priority: 1,
    });

    const first = await chat({
      model: "ctx-model-b",
      conversation_id: "conv-explicit-1",
      messages: [{ role: "user", content: "first" }],
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().choices[0].message.content).toBe("C-reply-to-1");

    // Client sends ONLY the new message — router prepends stored history
    const second = await chat({
      model: "ctx-model-b",
      conversation_id: "conv-explicit-1",
      messages: [{ role: "user", content: "second" }],
    });
    expect(second.statusCode).toBe(200);
    expect(second.headers["x-router-conversation-id"]).toBe("conv-explicit-1");

    const cRequests = mock.received.filter((r) => r.apiKey === "keyC");
    expect(cRequests).toHaveLength(2);
    expect(cRequests[1].body.messages).toHaveLength(3);
    expect(cRequests[1].body.messages[0].content).toBe("first");
    expect(cRequests[1].body.messages[1].content).toBe("C-reply-to-1");
    expect(cRequests[1].body.messages[2].content).toBe("second");
  });

  it("creates a new conversation when history does not match", async () => {
    const convsBefore = (ctx.db.prepare("SELECT COUNT(*) AS c FROM conversations").get() as { c: number }).c;
    const modelId = seedModel(ctx.db, "ctx-model-c");
    seedProvider(ctx.db, {
      modelId,
      name: "Provider C2",
      baseUrl: mock.url,
      apiKey: "keyC",
      upstreamModel: "model-c",
      priority: 1,
    });

    await chat({ model: "ctx-model-c", messages: [{ role: "user", content: "unrelated 1" }] });
    const res = await chat({ model: "ctx-model-c", messages: [{ role: "user", content: "unrelated 2" }] });
    expect(res.statusCode).toBe(200);

    const convsAfter = (ctx.db.prepare("SELECT COUNT(*) AS c FROM conversations").get() as { c: number }).c;
    expect(convsAfter).toBe(convsBefore + 2);
  });

  it("resolves aliases to the canonical model", async () => {
    const modelId = seedModel(ctx.db, "claude-opus-5.5", { aliases: ["opus"] });
    seedProvider(ctx.db, {
      modelId,
      name: "Alias Provider",
      baseUrl: mock.url,
      apiKey: "keyC",
      upstreamModel: "whatever",
      priority: 1,
    });

    const res = await chat({ model: "opus", messages: [{ role: "user", content: "alias test" }] });
    expect(res.statusCode).toBe(200);
    expect(res.json().model).toBe("claude-opus-5.5");
    const last = mock.received[mock.received.length - 1];
    expect(last.body.model).toBe("whatever"); // upstream model name is provider-specific
  });

  it("rejects unknown models", async () => {
    const res = await chat({ model: "does-not-exist", messages: [{ role: "user", content: "x" }] });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("model_not_found");
  });
});
