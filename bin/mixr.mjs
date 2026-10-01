#!/usr/bin/env node
/**
 * MixRoute launcher — `mixr` in your terminal starts the router.
 *
 * Usage:
 *   mixr                 build (if needed) and start the router
 *   mixr --port 4000     start on a custom port
 *   mixr --data ./data   use a custom data directory
 *   mixr --open          open the dashboard in the browser when ready
 *   mixr --dev           run in dev mode (tsx watch + vite)
 *   mixr --no-build      skip the build step
 *   mixr --help          show this help
 *   mixr --version       show the version
 *
 * Zero dependencies: plain Node ≥ 20, works from any working directory.
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

/* ------------------------------------------------------------------ */
/* Args                                                                */
/* ------------------------------------------------------------------ */

const HELP = `
  🚦 MixRoute — one model, many providers, one endpoint

  ${"mixr"} [options]

  Options:
    -p, --port <n>      HTTP port (default: 3000, or $PORT)
    -d, --data <dir>    data directory (default: ./.data, or $DATA_DIR)
        --host <addr>   bind address (default: 0.0.0.0, or $HOST)
        --open          open the dashboard in your browser when ready
        --dev           run in development mode (hot reload)
        --no-build      do not build before starting
    -h, --help          show this help
    -v, --version       print the version

  Examples:
    mixr                      # start on http://localhost:3000
    mixr --port 8080 --open   # custom port + auto-open dashboard
    mixr --dev                # development with hot reload
`;

function parseArgs(argv) {
  const opts = {
    port: process.env.PORT || null,
    host: process.env.HOST || null,
    data: process.env.DATA_DIR || null,
    open: false,
    dev: false,
    build: true,
    help: false,
    version: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "-h":
      case "--help":
        opts.help = true;
        break;
      case "-v":
      case "--version":
        opts.version = true;
        break;
      case "-p":
      case "--port":
        opts.port = argv[++i];
        break;
      case "-d":
      case "--data":
        opts.data = argv[++i];
        break;
      case "--host":
        opts.host = argv[++i];
        break;
      case "--open":
        opts.open = true;
        break;
      case "--dev":
        opts.dev = true;
        break;
      case "--no-build":
        opts.build = false;
        break;
      default:
        if (arg.startsWith("-")) {
          console.error(`  ✗ unknown option: ${arg}\n`);
          console.error(HELP);
          process.exit(2);
        }
    }
  }
  return opts;
}

/* ------------------------------------------------------------------ */
/* Pretty output                                                       */
/* ------------------------------------------------------------------ */

const isTTY = process.stdout.isTTY;
const paint = (code, text) => (isTTY ? `\x1b[${code}m${text}\x1b[0m` : text);
const dim = (text) => paint("2", text);
const cyan = (text) => paint("36", text);

function banner() {
  const art = [
    "   ███████╗██╗░░██╗ ██████╗ ██████╗ ███╗   ██╗",
    "   ██╔════╝╚██╗██╔╝██╔════╝██╔═══██╗████╗  ██║",
    "   █████╗░░░╚███╔╝░██║░░░░░██║░░░██║██╔██╗██║",
    "   ██╔══╝░░░██╔██╗░██║░░░░░██║░░░██║██║╚████║",
    "   ███████╗██╔╝╚██╗╚██████╗╚██████╔╝██║░╚███║",
    "   ╚══════╝╚═╝░░╚═╝░╚═════╝░╚═════╝╚═╝░░╚══╝",
  ];
  console.log("\n" + art.map((line) => cyan(line)).join("\n"));
  console.log(
    "   " +
      dim("one model → many providers → one endpoint") +
      "  " +
      dim(`v${pkg.version}`),
  );
  console.log("");
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function commandExists(cmd) {
  const probe = process.platform === "win32" ? "where" : "which";
  return spawnSync(probe, [cmd], { stdio: "ignore" }).status === 0;
}

function run(cmd, args, env = {}) {
  const child = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, ...env },
    shell: process.platform === "win32",
  });
  if (child.status !== 0) {
    console.error(`\n  ✗ ${cmd} ${args.join(" ")} failed (exit ${child.status})`);
    process.exit(child.status ?? 1);
  }
}

function isBuilt() {
  return (
    fs.existsSync(path.join(ROOT, "apps/server/dist/index.js")) &&
    fs.existsSync(path.join(ROOT, "apps/web/dist/index.html"))
  );
}

function ensureDeps() {
  if (fs.existsSync(path.join(ROOT, "node_modules"))) return;
  console.log(dim("  ⋯ installing dependencies (pnpm install)…"));
  if (!commandExists("pnpm")) {
    console.error("  ✗ pnpm is required to install dependencies: https://pnpm.io");
    process.exit(1);
  }
  run("pnpm", ["install"]);
}

function openBrowser(url) {
  const opener =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  if (!commandExists(opener[0])) return;
  const child = spawn(opener[0], opener[1], { stdio: "ignore", detached: true });
  child.on("error", () => {});
  child.unref();
}

function waitForHealth(port, timeoutMs = 30_000) {
  const started = Date.now();
  return new Promise((resolve) => {
    const attempt = async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`, {
          signal: AbortSignal.timeout(1500),
        });
        if (res.ok) return resolve(true);
      } catch {
        /* not up yet */
      }
      if (Date.now() - started > timeoutMs) return resolve(false);
      setTimeout(attempt, 400);
    };
    attempt();
  });
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

const opts = parseArgs(process.argv.slice(2));

if (opts.help) {
  console.log(HELP);
  process.exit(0);
}
if (opts.version) {
  console.log(pkg.version);
  process.exit(0);
}

banner();
ensureDeps();

const port = String(opts.port ?? 3000);
const env = {
  ...(opts.port ? { PORT: port } : {}),
  ...(opts.host ? { HOST: opts.host } : {}),
  ...(opts.data ? { DATA_DIR: path.resolve(process.cwd(), opts.data) } : {}),
};

if (opts.dev) {
  console.log(dim("  ⋯ dev mode: server (tsx watch) + web (vite)"));
  if (!commandExists("pnpm")) {
    console.error("  ✗ pnpm is required for dev mode: https://pnpm.io");
    process.exit(1);
  }
  const child = spawn("pnpm", ["dev"], { cwd: ROOT, stdio: "inherit", env: { ...process.env, ...env } });
  child.on("exit", (code) => process.exit(code ?? 0));
} else {
  if (opts.build && !isBuilt()) {
    console.log(dim("  ⋯ first run: building the router (pnpm build)…"));
    if (!commandExists("pnpm")) {
      console.error("  ✗ pnpm is required to build: https://pnpm.io");
      process.exit(1);
    }
    run("pnpm", ["build"]);
  }

  if (!fs.existsSync(path.join(ROOT, "apps/server/dist/index.js"))) {
    console.error("  ✗ build output missing — run `pnpm build` or drop --no-build");
    process.exit(1);
  }

  const child = spawn(process.execPath, ["apps/server/dist/index.js"], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, PORT: port, ...env },
  });

  if (opts.open) {
    void waitForHealth(Number(port) || 3000).then((ok) => {
      if (ok) openBrowser(`http://localhost:${port}`);
    });
  }

  const forward = (signal) => () => child.kill(signal);
  process.on("SIGINT", forward("SIGINT"));
  process.on("SIGTERM", forward("SIGTERM"));
  child.on("exit", (code) => process.exit(code ?? 0));
}
