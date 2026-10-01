import http from "node:http";
import type { AddressInfo } from "node:net";

export interface MockBehavior {
  status?: number;
  content?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  chunks?: string[];
  chunkDelayMs?: number;
  delayMs?: number;
  /** Send chunks then destroy the socket (mid-stream provider death). */
  dieAfterChunks?: boolean;
}

export interface ReceivedRequest {
  apiKey: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: any;
}

export type RouteHandler = (body: any, req: ReceivedRequest) => MockBehavior | Promise<MockBehavior>;

export interface MockUpstream {
  url: string;
  received: ReceivedRequest[];
  close: () => Promise<void>;
}

export async function startMockUpstream(
  routes: Record<string, RouteHandler> = {},
  fallback: RouteHandler = () => ({ content: "ok" }),
  opts: { models?: string[] } = {}
): Promise<MockUpstream> {
  const received: ReceivedRequest[] = [];

  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8") || "{}";
    let body: any = {};
    try {
      body = JSON.parse(raw);
    } catch {
      /* keep {} */
    }
    const apiKey = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const info: ReceivedRequest = { apiKey, url: req.url ?? "", headers: req.headers, body };
    received.push(info);

    // OpenAI/Anthropic-style model listing: GET .../models
    if (req.method === "GET" && (req.url ?? "").includes("/models")) {
      const ids = opts.models ?? ["mock-model-1", "mock-model-2"];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: ids.map((id) => ({ id })) }));
      return;
    }

    const handler = routes[apiKey] ?? fallback;
    const behavior = await handler(body, info);

    if (behavior.delayMs) await sleep(behavior.delayMs);
    if (res.destroyed || res.writableEnded) return;

    if (behavior.status && behavior.status >= 400) {
      res.writeHead(behavior.status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: `mock error ${behavior.status}` } }));
      return;
    }

    if (body.stream) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      const parts = behavior.chunks ?? ["Hello", " from", " mock"];
      for (const text of parts) {
        if (res.destroyed) return;
        res.write(
          `data: ${JSON.stringify({
            id: "chatcmpl-mock",
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: body.model,
            choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
          })}\n\n`
        );
        await sleep(behavior.chunkDelayMs ?? 10);
      }
      if (behavior.dieAfterChunks) {
        res.destroy();
        return;
      }
      if (behavior.usage) {
        res.write(
          `data: ${JSON.stringify({
            id: "chatcmpl-mock",
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: body.model,
            choices: [],
            usage: behavior.usage,
          })}\n\n`
        );
      }
      res.write(
        `data: ${JSON.stringify({
          id: "chatcmpl-mock",
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: body.model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        })}\n\n`
      );
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "chatcmpl-mock",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: body.model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: behavior.content ?? "ok" },
            finish_reason: "stop",
          },
        ],
        usage: behavior.usage ?? { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })
    );
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}`,
    received,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
