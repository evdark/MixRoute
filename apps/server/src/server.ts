import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { openDb, type Db } from "./db.js";
import { HttpError } from "./router.js";
import { v1Routes } from "./routes/v1.js";
import { adminRoutes } from "./routes/admin.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    shuttingDown: boolean;
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function webDistPath(): string | null {
  // dev: compiled or tsx lives in apps/server/src|dist -> apps/web/dist
  const candidates = [
    path.resolve(__dirname, "../../web/dist"),
    path.resolve(__dirname, "../../../web/dist"),
  ];
  for (const c of candidates) if (fs.existsSync(path.join(c, "index.html"))) return c;
  return null;
}

export interface BuildOptions {
  db?: Db;
  logger?: boolean;
}

export async function buildApp(opts: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : {
            level: process.env.LOG_LEVEL ?? "info",
            redact: {
              paths: [
                "req.headers.authorization",
                'req.headers["x-api-key"]',
                'req.headers["x-admin-password"]',
              ],
              censor: "[REDACTED]",
            },
          },
    bodyLimit: config.bodyLimit,
  });

  const db = opts.db ?? openDb();
  app.decorate("db", db);
  app.decorate("shuttingDown", false);

  // graceful drain: refuse NEW /v1 traffic once shutdown started, while
  // in-flight requests (incl. open SSE streams) finish naturally
  app.addHook("onRequest", async (request) => {
    if (app.shuttingDown && request.url.startsWith("/v1/")) {
      throw new HttpError(503, "Server is shutting down", "shutting_down");
    }
  });

  await app.register(cors, {
    origin: config.corsOrigins.length ? config.corsOrigins : false,
    allowedHeaders: ["Content-Type", "Authorization", "x-admin-password", "x-router-request-id"],
    exposedHeaders: ["x-router-request-id", "x-router-conversation-id"],
  });

  app.setErrorHandler((errRaw, request, reply) => {
    const err = errRaw as Error & { statusCode?: number; code?: string };
    if (err instanceof HttpError) {
      const payload: Record<string, unknown> = { error: { message: err.message, code: err.code } };
      if (request.url.startsWith("/v1/")) {
        (payload.error as any).type = "router_error";
        return reply.code(err.statusCode).send(payload);
      }
      return reply.code(err.statusCode).send({ error: err.message });
    }
    const status = err.statusCode ?? 500;
    if (status >= 500) request.log.error({ err }, "unhandled error");
    if (request.url.startsWith("/v1/")) {
      return reply.code(status).send({
        error: { message: err.message, type: "invalid_request_error", code: err.code },
      });
    }
    return reply.code(status).send({ error: err.message });
  });

  await app.register(v1Routes);
  await app.register(adminRoutes);

  // Serve the built dashboard when available (production / docker).
  const webDist = webDistPath();
  if (webDist) {
    await app.register(fastifyStatic, { root: webDist, prefix: "/" });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/v1/") && !request.url.startsWith("/admin/")) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: "Not found" });
    });
  }

  return app;
}
