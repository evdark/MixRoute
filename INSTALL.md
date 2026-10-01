<div align="center">

# 📦 Установка MixRoute

### *От `git clone` до команды `mixr` — за пару минут* (￣▽￣)ノ

[← Назад к README](README.md)

</div>

---

## 🗺️ Что вас ждёт

| # | Шаг | Время |
| --- | --- | --- |
| 1 | 📋 Проверить требования | 10 сек |
| 2 | ⬇️ Скачать проект | ~10 сек |
| 3 | 🐾 Установить зависимости | ~30 сек |
| 4 | 🏗️ Собрать | ~20 сек |
| 5 | 🔗 Поставить команду `mixr` | 5 сек |
| 6 | 🚀 Запустить | 1 сек |

---

## 1️⃣ Требования

| | Нужно | Проверка |
| --- | --- | --- |
| 🟢 Node.js | **≥ 20** (лучше 22/24) | `node -v` |
| 🟢 pnpm | **≥ 9** | `pnpm -v` |
| 🟢 Git | любой | `git --version` |

pnpm ещё нет?

```bash
corepack enable && corepack prepare pnpm@latest --activate
# или
npm install -g pnpm
```

> 🍎 **macOS без Homebrew:** `sudo npm install -g pnpm`
> 🪟 **Windows:** pnpm работает в PowerShell / CMD как есть.

---

## 2️⃣ Скачать

```bash
git clone https://github.com/evdark/MixRoute.git
cd MixRoute
```

---

## 3️⃣ Зависимости

```bash
pnpm install
```

---

## 4️⃣ Сборка

```bash
pnpm build
```

Собирает сервер (`apps/server`) и дашборд (`apps/web`) в `dist/`.
*Пропустите — `mixr` соберёт сам при первом запуске.* (◕‿◕)

---

## 5️⃣ Команда `mixr` в терминале ✨

Выберите один из способов:

### Способ A — глобальная установка из папки проекта (рекомендую ⭐)

```bash
npm link
```

Готово: `mixr` доступен **откуда угодно**.

```bash
mixr            # 🚦 роутер запущен
```

Отменить: `npm unlink -g mixroute`

### Способ B — через pnpm

```bash
pnpm link --global
```

Отменить: `pnpm unlink -g mixroute`

### Способ C — аlias в шелле (ничего не ставит глобально)

Добавьте в `~/.zshrc` (macOS) или `~/.bashrc` (Linux):

```bash
alias mixr='node "$HOME/path/to/MixRoute/bin/mixr.mjs"'
```

Применить: `source ~/.zshrc`

### Способ D — без установки

```bash
node bin/mixr.mjs
# или
pnpm mixr
```

---

## 6️⃣ Запуск 🚀

```bash
mixr
```

```
   ███████╗██╗░░██╗ ██████╗ ██████╗ ███╗   ██╗
   ...banner...
   one model → many providers → one endpoint  v0.1.0

  MixRoute listening on http://localhost:3000
  Dashboard:  http://localhost:3000
  OpenAI API: http://localhost:3000/v1
```

| | |
| --- | --- |
| 🖥️ Дашборд | http://localhost:3000 *(пароль: `admin`)* |
| ⚡ OpenAI API | `http://localhost:3000/v1` |
| 🩺 Health | `http://localhost:3000/health` |

**Ctrl+C** — остановить (незавершённые запросы доедут, WAL чекпоинтится).

---

## 🎛️ Все флаги `mixr`

```
mixr [options]

  -p, --port <n>      порт        (по умолчанию 3000, или $PORT)
  -d, --data <dir>    папка данных (по умолчанию ./.data, или $DATA_DIR)
      --host <addr>   адрес привязки (по умолчанию 0.0.0.0, или $HOST)
      --open          открыть дашборд в браузере, когда поднимется
      --dev           режим разработки (tsx watch + vite, горячая перезагрузка)
      --no-build      не собирать перед запуском
  -h, --help          справка
  -v, --version       версия
```

### Примеры

```bash
mixr                          # стандартный запуск
mixr --port 8080 --open       # другой порт + авто-открыть дашборд
mixr --data ~/mixroute-data   # свои данные (SQLite + ключ шифрования)
mixr --dev                    # разработка с горячей перезагрузкой
ADMIN_PASSWORD=секрет mixr    # сменить пароль админки через env
```

---

## 🐳 Альтернатива: Docker

```bash
cp .env.example .env
docker compose up --build
```

---

## 🔍 Проверка после установки

```bash
# 1. роутер жив
curl http://localhost:3000/health

# 2. список моделей (нужен ключ rk_live_... из дашборда)
curl http://localhost:3000/v1/models -H "Authorization: Bearer rk_live_..."

# 3. первый чат 🎉
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer rk_live_..." \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-opus-5.5","messages":[{"role":"user","content":"привет!"}]}'
```

---

## 🧯 Troubleshooting

| Симптом | Решение |
| --- | --- |
| `mixr: command not found` | Проверьте `npm link` / `which mixr`; либо запускайте `node bin/mixr.mjs` |
| `pnpm: command not found` | `corepack enable` |
| `EADDRINUSE` | Порт занят: `mixr --port 4000` |
| Пустой дашборд | Сначала Models → ➕, затем Providers → ➕, затем ключ в Settings |
| Нет `dist/` | Уберите `--no-build` или выполните `pnpm build` |
| Неверный пароль | `ADMIN_PASSWORD=... mixr` (по умолчанию `admin`) |

---

## 🗑️ Удаление

```bash
npm unlink -g mixroute     # убрать команду mixr
rm -rf ./.data             # база, ключи шифрования, статистика
```

---

<div align="center">

**Всё. Набирайте `mixr` и пользуйтесь** (╯°□°)╯︵ ┻━┻

[← README](README.md)

</div>
