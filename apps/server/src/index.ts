import { config, ensureDataDir } from "./config.js";
import { buildApp } from "./server.js";
import { startRateLimitCleanup } from "./ratelimit.js";
import { startHealthChecker, stopHealthChecker } from "./healthcheck.js";

const DRAIN_TIMEOUT_MS = 15_000;

async function main(): Promise<void> {
  ensureDataDir();
  const app = await buildApp();
  const cleanup = startRateLimitCleanup();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`${signal} received — draining (finishing in-flight requests)`);
    stopHealthChecker();
    clearInterval(cleanup);

    // refuse new /v1 traffic; in-flight requests keep going
    app.shuttingDown = true;

    // hard cap: SSE streams can stay open, force-exit after the deadline
    const force = setTimeout(() => {
      app.log.warn(`drain timed out after ${DRAIN_TIMEOUT_MS}ms — forcing exit`);
      process.exit(1);
    }, DRAIN_TIMEOUT_MS);
    force.unref();

    try {
      await app.close(); // fastify waits for in-flight requests
      app.db.pragma("wal_checkpoint(TRUNCATE)");
      app.db.close();
      app.log.info("shutdown complete");
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, "error during shutdown");
      process.exit(1);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ port: config.port, host: config.host });
  startHealthChecker(app.db, app.log);
  app.log.info(`MixRoute listening on http://localhost:${config.port}`);
  app.log.info(`Dashboard:  http://localhost:${config.port}`);
  app.log.info(`OpenAI API: http://localhost:${config.port}/v1`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
