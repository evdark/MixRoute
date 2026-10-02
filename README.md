<div align="center">

# 🚦 MixRoute

### *One model → many providers → one endpoint. The simple, self-hosted AI router.*

**OpenAI-compatible · automatic failover · persistent context · zero-dependency dashboard**

[![🚦 CI](https://github.com/evdark/MixRoute/actions/workflows/ci.yml/badge.svg)](https://github.com/evdark/MixRoute/actions/workflows/ci.yml)
[![🧪 Tests](https://img.shields.io/badge/tests-47%20passed-brightgreen)](#-development--ci)
[![pnpm](https://img.shields.io/badge/package%20manager-pnpm-f0ad4e)](https://pnpm.io)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933)](https://nodejs.org)
[![💌 License](https://img.shields.io/badge/license-MIT-lightgrey)](#-not-built-on-purpose)

```
                    ┌─── 🔌 Provider A — key 1
                    │
                    ├─── 🔌 Provider B — key 2
Client ──▶ MixRoute ┼─── 🔌 Provider C — key 3
   🤖 Cursor,       │
   OpenCode,        └─── 🔌 Provider D — key 4
   your app
```

**[⬇️ Установка](INSTALL.md)** · **[✨ Возможности](#-features)** · **[🚀 Быстрый старт](#-quick-start)** · **[🔌 API](#-api-reference)**

</div>

---

## 🗺️ Contents

- [✨ What is this?](#-what-is-this)
- [🌟 Features](#-features)
- [📦 Installation — the `mixr` command](#-installation--the-mixr-command)
- [🚀 Quick start](#-quick-start)
- [🧭 Dashboard tour](#-dashboard-tour)
- [🔌 API reference](#-api-reference)
- [⚙️ How routing works](#%EF%B8%8F-how-routing-works)
- [🐳 Docker](#-docker)
- [🔧 Configuration](#-configuration)
- [🏗️ Architecture](#%EF%B8%8F-architecture)
- [🧪 Development & CI](#-development--ci)
- [🗺️ Roadmap](#%EF%B8%8F-roadmap)
- [🙅 Not built (on purpose)](#-not-built-on-purpose)

---

## ✨ What is this?

MixRoute is a small, self-hosted gateway that puts **one logical model** in front of **several upstream providers** — different base URLs, different API keys, even different upstream model names.

Clients (Cursor, OpenCode, your app) see a single endpoint, a single key and a single model. They never think about which upstream answered — MixRoute routes, retries, fails over and keeps the conversation context itself.

> 🎯 Inspired by [9Router](https://github.com/afddss/9Router)-style projects, built from scratch for simplicity: **one binary, one SQLite file, no Redis, no Kubernetes.**

### Why (・∀・)

| | Without a router | With MixRoute |
| --- | --- | --- |
| 🔑 | paste a new key into every app | one `rk_live_...` key everywhere |
| 💥 | provider dies → your work stops | automatic failover, you never notice |
| 🔁 | copy-paste history between providers | the router owns the conversation |
| 📊 | invoice archaeology per provider | tokens, cost & activity in one place |

## 🌟 Features

| | Feature | Why it matters |
| --- | --- | --- |
| 🧠 | **Model abstraction** | `claude-opus-5.5` maps to 3 providers with 3 base URLs, 3 keys, 3 upstream model names |
| 🔀 | **3 routing strategies** | Round robin · Priority · Least used — switch in Settings |
| 🛡️ | **Automatic failover** | 429 / 408 / 5xx / timeout / connection errors → next provider, with attempt chain in logs |
| ⏳ | **Cooldowns + circuit breaker** | Per-class cooldowns (429, 5xx, timeout, auth). After a cooldown a provider must pass **one probe request** (half-open state) before rejoining full rotation |
| 🩺 | **Background health-check** | Idle providers are pinged automatically — live status on the dashboard without waiting for traffic |
| 💬 | **Persistent context** | The router owns conversations — switch providers mid-dialog, context never breaks |
| 🌊 | **Streaming with backpressure** | SSE + slow-client throttling: the server waits for `drain` instead of buffering chunks |
| 🔌 | **OpenAI-compatible API** | `POST /v1/chat/completions` (stream + non-stream), `GET /v1/models` |
| 🧩 | **Adapter system** | `openai`, `anthropic`, `gemini`, `openai-compatible` — zero provider-specific logic in the router |
| 🎛️ | **Playground (Песочница)** | Chat with any model from the dashboard, watch tokens stream in + see the failover chain |
| 📊 | **Token stats + activity calendar** | Daily token/request/cost stats with a GitHub-style activity grid — right on the **Обзор** page |
| 🔁 | **400-degradation** | If a strict provider rejects extra params the router retries once with stripped params |
| 📦 | **Config export / import** | JSON backup of models, aliases, providers & settings (🔒 secrets never exported) |
| 🧭 | **Onboarding checklist** | Empty state guides you: model → provider → API key |
| 🎚️ | **Provider presets** | OpenAI, Anthropic, Gemini, OpenRouter, Groq, DeepSeek, Together, Mistral, Ollama — one click |
| 🖥️ | **Codex-style dashboard** | Dark/light, hand-animated, RU/EN, no UI framework, no chart library |
| 🗄️ | **SQLite, WAL** | One file in `DATA_DIR`. Graceful shutdown drains in-flight requests and checkpoints the WAL |
| 🔐 | **Security** | Provider keys AES-256-GCM encrypted at rest · never returned by the API · admin password · rate limit · secrets redacted from logs |

## 📦 Installation — the `mixr` command

> 📖 Full walkthrough with troubleshooting: **[INSTALL.md](INSTALL.md)** (╥﹏╥)b

```bash
git clone https://github.com/evdark/MixRoute.git
cd MixRoute
pnpm install
pnpm build
npm link          # ← puts `mixr` into your PATH
```

```bash
$ mixr
   ███╗   ███╗ ██╗ ██╗  ██╗ ██████╗
   ████╗ ████║ ██║ ╚██╗██╔╝ ██╔══██╗
   ██╔████╔██║ ██║  ╚███╔╝  ██████╔╝
   ██║╚██╔╝██║ ██║ ██╔██╗  ██╔══██╗
   ██║ ╚═╝ ██║ ██║██╔╝ ██╗ ██║  ██║
   ╚═╝     ╚═╝ ╚═╝╚═╝  ╚═╝ ╚═╝  ╚═╝
   one model → many providers → one endpoint  v0.2.0

  MixRoute готов к работе 🎉

  📊  Дашборд      http://localhost:3000
  🔌  Base URL     http://localhost:3000/v1
  🩺  Health       http://localhost:3000/health

  💡 совет: `mixr --open` откроет дашборд сам, `mixr --help` — все команды

  Good luck in vibecode! ;3
```

`mixr` builds on first run, so `pnpm build` is optional. Ctrl+C stops it gracefully.

> 🔌 **Порт занят?** Не беда — `mixr` сам возьмёт следующий свободный
> (`⚠ порт 3000 занят — переключаюсь на 3001`) и напишет итоговый адрес.

<details>
<summary>🎤 <code>mixr --help</code></summary>

```
mixr [options]

  -p, --port <n>      HTTP port (default: 3000, or $PORT)
                      busy port? the next free one is picked automatically
  -d, --data <dir>    data directory (default: ./.data, or $DATA_DIR)
      --host <addr>   bind address (default: 0.0.0.0, or $HOST)
      --open          open the dashboard in the browser when ready
      --dev           run in dev mode (tsx watch + vite)
      --no-build      skip the build step
      --dry-run       print banner + resolved port, then exit
  -h, --help          show help
  -v, --version       print the version
```
</details>

<details>
<summary>🔀 Other ways to launch</summary>

```bash
pnpm mixr           # without global install
node bin/mixr.mjs   # plain node
npm link            # (A) global link — recommended ⭐
pnpm link --global  # (B) pnpm variant
alias mixr='node /path/to/MixRoute/bin/mixr.mjs'   # (C) shell alias
docker compose up --build                          # (D) Docker
```
</details>

## 🚀 Quick start

```bash
mixr --open
```

| | |
| --- | --- |
| 🖥️ Dashboard | http://localhost:3000 *(password: `admin` — override with `ADMIN_PASSWORD`)* |
| ⚡ Vite dev server | http://localhost:5173 (`mixr --dev`) |
| 🤖 OpenAI base URL | `http://localhost:3000/v1` |

Then, in the dashboard:

1. **🧠 Models → ➕ Добавить модель** — e.g. `claude-opus-5.5`.
2. **🔌 Providers → ➕ Добавить провайдера** — pick a preset, paste the API key, *Test connection*, optionally **«Получить модели»**. Add provider #2, #3 for the same logical model.
3. **⚙️ Settings → API keys → Create key** — copy `rk_live_...`.
4. 🎉 Talk to it:

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer rk_live_..." \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-opus-5.5","messages":[{"role":"user","content":"hello"}],"stream":true}'
```

Aliases work too (`opus` → `claude-opus-5.5`), and so do all OpenAI clients — just change `base_url`.

> 💡 **Fresh install?** The Обзор page shows an animated checklist (model → provider → key) and walks you through it.

## 🧭 Dashboard tour

| Page | What you get |
| --- | --- |
| 🏠 **Обзор** | Hero status, **KPI-статистика** (requests · success rate · errors · tokens · cost) with count-up animation, range switcher (сегодня / 7д / 30д), activity calendar, per-provider breakdown, model health bars, live feed, onboarding checklist |
| 🧠 **Модели** | Logical models, aliases, per-model pricing, provider health at a glance |
| 🔌 **Провайдеры** | CRUD, presets, *Test connection*, fetch upstream models, cooldown status, live errors |
| 🧪 **Песочница** | Playground: streamed chat, provider that answered, failover chain `A → 429 → B` |
| 📜 **Логи** | Every request: model, provider, duration, tokens, cost, attempt chain |
| ⚙️ **Настройки** | Routing strategy, retries, timeouts, cooldowns, health-check, rate limit, **API keys**, **RU/EN**, theme, **export/import** |

Dark 🌙 / light ☀️ out of the box — Codex-flavoured neutrals, hairline borders, staggered entrance animations, `prefers-reduced-motion` respected.

## 🔌 API reference

### 🌐 Public (auth: `Authorization: Bearer rk_live_...`)

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/v1/chat/completions` | Chat completion — streaming & non-streaming, failover, conversation persistence |
| `GET` | `/v1/models` | List logical models |
| `GET` | `/health` | Liveness probe |

### 🛠 Admin (auth: header `x-admin-password`)

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/admin/api/overview` | Status, models, recent activity, recent errors, key presence |
| `GET/POST` `/PATCH/DELETE` | `/admin/api/models[/:id]` | Models + aliases CRUD |
| `GET/POST` `/PATCH/DELETE` | `/admin/api/providers[/:id]` | Providers CRUD |
| `POST` | `/admin/api/providers/test` | Test a provider (also `/:id/test`) |
| `POST` | `/admin/api/providers/fetch-models` | 🔍 List upstream models (also `/:id/fetch-models`) |
| `GET/POST/DELETE` | `/admin/api/keys` | Router API keys (revoke = delete) |
| `GET/PUT` | `/admin/api/settings` | All tunables (strategy, cooldowns, health-check, …) |
| `GET` | `/admin/api/logs` | Request log with failover chains (`limit`, `offset`, `q`) |
| `GET` | `/admin/api/stats` | Token/cost aggregates by day (`range=today\|7d\|30d`) |
| `GET` | `/admin/api/activity?days=N` | GitHub-style activity grid data |
| `POST` | `/admin/api/playground` | 🧪 Test chat — SSE stream or JSON, returns `__mixroute_meta` |
| `GET` | `/admin/api/export` | 📦 Config backup — **no secrets** |
| `POST` | `/admin/api/import` | 📥 Import (`mode: "merge" \| "replace"`) |

## ⚙️ How routing works

```
Client request
   │
   ▼
Auth + rate limit + request id
   │
   ▼
Context engine ── resolves conversation (prefix-hash or conversation_id)
   │
   ▼
Candidate selection
   ├─ 🟢 healthy providers ──▶ chosen by strategy (round robin / priority / least used)
   ├─ 🟡 probes ─────────────▶ half-open providers get ONE probe request first
   └─ 🔴 cooling ────────────▶ appended as last resort (soonest cooldown first)
   │
   ▼
Attempt 1 ── 400 with unsupported params? ──▶ 🔁 retry same provider, params stripped
   │ fail
   ▼
Failover ──▶ next candidate (up to retry_count + 1 attempts)
   │                      │
   │                      └─ classification: 429 → rate_limited · 401/403 → auth
   │                                          408/5xx/timeout → error
   ▼
✅ Success → mark online, clear cooldown/probe, record usage & cost
```

**Rules of the game:**

- ⛔ Failover happens **only before the first chunk** reaches the client — a partially streamed answer is never replayed.
- 🐢 Streaming writes wait for `drain` — a slow client throttles the upstream read instead of ballooning memory.
- 🚪 Client disconnects mid-stream? Upstream is cancelled, the provider gets **no penalty**, the request is logged as `499`.
- 🧯 After restart: new `/v1` requests get `503` while in-flight ones finish, then the WAL is checkpointed.

## 🐳 Docker

```bash
cp .env.example .env      # optional: ADMIN_PASSWORD, ENCRYPTION_KEY …
docker compose up --build
```

```yaml
# docker-compose.yml — one container, one volume
services:
  router:
    build: .
    ports: ["3000:3000"]
    volumes: ["mixroute-data:/data"]
    stop_grace_period: 20s   # > 15s drain deadline
    restart: unless-stopped
```

## 🔧 Configuration

### 🌍 Environment

| Env | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port (`mixr --port` overrides) |
| `HOST` | `0.0.0.0` | Bind address |
| `DATA_DIR` | `./.data` | SQLite DB + generated encryption key |
| `ENCRYPTION_KEY` | auto-generated | 32-byte hex key for provider secrets |
| `ADMIN_PASSWORD` | `admin` | Dashboard / admin API password |
| `CORS_ORIGINS` | none | Comma-separated allowed origins |

### ⚙️ Settings (stored in SQLite, editable in the UI)

| Key | Default | Meaning |
| --- | --- | --- |
| `routing_strategy` | `round_robin` | `round_robin` · `priority` · `least_used` |
| `retry_count` | `2` | Extra attempts across the provider chain |
| `timeout_ms` | `120000` | Per-attempt upstream timeout |
| `cooldown_429_ms` | `30000` | Cooldown after rate limit |
| `cooldown_5xx_ms` | `10000` | Cooldown after 5xx |
| `cooldown_timeout_ms` | `15000` | Cooldown after timeout/connection error |
| `cooldown_auth_ms` | `60000` | Cooldown after 401/403 |
| `health_check_interval_ms` | `60000` | Background ping interval for idle providers (`0` = off) |
| `rate_limit_rpm` | `0` | Requests per minute per router key (`0` = off) |
| `default_model` | — | Used when the client omits `model` |

## 🏗️ Architecture

```
OpenAI Client
   │
   ▼
API Gateway (auth · rate limit · request id · graceful drain)
   │
   ▼
Context Engine ──── conversations & messages (SQLite, provider-agnostic)
   │
   ▼
Model Router ──── strategies · failover chain · cooldowns · half-open probes · 400-degrade
   │
   ├── Adapter: openai ──────────── 🔌 upstream A
   ├── Adapter: anthropic ───────── 🔌 upstream B
   ├── Adapter: gemini ──────────── 🔌 upstream C
   └── Adapter: openai-compatible ─ 🔌 upstream D
   │
   ▼
Response Normalizer → Client (SSE with backpressure or JSON)

   ⏱ Health-checker ──▶ pings idle providers in the background
   📊 Usage recorder ──▶ requests, tokens, cost, daily stats, activity grid
```

```
MixRoute/
├── bin/mixr.mjs        # 🚦 the `mixr` launcher (zero-dep Node script)
├── apps/
│   ├── server/         # Fastify 5 + TypeScript + better-sqlite3
│   │   ├── src/
│   │   │   ├── adapters/        # openai · anthropic · gemini · openai-compatible
│   │   │   ├── routes/          # v1 (public) · admin (dashboard API)
│   │   │   ├── router.ts        # strategies, failover, degrade, probes
│   │   │   ├── context.ts       # conversation resolution & persistence
│   │   │   ├── health.ts        # health rows, circuit breaker, probe claims
│   │   │   ├── healthcheck.ts   # background ping loop
│   │   │   ├── sse.ts           # backpressure-aware SSE writer
│   │   │   └── db.ts · crypto.ts · usage.ts · ratelimit.ts · config.ts
│   │   └── test/                # 47 vitest specs
│   └── web/            # React 19 + Vite 6 + Tailwind v4 — no router, no state lib
│       └── src/ pages/ · components/ · i18n (ru/en) · design tokens (index.css)
└── docs: README.md · INSTALL.md · .github/workflows/ci.yml
```

## 🧪 Development & CI

```bash
pnpm dev          # 🖥 server (tsx watch) + ⚡ web (vite, proxies /v1 and /admin)
mixr --dev        # 🚦 same thing through the CLI
pnpm test         # 🧪 47 tests — context, router, streaming, security, admin, improvements
pnpm typecheck    # 🔍 tsc for server + web
pnpm build        # 🏗 production build
```

| 🧪 Suite | Covers |
| --- | --- |
| `context.test.ts` | Conversation matching, prefix-hash, explicit ids, provider switching |
| `router.test.ts` | 3 strategies, failover chains, cooldowns, retries, disabled providers |
| `streaming.test.ts` | SSE framing, mid-stream provider death, usage chunks |
| `security.test.ts` | Admin auth, key encryption, redaction, rate limit, body limits |
| `admin.test.ts` | Models/providers/keys/settings/logs CRUD |
| `improvements.test.ts` | Half-open probes, 400-degradation, health-check, export/import, playground, overview |

CI runs on every push/PR: **typecheck → test → build** on Node 22 & 24 — see [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## 🗺️ Roadmap

- 📈 Latency-aware routing (EWMA per provider)
- 🔔 Webhooks / alerts on provider outages
- 📈 OpenTelemetry traces
- 💰 Budget guardrails per key
- 🧪 Playground: tools/function-calling UI

## 🙅 Not built (on purpose)

Team accounts, billing, multi-user, marketplaces. **It's a router.**

---

<div align="center">

### *Set it once — forget which provider answered.* ⚡

**🚦 `mixr` → и поехали** (◕‿◕)b

*MixRoute · self-hosted · no telemetry, no phone-home — your keys and prompts never leave your machine.*

[📥 Установка](INSTALL.md) · [✨ Features](#-features) · [🔌 API](#-api-reference) · [🗺️ Roadmap](#%EF%B8%8F-roadmap)

</div>
