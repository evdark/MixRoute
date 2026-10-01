import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { makeApp, seedModel, seedProvider, createApiKey, ADMIN_HEADERS, type TestContext } from "./setup.js";
import { startMockUpstream, sleep, type MockUpstream } from "./helpers.js";

describe("router: strategies, failover, cooldown, retries", () => {
  let ctx: TestContext;
  let mock: MockUpstream;
  let key: string;

  beforeAll(async () => {
    ctx = await makeApp();
    mock = await startMockUpstream({
      rr1: () => ({ content: "from-rr1" }),
      rr2: () => ({ content: "from-rr2" }),
      rr3: () => ({ content: "from-rr3" }),
      prio1: () => ({ content: "from-prio1" }),
      prio2: () => ({ content: "from-prio2" }),
      err429: () => ({ status: 429 }),
      err500: () => ({ status: 500 }),
      ok200: () => ({ content: "from-ok200" }),
      least1: () => ({ content: "from-least1" }),
      least2: () => ({ content: "from-least2" }),
      always429: () => ({ status: 429 }),
      never: () => ({ content: "should-not-be-called" }),
    });
    key = createApiKey(ctx.db, "router-test");
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

  it("round robin distributes requests across providers", async () => {
    await setStrategy("round_robin");
    const modelId = seedModel(ctx.db, "rr-model");
    for (let i = 1; i <= 3; i++) {
      seedProvider(ctx.db, {
        modelId,
        name: `RR #${i}`,
        baseUrl: mock.url,
        apiKey: `rr${i}`,
        upstreamModel: `rr-model-${i}`,
        priority: 100,
      });
    }

    const contents: string[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await chat({ model: "rr-model", messages: [{ role: "user", content: "hi" }] });
      expect(res.statusCode).toBe(200);
      contents.push(res.json().choices[0].message.content);
    }
    expect(countReceived("rr1")).toBe(2);
    expect(countReceived("rr2")).toBe(2);
    expect(countReceived("rr3")).toBe(2);
    // verify strict rotation within one cycle
    expect(contents.slice(0, 3).sort()).toEqual(["from-rr1", "from-rr2", "from-rr3"]);
  });

  it("priority strategy always prefers the highest-priority provider", async () => {
    await setStrategy("priority");
    const modelId = seedModel(ctx.db, "prio-model");
    seedProvider(ctx.db, {
      modelId,
      name: "Prio #1",
      baseUrl: mock.url,
      apiKey: "prio1",
      upstreamModel: "prio-m",
      priority: 1,
    });
    seedProvider(ctx.db, {
      modelId,
      name: "Prio #2",
      baseUrl: mock.url,
      apiKey: "prio2",
      upstreamModel: "prio-m",
      priority: 5,
    });

    for (let i = 0; i < 3; i++) {
      const res = await chat({ model: "prio-model", messages: [{ role: "user", content: "hi" }] });
      expect(res.json().choices[0].message.content).toBe("from-prio1");
    }
    expect(countReceived("prio2")).toBe(0);
  });

  it("fails over on 429 and records the attempt chain", async () => {
    await setStrategy("priority");
    const modelId = seedModel(ctx.db, "fo429-model");
    const badId = seedProvider(ctx.db, {
      modelId,
      name: "Bad 429",
      baseUrl: mock.url,
      apiKey: "err429",
      upstreamModel: "fo-m",
      priority: 1,
    });
    seedProvider(ctx.db, {
      modelId,
      name: "Good B",
      baseUrl: mock.url,
      apiKey: "ok200",
      upstreamModel: "fo-m",
      priority: 2,
    });

    const res = await chat({ model: "fo429-model", messages: [{ role: "user", content: "hi" }] });
    expect(res.statusCode).toBe(200);
    expect(res.json().choices[0].message.content).toBe("from-ok200");

    // health: bad provider is rate limited with cooldown
    const providers = (
      await ctx.app.inject({ method: "GET", url: "/admin/api/providers", headers: ADMIN_HEADERS })
    ).json().providers;
    const bad = providers.find((p: any) => p.id === badId);
    expect(bad.status).toBe("rate_limited");
    expect(bad.cooldown_until).toBeGreaterThan(Date.now());

    // log recorded the failover chain
    const logs = (
      await ctx.app.inject({ method: "GET", url: "/admin/api/logs", headers: ADMIN_HEADERS })
    ).json().logs;
    const entry = logs.find((l: any) => l.model === "fo429-model");
    expect(entry.ok).toBe(1);
    expect(entry.failover).toEqual([{ provider: "Bad 429", status: 429 }]);

    // cooling provider is excluded from subsequent routing
    const callsBefore = countReceived("err429");
    const res2 = await chat({ model: "fo429-model", messages: [{ role: "user", content: "hi again" }] });
    expect(res2.statusCode).toBe(200);
    expect(countReceived("err429")).toBe(callsBefore);
  });

  it("walks the chain through multiple failures (retry_count)", async () => {
    await setStrategy("priority");
    const modelId = seedModel(ctx.db, "chain-model");
    seedProvider(ctx.db, {
      modelId,
      name: "Chain 429",
      baseUrl: mock.url,
      apiKey: "err429",
      upstreamModel: "chain-m",
      priority: 1,
    });
    seedProvider(ctx.db, {
      modelId,
      name: "Chain 500",
      baseUrl: mock.url,
      apiKey: "err500",
      upstreamModel: "chain-m",
      priority: 2,
    });
    seedProvider(ctx.db, {
      modelId,
      name: "Chain OK",
      baseUrl: mock.url,
      apiKey: "ok200",
      upstreamModel: "chain-m",
      priority: 3,
    });

    const res = await chat({ model: "chain-model", messages: [{ role: "user", content: "hi" }] });
    expect(res.statusCode).toBe(200);
    expect(res.json().choices[0].message.content).toBe("from-ok200");

    const logs = (
      await ctx.app.inject({ method: "GET", url: "/admin/api/logs", headers: ADMIN_HEADERS })
    ).json().logs;
    const entry = logs.find((l: any) => l.model === "chain-model");
    expect(entry.failover).toEqual([
      { provider: "Chain 429", status: 429 },
      { provider: "Chain 500", status: 500 },
    ]);
  });

  it("skips disabled providers", async () => {
    await setStrategy("priority");
    const modelId = seedModel(ctx.db, "disabled-model");
    const disabledId = seedProvider(ctx.db, {
      modelId,
      name: "Disabled #1",
      baseUrl: mock.url,
      apiKey: "never",
      upstreamModel: "d-m",
      priority: 1,
      enabled: false,
    });
    seedProvider(ctx.db, {
      modelId,
      name: "Enabled #2",
      baseUrl: mock.url,
      apiKey: "ok200",
      upstreamModel: "d-m",
      priority: 2,
    });

    const res = await chat({ model: "disabled-model", messages: [{ role: "user", content: "hi" }] });
    expect(res.statusCode).toBe(200);
    expect(res.json().choices[0].message.content).toBe("from-ok200");
    expect(countReceived("never")).toBe(0);

    const providers = (
      await ctx.app.inject({ method: "GET", url: "/admin/api/providers", headers: ADMIN_HEADERS })
    ).json().providers;
    expect(providers.find((p: any) => p.id === disabledId).status).toBe("disabled");
  });

  it("least used picks the provider with the fewest requests", async () => {
    await setStrategy("least_used");
    const modelId = seedModel(ctx.db, "least-model");
    seedProvider(ctx.db, {
      modelId,
      name: "Least #1",
      baseUrl: mock.url,
      apiKey: "least1",
      upstreamModel: "l-m",
      priority: 100,
    });
    seedProvider(ctx.db, {
      modelId,
      name: "Least #2",
      baseUrl: mock.url,
      apiKey: "least2",
      upstreamModel: "l-m",
      priority: 100,
    });

    await chat({ model: "least-model", messages: [{ role: "user", content: "1" }] }); // tie -> #1
    const second = await chat({ model: "least-model", messages: [{ role: "user", content: "2" }] });
    expect(second.json().choices[0].message.content).toBe("from-least2");
  });

  it("cooldown expires and the provider rejoins rotation", async () => {
    await setStrategy("priority");
    await ctx.app.inject({
      method: "PUT",
      url: "/admin/api/settings",
      headers: ADMIN_HEADERS,
      payload: { cooldown_429_ms: "1" },
    });
    const modelId = seedModel(ctx.db, "cooldown-model");
    const flakyId = seedProvider(ctx.db, {
      modelId,
      name: "Flaky",
      baseUrl: mock.url,
      apiKey: "always429",
      upstreamModel: "c-m",
      priority: 1,
    });
    seedProvider(ctx.db, {
      modelId,
      name: "Stable",
      baseUrl: mock.url,
      apiKey: "ok200",
      upstreamModel: "c-m",
      priority: 2,
    });

    const r1 = await chat({ model: "cooldown-model", messages: [{ role: "user", content: "1" }] });
    expect(r1.statusCode).toBe(200); // failover to Stable

    const health = ctx.db.prepare("SELECT * FROM provider_health WHERE provider_id = ?").get(flakyId) as any;
    expect(health.cooldown_until).toBeTruthy();

    await sleep(30); // cooldown (1ms) expired
    const callsBefore = countReceived("always429");
    await chat({ model: "cooldown-model", messages: [{ role: "user", content: "2" }] });
    expect(countReceived("always429")).toBe(callsBefore + 1); // tried again (then failed over)

    await ctx.app.inject({
      method: "PUT",
      url: "/admin/api/settings",
      headers: ADMIN_HEADERS,
      payload: { cooldown_429_ms: "30000" },
    });
  });

  it("returns an error when every provider fails", async () => {
    await setStrategy("priority");
    const modelId = seedModel(ctx.db, "allfail-model");
    seedProvider(ctx.db, {
      modelId,
      name: "AF 429",
      baseUrl: mock.url,
      apiKey: "always429",
      upstreamModel: "af-m",
      priority: 1,
    });
    seedProvider(ctx.db, {
      modelId,
      name: "AF 500",
      baseUrl: mock.url,
      apiKey: "err500",
      upstreamModel: "af-m",
      priority: 2,
    });

    const res = await chat({ model: "allfail-model", messages: [{ role: "user", content: "hi" }] });
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    expect(res.json().error.message).toBeTruthy();
  });

  it("returns 503 when the model has no providers", async () => {
    seedModel(ctx.db, "noprov-model");
    const res = await chat({ model: "noprov-model", messages: [{ role: "user", content: "hi" }] });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("no_providers");
  });
});
