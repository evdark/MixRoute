# Промпт: простой аналог 9Router

Ты — senior full-stack engineer и product designer. Нужно спроектировать и реализовать **максимально простой и удобный аналог 9Router**, без перегруженности, лишних функций и сложного интерфейса.

## 1. Главная идея

Приложение работает как единый API Router / Gateway для AI-моделей.

Пользователь хочет, например, использовать:

- Claude Opus 5.5
- GPT-5.6
- Gemini
- Kimi
- Qwen
- любые другие модели с совместимым API

Но вместо одного API-ключа пользователь добавляет **несколько API-провайдеров одного и того же типа модели**.

Пример:

```text
                    ┌── Provider A — API key 1
                    │
Client → Router ────┼── Provider B — API key 2
                    │
                    ├── Provider C — API key 3
                    │
                    └── Provider D — API key 4
```

Router самостоятельно выбирает, через какой API отправить очередной запрос.

Для клиента при этом существует **один endpoint и один API key**.

Главная ценность:

> Пользователь видит одну модель и один API endpoint, а Router прозрачно распределяет запросы между несколькими подключёнными API.

---

# 2. Ключевой принцип: контекст НИКОГДА не должен теряться

Это одна из главных функций проекта.

Если пользователь отправил:

```text
message 1
message 2
message 3
```

и:

- message 1 ушёл через Provider A
- message 2 ушёл через Provider B
- message 3 ушёл через Provider C

для пользователя это должен быть **один непрерывный диалог**.

Router обязан сохранять conversation context независимо от того, какой provider используется.

Не должно происходить:

```text
Provider A → знает историю
Provider B → не знает историю
Provider C → не знает историю
```

Должно быть:

```text
             ┌─ Provider A
             │
Conversation ├─ Provider B
             │
             └─ Provider C

        единый общий context
```

---

# 3. Ключевая модель провайдеров — несколько API под одной логической моделью

Очень важно правильно реализовать саму концепцию.

У пользователя может быть, например, **3 разных провайдера одной и той же модели**:

```text
Логическая модель в Router:
Claude Opus 5.5
```

Под ней находятся 3 совершенно разные upstream-конфигурации:

```text
Provider #1
Name: Claude API #1
Base URL: https://api-provider-a.com
API Key: sk-AAAA
Upstream model: claude-opus-5.5

Provider #2
Name: Claude API #2
Base URL: https://api-provider-b.com
API Key: sk-BBBB
Upstream model: opus-5.5

Provider #3
Name: Claude API #3
Base URL: https://api-provider-c.com
API Key: sk-CCCC
Upstream model: claude-opus-latest
```

То есть это **не обязательно три одинаковых URL и не обязательно три одинаковых значения `model`**.

Для Router всё это должно объединяться в одну логическую сущность:

```text
Claude Opus 5.5
    ├── Provider #1 → Base URL A → API key A → model A
    ├── Provider #2 → Base URL B → API key B → model B
    └── Provider #3 → Base URL C → API key C → model C
```

Клиент снаружи всегда использует только:

```text
Base URL:
http://localhost:3000/v1

Model:
claude-opus-5.5

API Key:
router-key
```

Router сам выбирает нужный upstream и подставляет его:

```text
Client
  ↓
model = claude-opus-5.5
  ↓
Router
  ↓
Provider #1
  Base URL = A
  API Key = A
  Model = model A

или

Provider #2
  Base URL = B
  API Key = B
  Model = model B

или

Provider #3
  Base URL = C
  API Key = C
  Model = model C
```

Это принципиально важно.

**Внешнее имя модели и внутреннее upstream model name — разные вещи.**

Например:

```text
External model:
claude-opus-5.5

Provider A:
https://a.example.com
model=claude-opus-5.5

Provider B:
https://b.example.com
model=opus-5.5

Provider C:
https://c.example.com
model=claude-opus-latest
```

Все три должны восприниматься Router как один пул:

```text
claude-opus-5.5
```

и участвовать в общем routing/failover.

Не заставлять клиента знать о разных Base URL, API keys или upstream model names.

---

# 4. MVP — только самое необходимое

Не превращай проект в огромную платформу.

В первой версии нужны только:

### Dashboard

- список моделей
- количество подключённых providers
- состояние providers
- простой usage
- последние ошибки

### Models

Например:

```text
Claude Opus 5.5
    ├── Provider #1
    ├── Provider #2
    ├── Provider #3
    └── Provider #4
```

Пользователь может:

- добавить provider
- удалить provider
- включить/выключить provider
- изменить priority
- проверить connection

### Providers

Provider должен содержать:

```text
Name
Provider type
Base URL
API Key
Model
Status
Priority
Enabled
```

Пример:

```text
Anthropic #1
https://api.example.com
sk-xxxxxxxx
claude-opus-5.5
Priority: 1
Enabled: ON
```

---

# 4. Routing

Нужен простой и надёжный router.

Поддержать несколько стратегий.

## Round Robin

```text
A → B → C → A → B → C
```

## Least Used

Отправлять запрос туда, где меньше всего использования.

## Priority

Сначала Provider #1.

Если он:

- недоступен
- получил rate limit
- вернул 5xx
- timeout

автоматически попробовать следующий provider.

## Failover

Пример:

```text
Provider A
    ↓
429
    ↓
Provider B
    ↓
200
```

Пользователь при этом получает обычный успешный ответ.

Не нужно показывать ему внутреннюю кухню router.

---

# 5. Очень важный момент — retries

Router должен понимать типичные ошибки:

```text
429 Too Many Requests
408 Timeout
500
502
503
504
connection error
timeout
```

При таких ошибках:

1. зафиксировать ошибку
2. временно исключить provider из routing
3. попробовать следующий доступный provider
4. если следующий тоже упал — продолжать по цепочке
5. вернуть ошибку только если доступных providers больше нет

Добавить простой cooldown:

```text
429 → cooldown 30 sec
5xx → cooldown 10 sec
timeout → cooldown 15 sec
```

Значения должны быть configurable.

---

# 6. Context Engine

Это ядро проекта.

Нужно отделить:

### Conversation

от

### Provider Request

То есть Router сначала создаёт внутренний canonical representation:

```json
{
  "conversation_id": "...",
  "model": "claude-opus-5.5",
  "messages": [
    {
      "role": "system",
      "content": "..."
    },
    {
      "role": "user",
      "content": "..."
    },
    {
      "role": "assistant",
      "content": "..."
    }
  ]
}
```

После этого адаптер конкретного provider превращает canonical context в формат нужного API.

---

# 7. Provider Adapter System

Архитектура должна позволять легко добавлять новые providers.

Например:

```text
ProviderAdapter
├── AnthropicAdapter
├── OpenAIAdapter
├── GeminiAdapter
├── OpenAICompatibleAdapter
└── CustomAdapter
```

Каждый adapter должен уметь:

```text
validate()
send()
stream()
normalizeResponse()
normalizeError()
```

Главное — Router не должен содержать provider-specific логику.

Плохой вариант:

```text
if provider == anthropic:
   ...
elif provider == openai:
   ...
elif provider == gemini:
   ...
```

Хороший вариант:

```text
adapter = providerRegistry.get(provider.type)

adapter.send(request)
```

---

# 8. OpenAI-compatible API

Обязательно сделать OpenAI-compatible endpoint.

Например:

```http
POST /v1/chat/completions
```

Клиент может использовать:

```text
Base URL:
http://localhost:3000/v1

API Key:
router-key

Model:
claude-opus-5.5
```

Таким образом любой клиент, который умеет OpenAI API, сможет работать с Router.

---

# 9. Streaming

Обязательно поддержать streaming.

Например:

```text
Client
  ↓
Router
  ↓
Provider
  ↓
SSE stream
  ↓
Client
```

Пользователь должен видеть ответ по мере генерации, а не ждать окончания всего ответа.

Router должен корректно:

- проксировать chunks
- обрабатывать disconnect
- сохранять финальный ответ
- не ломать streaming при failover

Важно:

если streaming уже начался и provider умер посреди генерации, **не пытаться незаметно продолжить тем же запросом через другой provider**, если это может привести к дублированию текста.

Лучше корректно завершить ошибку либо реализовать безопасный resume как отдельную будущую функцию.

---

# 10. Context persistence

Историю необходимо сохранять.

Минимально:

```text
Conversation
Message
ProviderRequest
ProviderResponse
Usage
Error
```

Каждая conversation должна иметь:

```text
id
model
created_at
updated_at
messages[]
```

Не привязывать conversation к provider.

---

# 11. Provider health

Для каждого provider:

```text
● Online
● Rate Limited
● Cooling Down
● Error
● Disabled
```

На dashboard показывать максимально просто:

```text
Claude Opus 5.5

4 providers

● Provider 1      Healthy
● Provider 2      Healthy
● Provider 3      Rate Limited
● Provider 4      Disabled
```

Без огромных графиков и enterprise-панелей.

---

# 12. Usage

Нужна минимальная статистика:

```text
Requests
Successful
Failed
Tokens in
Tokens out
Estimated cost
```

Разбивка:

```text
Today
7 days
30 days
```

И отдельно по provider.

---

# 13. API Keys

Router должен иметь собственные API keys.

Например:

```text
Router API Key
rk_live_xxxxxxxxx
```

Пользователь подключает этот ключ в Cursor / OpenCode / собственный клиент.

Внутренние provider API keys никогда не должны возвращаться через API.

Хранить secrets безопасно.

В UI:

```text
sk-***************abcd
```

Не показывать полный ключ после сохранения.

---

# 14. Security

Обязательно:

- API keys encrypted at rest
- secrets не писать в обычные logs
- redact Authorization headers
- redact provider API keys
- rate limit на Router API
- basic authentication для admin UI
- CORS configuration
- request size limits
- timeout limits

Не хранить полный request body в логах по умолчанию.

---

# 15. UI / UX

Главная идея интерфейса:

> Apple-like simplicity + developer tool.

Не делать:

- сложные enterprise dashboards
- 20 вкладок
- огромные таблицы
- кислотные графики
- ненужные настройки
- onboarding на 15 шагов

Нужен минимальный интерфейс.

Пример sidebar:

```text
Router

Overview
Models
Providers
Logs
Settings
```

---

# 16. Главный экран

Пример:

```text
Good afternoon

Router status
● Operational

Models

Claude Opus 5.5
4 providers
92% healthy

GPT-5.6
2 providers
100% healthy

Recent activity

✓ Claude Opus 5.5 → Provider #2
✓ Claude Opus 5.5 → Provider #1
⚠ Claude Opus 5.5 → Provider #3 → 429 → Provider #4
```

Всё.

---

# 17. Добавление Provider

UX должен занимать буквально несколько секунд.

Кнопка:

```text
+ Add Provider
```

Форма:

```text
Provider
[ OpenAI-compatible ▼ ]

Name
[ Claude API #1 ]

Base URL
[ https://... ]

API Key
[ ••••••••••••• ]

Model
[ claude-opus-5.5 ]

[ Test connection ]

[ Save provider ]
```

После Test:

```text
✓ Connection successful
Model available
Latency: 820 ms
```

---

# 18. Model abstraction

Модель и provider — **обязательно разные сущности**.

Например, есть одна логическая модель:

```text
Model:
claude-opus-5.5
```

И у неё три upstream provider:

```text
Provider A
Base URL: https://a.example.com
API Key: key-A
Upstream model: claude-opus-5.5

Provider B
Base URL: https://b.example.com
API Key: key-B
Upstream model: opus-5.5

Provider C
Base URL: https://c.example.com
API Key: key-C
Upstream model: claude-opus-latest
```

Для клиента всё это выглядит как:

```text
model=claude-opus-5.5
```

Router делает mapping:

```text
logical model
      ↓
provider selection
      ↓
provider-specific:
    base_url
    api_key
    model_name
```

То есть `model_name` внутри Provider должен быть независимым полем.

Именно это позволяет подключать к одной логической модели:

- разные Base URL
- разные API keys
- разные upstream model names
- разные OpenAI-compatible endpoints
- разные версии / alias одной модели

Router должен скрывать эту разницу от клиента.

---

# 19. Aliases

Добавить простой alias system.

Например:

```text
opus
→ claude-opus-5.5

sonnet
→ claude-sonnet-5

gpt
→ gpt-5.6
```

Клиент может отправлять:

```json
{
  "model": "opus"
}
```

Router разрешает alias в реальную model configuration.

---

# 20. Архитектура

Предпочтительная архитектура:

```text
                    ┌────────────────────┐
                    │   OpenAI Client    │
                    │ Cursor / OpenCode  │
                    │      / API         │
                    └─────────┬──────────┘
                              │
                              ▼
                    ┌────────────────────┐
                    │    API Gateway     │
                    └─────────┬──────────┘
                              │
                              ▼
                    ┌────────────────────┐
                    │  Request Parser    │
                    └─────────┬──────────┘
                              │
                              ▼
                    ┌────────────────────┐
                    │  Context Engine    │
                    └─────────┬──────────┘
                              │
                              ▼
                    ┌────────────────────┐
                    │   Model Router     │
                    └─────────┬──────────┘
                              │
                 ┌────────────┼────────────┐
                 ▼            ▼            ▼
             Provider A   Provider B   Provider C
                 │            │            │
                 └────────────┼────────────┘
                              ▼
                    ┌────────────────────┐
                    │ Response Normalizer│
                    └─────────┬──────────┘
                              │
                              ▼
                           Client
```

---

# 21. Backend

Выбери стек, который позволит сделать проект компактным и быстрым.

Предпочтительно:

```text
TypeScript
Node.js
Fastify
PostgreSQL
Redis
```

Если Redis на MVP реально не нужен — не добавляй его.

Не добавлять инфраструктуру ради инфраструктуры.

Для небольшого self-hosted deployment проект должен нормально работать на одном VPS.

---

# 22. Frontend

Предпочтительно:

```text
React
TypeScript
Vite
Tailwind
shadcn/ui
```

UI:

- dark mode
- light mode
- responsive
- desktop-first
- mobile usable
- аккуратные animations
- keyboard shortcuts

Визуальный стиль:

```text
Linear
Vercel
Raycast
OpenAI
Apple
```

Но не копировать их интерфейс.

---

# 23. Database

Минимальная схема:

```text
users

models
providers
provider_health

api_keys

conversations
messages

requests
responses

usage
logs
```

Не делать микросервисы.

Один backend.

---

# 24. Local development

Должно запускаться максимально просто:

```bash
git clone ...
pnpm install
pnpm dev
```

Для production:

```bash
pnpm build
pnpm start
```

Желательно предоставить:

```text
docker-compose.yml
.env.example
```

Пример:

```env
DATABASE_URL=
REDIS_URL=
ENCRYPTION_KEY=
JWT_SECRET=
PORT=3000
```

---

# 25. Docker

Один простой compose:

```text
router
postgres
redis (если реально нужен)
```

Не добавлять Kubernetes.

Не добавлять отдельные microservices.

Не добавлять Kafka.

Не добавлять RabbitMQ.

Не добавлять Terraform.

Не добавлять сложную observability stack.

Это маленький продукт, а не AWS.

---

# 26. Logs

Нужен удобный лог:

```text
15:42:21
Claude Opus 5.5
Provider #2
200
2.4s
```

При ошибке:

```text
15:43:01
Claude Opus 5.5
Provider #2
429
→ failover
→ Provider #3
200
```

Логи должны быть полезными для debugging.

Но не логировать secrets.

---

# 27. Configuration

В UI пользователь должен иметь возможность настроить:

```text
Routing strategy
Retry count
Timeout
Cooldown
Provider priority
Default model
```

Но advanced settings спрятать.

По умолчанию приложение должно работать нормально без ручной настройки.

---

# 28. Очень важное требование — простота

При разработке постоянно задавай вопрос:

> "Это реально нужно пользователю?"

Если ответ:

```text
нет
```

— не добавляй.

Не превращать проект в:

- AI marketplace
- billing platform
- enterprise gateway
- analytics monster
- workflow automation platform
- agent platform
- prompt marketplace

Это **router**.

---

# 29. Что должно получиться

Пользователь устанавливает приложение.

Открывает:

```text
localhost:3000
```

Создаёт логическую модель:

```text
Claude Opus 5.5
```

И добавляет под неё три разных upstream:

```text
Claude API #1
Base URL: https://provider-a.example.com
API Key: key-A
Model: claude-opus-5.5

Claude API #2
Base URL: https://provider-b.example.com
API Key: key-B
Model: opus-5.5

Claude API #3
Base URL: https://provider-c.example.com
API Key: key-C
Model: claude-opus-latest
```

Для клиента это всё равно **одна модель**:

После этого получает:

```text
http://localhost:3000/v1
```

и свой:

```text
Router API Key
```

Вставляет их в OpenCode / Cursor / другой OpenAI-compatible клиент.

Всё.

Клиент думает, что работает с одной моделью.

Router внутри:

```text
request #1 → API #1
request #2 → API #2
request #3 → API #3
request #4 → API #1
```

Если:

```text
API #2 → 429
```

Router:

```text
API #2
   ↓
429
   ↓
API #3
   ↓
200
```

При этом conversation context остаётся единым.

---

# 30. MVP acceptance criteria

Считать MVP готовым, когда можно:

### Provider management

- [ ] добавить provider
- [ ] удалить provider
- [ ] enable/disable
- [ ] test connection
- [ ] priority

### Routing

- [ ] round robin
- [ ] priority
- [ ] failover
- [ ] cooldown
- [ ] retry

### Context

- [ ] conversation persistence
- [ ] messages persistence
- [ ] provider-independent context
- [ ] корректная сборка полного context для нового provider

### API

- [ ] OpenAI-compatible endpoint
- [ ] API authentication
- [ ] streaming
- [ ] error normalization

### UI

- [ ] dashboard
- [ ] models
- [ ] providers
- [ ] logs
- [ ] settings

### Security

- [ ] encrypted provider secrets
- [ ] secrets redaction
- [ ] rate limiting
- [ ] request timeout

### Deployment

- [ ] Docker
- [ ] docker-compose
- [ ] .env.example
- [ ] README
- [ ] one-command local setup

---

# 31. Критически важные технические нюансы

## Context

Не полагаться на provider-side conversation IDs.

Router должен быть source of truth для conversation.

Provider ID может измениться на каждом request.

## Streaming

Не ломать SSE.

Не буферизировать весь response без необходимости.

## Failover

Не повторять автоматически POST request после начала streaming.

## Idempotency

Добавить request ID:

```text
x-router-request-id
```

И внутренний:

```text
request_id
```

Чтобы избежать случайных дублей.

## Token usage

Если provider возвращает usage — сохранять.

Если не возвращает — не придумывать точные значения.

## Provider differences

Разные API могут поддерживать разные параметры.

Router должен иметь capability mapping:

```text
streaming
tools
vision
json_mode
reasoning
temperature
max_tokens
```

Если конкретный provider не поддерживает параметр — корректно обработать это, а не silently ломать запрос.

---

# 32. Будущие функции НЕ делать сейчас

Архитектуру оставить расширяемой для:

```text
team accounts
billing
multi-user
provider auto-discovery
automatic key rotation
smart routing
latency routing
cost routing
usage limits
webhooks
OpenTelemetry
Cloud deployment
public hosted version
```

Но **не реализовывать их в MVP**.

---

# 33. Главный UX-принцип

Пользователь не должен думать:

> "Как работает router?"

Он должен думать:

> "Я добавил 5 API → указал одну модель → получил один endpoint → работаю."

Вся сложность должна находиться внутри.

UI должен быть настолько простым, чтобы новый пользователь понял продукт за 30 секунд.

---

# 34. Что сделать первым

Перед написанием большого количества кода:

1. Определить architecture.
2. Создать database schema.
3. Реализовать provider abstraction.
4. Реализовать canonical context model.
5. Реализовать router.
6. Реализовать OpenAI-compatible API.
7. Реализовать streaming.
8. Реализовать failover.
9. Реализовать минимальный dashboard.
10. Добавить Docker.
11. Написать тесты на routing/context/failover.
12. Только после этого заниматься визуальными улучшениями.

---

# 35. Testing

Обязательно написать тесты для:

### Context

```text
conversation сохраняется
messages сохраняются
provider меняется
context не теряется
```

### Router

```text
round robin
priority
disabled provider
429 failover
500 failover
timeout
cooldown
```

### Streaming

```text
SSE chunks
connection close
final response
usage
```

### Security

```text
invalid API key
expired API key
provider secrets never returned
```

---

# Финальное требование

Не пытайся впечатлить количеством функций.

Нужно сделать **маленький, быстрый, надёжный и очень удобный AI Router**.

Основная формула продукта:

```text
ONE MODEL
+
MULTIPLE API KEYS
+
ONE ENDPOINT
+
PERSISTENT CONTEXT
+
AUTOMATIC FAILOVER
=
SIMPLE AI ROUTER
```

Главный критерий качества:

> Пользователь добавляет несколько API, выбирает модель и больше вообще не думает о том, какой provider сейчас обслуживает запрос.

Сделай архитектуру production-ready, но сам продукт оставь максимально простым.
