import { useCallback, useSyncExternalStore } from "react";

/**
 * Bilingual (ru/en) dictionary and translation hook.
 *
 * - `ru` is the source of truth: `en` is typed as a mapped view of it, so a
 *   missing or extra key is a compile-time error.
 * - Plural-sensitive strings are arrays of forms: three for ru
 *   (one / few / many), two for en (one / other). `t()` picks the form from
 *   the numeric `n` variable and then interpolates the placeholders.
 * - The active language lives in module state, persisted in `localStorage`
 *   under `mixroute.lang` (default `ru`). Components subscribe through
 *   `useT()`, so switching the language re-renders every mounted consumer.
 */

export type Lang = "ru" | "en";

export interface TVars {
  [name: string]: string | number;
}

const ru = {
  /* Common ---------------------------------------------------------- */
  "common.cancel": "Отмена",
  "common.save": "Сохранить",
  "common.delete": "Удалить",
  "common.add": "Добавить",
  "common.retry": "Повторить",
  "common.loading": "Загрузка…",
  "common.close": "Закрыть",
  "common.copy": "Копировать",
  "common.copied": "Скопировано",
  "common.done": "Готово",
  "common.name": "Название",
  "common.model": "Модель",
  "common.provider": "Провайдер",
  "common.test": "Тест",
  "common.ok": "ок",
  "common.noProviders": "Нет провайдеров",

  /* Errors ---------------------------------------------------------- */
  "error.noAccess": "Нет доступа",
  "error.somethingWrong": "Что-то пошло не так",
  "error.actionFailed": "Действие не выполнено",
  "error.noConnection": "соединение не установлено",
  "error.requestFailed": "запрос не выполнен",

  /* API layer ------------------------------------------------------- */
  "api.httpError": "Запрос не выполнен (HTTP {status})",
  "api.unreachable": "Не удалось связаться с сервером MixRoute",
  "api.emptyStream": "Пустой поток ответа",

  /* Navigation / shell ---------------------------------------------- */
  "nav.overview": "Обзор",
  "nav.models": "Модели",
  "nav.providers": "Провайдеры",
  "nav.playground": "Песочница",
  "nav.logs": "Логи",
  "nav.settings": "Настройки",
  "a11y.openNav": "Открыть навигацию",
  "a11y.closeNav": "Закрыть навигацию",
  "a11y.language": "Язык интерфейса",
  "a11y.loading": "Загрузка",
  "a11y.refreshOverview": "Обновить обзор",
  "a11y.refreshModels": "Обновить список моделей",
  "a11y.refreshProviders": "Обновить список провайдеров",
  "a11y.refreshLogs": "Обновить логи",
  "a11y.refreshSettings": "Обновить настройки",
  "a11y.edit": "Изменить {name}",
  "a11y.delete": "Удалить {name}",
  "a11y.removeAlias": "Удалить алиас {alias}",
  "a11y.newAlias": "Новый алиас",
  "a11y.showApiKey": "Показать API-ключ",
  "a11y.hideApiKey": "Скрыть API-ключ",
  "theme.toLight": "Включить светлую тему",
  "theme.toDark": "Включить тёмную тему",

  /* Login ----------------------------------------------------------- */
  "auth.admin": "Админ",
  "auth.subtitle": "Вход в админ-панель.",
  "auth.password": "Пароль администратора",
  "auth.signIn": "Войти",
  "auth.wrongPassword": "Неверный пароль.",
  "auth.rejected": "Пароль администратора отклонён. Войдите заново.",

  /* Time / formatting ----------------------------------------------- */
  "time.justNow": "только что",
  "time.secondsAgo": "{n} с назад",
  "time.minutesAgo": "{n} мин назад",
  "time.hoursAgo": "{n} ч назад",
  "time.yesterday": "вчера",
  "time.daysAgo": "{n} дн назад",
  "greeting.morning": "Доброе утро",
  "greeting.afternoon": "Добрый день",
  "greeting.evening": "Добрый вечер",

  /* Provider statuses ------------------------------------------------ */
  "status.online": "Работает",
  "status.rateLimited": "Лимит запросов",
  "status.cooling": "Пауза",
  "status.error": "Ошибка",
  "status.disabled": "Отключён",
  "status.unknown": "Неизвестно",

  /* Onboarding -------------------------------------------------------- */
  "onboarding.title": "Начало работы",
  "onboarding.progress": "{done} из {total} шагов",
  "onboarding.createModel.title": "Создать модель",
  "onboarding.createModel.hint": "Задайте имя, стоимость и алиасы.",
  "onboarding.createModel.action": "Создать модель",
  "onboarding.addProvider.title": "Добавить провайдера",
  "onboarding.addProvider.hint": "Подключите внешний API, чтобы модель могла обслуживаться.",
  "onboarding.addProvider.action": "+ Добавить провайдера",
  "onboarding.getApiKey.title": "Получить API-ключ",
  "onboarding.getApiKey.hint": "Ключ понадобится клиентам для запросов к /v1.",
  "onboarding.getApiKey.action": "Получить ключ",

  /* Overview ---------------------------------------------------------- */
  "overview.statusOperational": "Работает штатно",
  "overview.healthyPercent": "{n}% исправны",
  "overview.unknown": "неизвестно",
  "overview.subtitle": "Состояние вашего маршрутизатора.",
  "overview.total": "всего: {n}",
  "overview.emptyModelsHint": "Добавьте модель и провайдера, чтобы начать маршрутизацию через MixRoute.",
  "overview.providersNotConfigured": "Провайдеры не настроены",
  "overview.providerCount": ["{n} провайдер", "{n} провайдера", "{n} провайдеров"],
  "overview.recentHeading": "Последние события",
  "overview.recentCount": ["последние {n} запрос", "последние {n} запроса", "последние {n} запросов"],
  "overview.emptyRecentHint": "Запросы появятся здесь, как только пойдут через MixRoute.",
  "overview.emptyRecentTitle": "Трафика пока нет",
  "overview.errorsHeading": "Последние ошибки",
  "overview.endpoint": "Эндпоинт",
  "overview.copyEndpoint": "Скопировать эндпоинт",
  "overview.live": "Live",
  "overview.openLogs": "Все логи",
  "overview.successRate": "Успешность",
  "overview.byProvider": "По провайдерам",
  "overview.modelsHeading": "Модели и здоровье",

  /* Usage statistics (Overview) ------------------------------------------ */
  "overview.statsHeading": "Статистика",
  "overview.statsDesc": "Запросы, токены и расчётная стоимость за период.",
  "overview.statsLoading": "Загрузка статистики…",
  "overview.statsEmptyTitle": "За этот период нет данных",
  "overview.statsEmptyHint": "Статистика появится, как только запросы пойдут через ваших провайдеров.",
  "overview.range.today": "Сегодня",
  "overview.range.7d": "7 дней",
  "overview.range.30d": "30 дней",

  /* Shared empty states ------------------------------------------------ */
  "empty.noModels": "Моделей пока нет",

  /* Models page -------------------------------------------------------- */
  "models.subtitle": "Определения моделей, алиасы и их пул провайдеров.",
  "models.addModel": "+ Добавить модель",
  "models.addProvider": "+ Добавить провайдера",
  "models.addProviderPlain": "Добавить провайдера",
  "models.emptyHint": "Создайте первую модель, затем привяжите к ней провайдеров, чтобы MixRoute начал маршрутизацию.",
  "models.costLine": "Ввод {input} · Вывод {output}",
  "models.noProviders": "Провайдеров пока нет — добавьте, чтобы эта модель могла обслуживаться.",
  "models.addAliasFailed": "Не удалось добавить алиас",
  "models.removeAliasFailed": "Не удалось удалить алиас",

  /* Model modal --------------------------------------------------------- */
  "modelModal.edit": "Изменить модель",
  "modelModal.create": "Добавить модель",
  "modelModal.saveEdit": "Сохранить модель",
  "modelModal.saveCreate": "Создать модель",
  "modelModal.inputCost": "Стоимость ввода",
  "modelModal.outputCost": "Стоимость вывода",
  "modelModal.aliases": "Алиасы",
  "modelModal.aliasesHint": "Через запятую. Алиасы также можно менять на карточке модели.",

  /* Aliases ------------------------------------------------------------ */
  "alias.placeholder": "алиас",
  "alias.add": "+ алиас",

  /* Providers page ------------------------------------------------------- */
  "providers.subtitle": "Все внешние провайдеры по всем моделям.",
  "providers.empty.title": "Провайдеров пока нет",
  "providers.empty.hint": "Добавьте внешнего провайдера, чтобы начать обслуживание ваших моделей.",
  "providerRow.priority": "Приоритет {n}",
  "providerRow.enable": "Включить {name}",

  /* Confirm dialogs ------------------------------------------------------ */
  "confirm.deleteModel.title": "Удалить модель",
  "confirm.deleteModel.message": "Удалить «{name}»? Это также удалит её алиасы — действие необратимо.",
  "confirm.deleteProvider.title": "Удалить провайдера",
  "confirm.deleteProvider.message": "Удалить «{name}»? Трафик переключится на оставшиеся провайдеры.",

  /* Tables --------------------------------------------------------------- */
  "table.name": "Название",
  "table.type": "Тип",
  "table.status": "Статус",
  "table.priority": "Приоритет",
  "table.enabled": "Включён",
  "table.time": "Время",
  "table.latency": "Задержка",
  "table.tokensInOut": "Токены в/вых",
  "table.cost": "Стоимость",
  "table.key": "Ключ",
  "table.created": "Создан",
  "table.lastUsed": "Последнее использование",
  "table.requests": "Запросы",
  "table.successful": "Успешные",
  "table.errors": "Ошибки",

  /* Logs page ------------------------------------------------------------- */
  "logs.subtitle": "Каждый маршрутизированный запрос с историей переключений.",
  "logs.search": "Поиск по логам",
  "logs.loading": "Загрузка логов…",
  "logs.emptySearch.title": "По запросу ничего не найдено",
  "logs.emptySearch.hint": "Попробуйте другое название модели или провайдера.",
  "logs.empty.title": "Запросов пока нет",
  "logs.empty.hint": "Трафик появится здесь, как только запросы пойдут через MixRoute.",
  "logs.request": "Запрос",
  "logs.streaming": "Стриминг",
  "logs.nonStreaming": "Без стриминга",
  "logs.duration": "Длительность",
  "logs.failoverChain": "Цепочка переключений",
  "logs.errorHeading": "Ошибка",
  "logs.loadMore": "Показать ещё",
  "logs.loadMoreFailed": "Не удалось загрузить ещё",
  "tokens.in": "Токены (вход)",
  "tokens.out": "Токены (выход)",

  /* Playground ------------------------------------------------------------ */
  "playground.subtitle": "Разовый диалог с моделью через маршрутизатор MixRoute.",
  "playground.loadingModels": "Загрузка моделей…",
  "playground.emptyHint": "Создайте модель с провайдерами — и сможете опробовать её здесь.",
  "playground.emptyChat": "Напишите сообщение — MixRoute выберет провайдера и покажет ответ прямо здесь, токен за токеном.",
  "playground.you": "Вы",
  "playground.assistant": "Ассистент",
  "playground.tokens": "токены {in}/{out}",
  "playground.failovers": "Переключения:",
  "playground.placeholder": "Напишите сообщение…",
  "playground.reset": "Сбросить",
  "playground.send": "Отправить",

  /* Provider form ---------------------------------------------------------- */
  "providerForm.edit": "Изменить провайдера",
  "providerForm.create": "Добавить провайдера",
  "providerForm.test": "Тест соединения",
  "providerForm.save": "Сохранить провайдера",
  "providerForm.presetHint": "Готовый шаблон заполнит тип и Base URL — их можно поправить.",
  "providerForm.createModelOption": "+ Создать новую модель…",
  "providerForm.priorityHint": "Используется стратегией приоритета.",
  "providerForm.newModelName": "Название новой модели",
  "providerForm.upstreamModel": "Модель провайдера",
  "providerForm.upstreamModelHint": "Название модели, которое отправляется провайдеру.",
  "providerForm.fetchModels": "Получить модели",
  "providerForm.loaded": ["Загружено {n} модель", "Загружено {n} модели", "Загружено {n} моделей"],
  "providerForm.apiKey": "API-ключ",
  "providerForm.keepKeyHint": "Оставьте пустым, чтобы сохранить текущий ключ.",
  "preset.custom": "Свой (Custom)",
  "preset.ollama": "Ollama (локальный)",

  /* Activity calendar ------------------------------------------------------- */
  "calendar.title": "Активность за 120 дней",
  "calendar.loading": "Загрузка активности…",
  "calendar.activeDays": "Активных дней:",
  "calendar.totalTokens": "Всего токенов:",
  "calendar.totalRequests": "Всего запросов:",
  "calendar.requestsCount": ["{n} запрос", "{n} запроса", "{n} запросов"],
  "calendar.tokensCount": ["{n} токен", "{n} токена", "{n} токенов"],
  "calendar.less": "Меньше",
  "calendar.more": "Больше",
  "weekday.mon": "Пн",
  "weekday.tue": "Вт",
  "weekday.wed": "Ср",
  "weekday.thu": "Чт",
  "weekday.fri": "Пт",
  "weekday.sat": "Сб",
  "weekday.sun": "Вс",
  "month.jan": "янв",
  "month.feb": "фев",
  "month.mar": "мар",
  "month.apr": "апр",
  "month.may": "май",
  "month.jun": "июн",
  "month.jul": "июл",
  "month.aug": "авг",
  "month.sep": "сен",
  "month.oct": "окт",
  "month.nov": "ноя",
  "month.dec": "дек",

  /* Settings page ------------------------------------------------------------ */
  "settings.subtitle": "Маршрутизация, учётные данные и конфигурация.",
  "settings.saved": "Сохранено",
  "settings.routing.title": "Маршрутизация",
  "settings.routing.desc": "Так MixRoute выбирает провайдера для каждого запроса.",
  "settings.routing.strategy": "Стратегия маршрутизации",
  "strategy.roundRobin": "Раунд-робин",
  "strategy.priority": "Приоритет",
  "strategy.leastUsed": "Минимальная нагрузка",
  "settings.routing.defaultModel": "Модель по умолчанию",
  "settings.routing.noModel": "Нет",
  "settings.routing.retries": "Количество повторов",
  "settings.routing.retriesHint": "Сколько дополнительных провайдеров пробовать после сбоя.",
  "settings.routing.timeout": "Таймаут (мс)",
  "settings.routing.timeoutHint": "Таймаут запроса к одному провайдеру.",
  "settings.rate.title": "Ограничение запросов",
  "settings.rate.desc": "Глобальный лимит входящих запросов. 0 — без ограничения.",
  "settings.rate.rpm": "Запросов в минуту",
  "settings.advanced": "Расширенные",
  "settings.cooldowns.title": "Паузы (cooldown)",
  "settings.cooldowns.desc": "Как долго маршрутизатор держит провайдера на паузе после сбоев.",
  "settings.cooldowns.after429": "После 429 (мс)",
  "settings.cooldowns.after5xx": "После 5xx (мс)",
  "settings.cooldowns.afterTimeout": "После таймаута (мс)",
  "settings.health.title": "Health-check провайдеров",
  "settings.health.desc": "Фоновая проверка доступности, когда трафика нет.",
  "settings.health.interval": "Health-check провайдеров, мс",
  "settings.health.intervalHint": "0 — отключить. Фоновая проверка провайдеров, когда по ним нет трафика.",

  /* API keys ----------------------------------------------------------------- */
  "settings.keys.title": "API-ключи",
  "settings.keys.desc": "Ключи, которыми ваши клиенты обращаются к маршрутизатору.",
  "settings.keys.create": "Создать ключ",
  "settings.keys.loading": "Загрузка ключей…",
  "settings.keys.empty.title": "API-ключей пока нет",
  "settings.keys.empty.hint": "Создайте ключ, чтобы аутентифицировать запросы к эндпоинтам /v1.",
  "settings.keys.revoked": "Отозван",
  "settings.keys.never": "Никогда",
  "settings.keys.revoke": "Отозвать",
  "settings.keys.createTitle": "Создание API-ключа",
  "settings.keys.createdTitle": "API-ключ создан",
  "settings.keys.nameHint": "Что поможет узнать ключ позже, например «production».",
  "settings.keys.copyWarning": "Скопируйте ключ сейчас — он показан только один раз и больше не будет доступен.",
  "settings.keys.securityWarning": "Относитесь к нему как к паролю: любой, у кого есть этот ключ, может пользоваться вашим маршрутизатором.",
  "settings.keys.revokeTitle": "Отозвать API-ключ",
  "settings.keys.revokeMessage": "Отозвать «{name}»? Клиенты, использующие {prefix}••••••, сразу начнут получать 401.",
  "settings.keys.revokeConfirm": "Отозвать ключ",

  /* Configuration export / import -------------------------------------------- */
  "settings.export.title": "Конфигурация",
  "settings.export.desc": "Резервная копия моделей, провайдеров и настроек.",
  "settings.export.json": "Экспорт JSON",
  "settings.export.importJson": "Импорт JSON",
  "settings.export.note": "Экспорт не содержит API-ключи провайдеров — после импорта их нужно ввести заново.",
  "import.title": "Импорт конфигурации",
  "import.merge": "Слияние",
  "import.mergeHint": "добавить недостающее",
  "import.replace": "Замена",
  "import.replaceHint": "удалить текущие модели и импортировать",
  "import.invalidJson": "Файл не является корректным JSON.",
  "import.emptyFile": "Файл пуст или повреждён.",
  "import.version": "Неподдерживаемая версия файла конфигурации — ожидается 1.",
  "import.noModels": "В файле нет списка моделей.",
  "import.readFile": "Не удалось прочитать файл.",
  "import.imported": "Импортировано:",
  "import.errors": "Ошибки:",
  "import.keysWarning": "API-ключи не переносятся — их нужно будет ввести заново",
  "import.confirm": "Импортировать",

  /* Plural building blocks ------------------------------------------------------ */
  "count.models": ["модель", "модели", "моделей"],
  "count.providers": ["провайдер", "провайдера", "провайдеров"],
  "count.requests": ["запрос", "запроса", "запросов"],
  "count.tokens": ["токен", "токена", "токенов"],
} as const;

export type TranslationKey = keyof typeof ru;

/** English must declare the same keys; plural arrays are shorter (one / other). */
type EnValue<K extends TranslationKey> = (typeof ru)[K] extends readonly [
  string,
  string,
  string,
]
  ? readonly [string, string]
  : string;

type EnDict = { [K in TranslationKey]: EnValue<K> };

const en: EnDict = {
  /* Common ---------------------------------------------------------- */
  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.delete": "Delete",
  "common.add": "Add",
  "common.retry": "Retry",
  "common.loading": "Loading…",
  "common.close": "Close",
  "common.copy": "Copy",
  "common.copied": "Copied",
  "common.done": "Done",
  "common.name": "Name",
  "common.model": "Model",
  "common.provider": "Provider",
  "common.test": "Test",
  "common.ok": "ok",
  "common.noProviders": "No providers",

  /* Errors ---------------------------------------------------------- */
  "error.noAccess": "Access denied",
  "error.somethingWrong": "Something went wrong",
  "error.actionFailed": "Action failed",
  "error.noConnection": "connection failed",
  "error.requestFailed": "request failed",

  /* API layer ------------------------------------------------------- */
  "api.httpError": "Request failed (HTTP {status})",
  "api.unreachable": "Could not reach the MixRoute server",
  "api.emptyStream": "Empty response stream",

  /* Navigation / shell ---------------------------------------------- */
  "nav.overview": "Overview",
  "nav.models": "Models",
  "nav.providers": "Providers",
  "nav.playground": "Playground",
  "nav.logs": "Logs",
  "nav.settings": "Settings",
  "a11y.openNav": "Open navigation",
  "a11y.closeNav": "Close navigation",
  "a11y.language": "Interface language",
  "a11y.loading": "Loading",
  "a11y.refreshOverview": "Refresh overview",
  "a11y.refreshModels": "Refresh model list",
  "a11y.refreshProviders": "Refresh provider list",
  "a11y.refreshLogs": "Refresh logs",
  "a11y.refreshSettings": "Refresh settings",
  "a11y.edit": "Edit {name}",
  "a11y.delete": "Delete {name}",
  "a11y.removeAlias": "Remove alias {alias}",
  "a11y.newAlias": "New alias",
  "a11y.showApiKey": "Show API key",
  "a11y.hideApiKey": "Hide API key",
  "theme.toLight": "Switch to light theme",
  "theme.toDark": "Switch to dark theme",

  /* Login ----------------------------------------------------------- */
  "auth.admin": "Admin",
  "auth.subtitle": "Sign in to the admin console.",
  "auth.password": "Admin password",
  "auth.signIn": "Sign in",
  "auth.wrongPassword": "Incorrect password.",
  "auth.rejected": "Admin password rejected. Please sign in again.",

  /* Time / formatting ----------------------------------------------- */
  "time.justNow": "just now",
  "time.secondsAgo": "{n} s ago",
  "time.minutesAgo": "{n} min ago",
  "time.hoursAgo": "{n} h ago",
  "time.yesterday": "yesterday",
  "time.daysAgo": "{n} d ago",
  "greeting.morning": "Good morning",
  "greeting.afternoon": "Good afternoon",
  "greeting.evening": "Good evening",

  /* Provider statuses ------------------------------------------------ */
  "status.online": "Online",
  "status.rateLimited": "Rate limited",
  "status.cooling": "Cooling down",
  "status.error": "Error",
  "status.disabled": "Disabled",
  "status.unknown": "Unknown",

  /* Onboarding -------------------------------------------------------- */
  "onboarding.title": "Get started",
  "onboarding.progress": "{done} of {total} steps",
  "onboarding.createModel.title": "Create a model",
  "onboarding.createModel.hint": "Set the name, pricing and aliases.",
  "onboarding.createModel.action": "Create model",
  "onboarding.addProvider.title": "Add a provider",
  "onboarding.addProvider.hint": "Connect an external API so the model can be served.",
  "onboarding.addProvider.action": "+ Add provider",
  "onboarding.getApiKey.title": "Get an API key",
  "onboarding.getApiKey.hint": "Clients will need this key to call /v1.",
  "onboarding.getApiKey.action": "Get key",

  /* Overview ---------------------------------------------------------- */
  "overview.statusOperational": "Operational",
  "overview.healthyPercent": "{n}% healthy",
  "overview.unknown": "unknown",
  "overview.subtitle": "The state of your router.",
  "overview.total": "total: {n}",
  "overview.emptyModelsHint": "Add a model and a provider to start routing through MixRoute.",
  "overview.providersNotConfigured": "No providers configured",
  "overview.providerCount": ["{n} provider", "{n} providers"],
  "overview.recentHeading": "Recent activity",
  "overview.recentCount": ["last {n} request", "last {n} requests"],
  "overview.emptyRecentHint": "Requests will appear here as soon as they flow through MixRoute.",
  "overview.emptyRecentTitle": "No traffic yet",
  "overview.errorsHeading": "Recent errors",
  "overview.endpoint": "Endpoint",
  "overview.copyEndpoint": "Copy endpoint",
  "overview.live": "Live",
  "overview.openLogs": "All logs",
  "overview.successRate": "Success rate",
  "overview.byProvider": "By provider",
  "overview.modelsHeading": "Models & health",

  /* Usage statistics (Overview) ------------------------------------------ */
  "overview.statsHeading": "Usage",
  "overview.statsDesc": "Requests, tokens and estimated cost for the period.",
  "overview.statsLoading": "Loading stats…",
  "overview.statsEmptyTitle": "No data for this period",
  "overview.statsEmptyHint": "Statistics will appear as soon as requests flow through your providers.",
  "overview.range.today": "Today",
  "overview.range.7d": "7 days",
  "overview.range.30d": "30 days",

  /* Shared empty states ------------------------------------------------ */
  "empty.noModels": "No models yet",

  /* Models page -------------------------------------------------------- */
  "models.subtitle": "Model definitions, aliases and their provider pool.",
  "models.addModel": "+ Add model",
  "models.addProvider": "+ Add provider",
  "models.addProviderPlain": "Add provider",
  "models.emptyHint": "Create your first model, then attach providers so MixRoute can start routing.",
  "models.costLine": "Input {input} · Output {output}",
  "models.noProviders": "No providers yet — add one so this model can be served.",
  "models.addAliasFailed": "Could not add alias",
  "models.removeAliasFailed": "Could not remove alias",

  /* Model modal --------------------------------------------------------- */
  "modelModal.edit": "Edit model",
  "modelModal.create": "Add model",
  "modelModal.saveEdit": "Save model",
  "modelModal.saveCreate": "Create model",
  "modelModal.inputCost": "Input price",
  "modelModal.outputCost": "Output price",
  "modelModal.aliases": "Aliases",
  "modelModal.aliasesHint": "Comma-separated. Aliases can also be edited on the model card.",

  /* Aliases ------------------------------------------------------------ */
  "alias.placeholder": "alias",
  "alias.add": "+ alias",

  /* Providers page ------------------------------------------------------- */
  "providers.subtitle": "Every external provider across all models.",
  "providers.empty.title": "No providers yet",
  "providers.empty.hint": "Add an external provider to start serving your models.",
  "providerRow.priority": "Priority {n}",
  "providerRow.enable": "Enable {name}",

  /* Confirm dialogs ------------------------------------------------------ */
  "confirm.deleteModel.title": "Delete model",
  "confirm.deleteModel.message": "Delete “{name}”? Its aliases will be removed too — this cannot be undone.",
  "confirm.deleteProvider.title": "Delete provider",
  "confirm.deleteProvider.message": "Delete “{name}”? Traffic will fail over to the remaining providers.",

  /* Tables --------------------------------------------------------------- */
  "table.name": "Name",
  "table.type": "Type",
  "table.status": "Status",
  "table.priority": "Priority",
  "table.enabled": "Enabled",
  "table.time": "Time",
  "table.latency": "Latency",
  "table.tokensInOut": "Tokens in/out",
  "table.cost": "Cost",
  "table.key": "Key",
  "table.created": "Created",
  "table.lastUsed": "Last used",
  "table.requests": "Requests",
  "table.successful": "Successful",
  "table.errors": "Errors",

  /* Logs page ------------------------------------------------------------- */
  "logs.subtitle": "Every routed request, with its failover history.",
  "logs.search": "Search logs",
  "logs.loading": "Loading logs…",
  "logs.emptySearch.title": "Nothing matched your search",
  "logs.emptySearch.hint": "Try a different model or provider name.",
  "logs.empty.title": "No requests yet",
  "logs.empty.hint": "Traffic will appear here as soon as requests flow through MixRoute.",
  "logs.request": "Request",
  "logs.streaming": "Streaming",
  "logs.nonStreaming": "Non-streaming",
  "logs.duration": "Duration",
  "logs.failoverChain": "Failover chain",
  "logs.errorHeading": "Error",
  "logs.loadMore": "Show more",
  "logs.loadMoreFailed": "Could not load more",
  "tokens.in": "Tokens (input)",
  "tokens.out": "Tokens (output)",

  /* Playground ------------------------------------------------------------ */
  "playground.subtitle": "A quick chat with a model through the MixRoute router.",
  "playground.loadingModels": "Loading models…",
  "playground.emptyHint": "Create a model with providers — then try it out here.",
  "playground.emptyChat": "Write a message — MixRoute will pick a provider and show the reply right here, token by token.",
  "playground.you": "You",
  "playground.assistant": "Assistant",
  "playground.tokens": "tokens {in}/{out}",
  "playground.failovers": "Failovers:",
  "playground.placeholder": "Type a message…",
  "playground.reset": "Clear",
  "playground.send": "Send",

  /* Provider form ---------------------------------------------------------- */
  "providerForm.edit": "Edit provider",
  "providerForm.create": "Add provider",
  "providerForm.test": "Test connection",
  "providerForm.save": "Save provider",
  "providerForm.presetHint": "A preset fills in the type and base URL — both stay editable.",
  "providerForm.createModelOption": "+ Create a new model…",
  "providerForm.priorityHint": "Used by the priority strategy.",
  "providerForm.newModelName": "New model name",
  "providerForm.upstreamModel": "Provider model",
  "providerForm.upstreamModelHint": "The model name sent to the provider.",
  "providerForm.fetchModels": "Fetch models",
  "providerForm.loaded": ["Loaded {n} model", "Loaded {n} models"],
  "providerForm.apiKey": "API key",
  "providerForm.keepKeyHint": "Leave empty to keep the current key.",
  "preset.custom": "Custom",
  "preset.ollama": "Ollama (local)",

  /* Activity calendar ------------------------------------------------------- */
  "calendar.title": "Activity over 120 days",
  "calendar.loading": "Loading activity…",
  "calendar.activeDays": "Active days:",
  "calendar.totalTokens": "Total tokens:",
  "calendar.totalRequests": "Total requests:",
  "calendar.requestsCount": ["{n} request", "{n} requests"],
  "calendar.tokensCount": ["{n} token", "{n} tokens"],
  "calendar.less": "Less",
  "calendar.more": "More",
  "weekday.mon": "Mon",
  "weekday.tue": "Tue",
  "weekday.wed": "Wed",
  "weekday.thu": "Thu",
  "weekday.fri": "Fri",
  "weekday.sat": "Sat",
  "weekday.sun": "Sun",
  "month.jan": "Jan",
  "month.feb": "Feb",
  "month.mar": "Mar",
  "month.apr": "Apr",
  "month.may": "May",
  "month.jun": "Jun",
  "month.jul": "Jul",
  "month.aug": "Aug",
  "month.sep": "Sep",
  "month.oct": "Oct",
  "month.nov": "Nov",
  "month.dec": "Dec",

  /* Settings page ------------------------------------------------------------ */
  "settings.subtitle": "Routing, credentials and configuration.",
  "settings.saved": "Saved",
  "settings.routing.title": "Routing",
  "settings.routing.desc": "How MixRoute picks a provider for each request.",
  "settings.routing.strategy": "Routing strategy",
  "strategy.roundRobin": "Round robin",
  "strategy.priority": "Priority",
  "strategy.leastUsed": "Least loaded",
  "settings.routing.defaultModel": "Default model",
  "settings.routing.noModel": "None",
  "settings.routing.retries": "Retry count",
  "settings.routing.retriesHint": "How many extra providers to try after a failure.",
  "settings.routing.timeout": "Timeout (ms)",
  "settings.routing.timeoutHint": "Timeout for a request to a single provider.",
  "settings.rate.title": "Rate limiting",
  "settings.rate.desc": "Global limit on incoming requests. 0 — no limit.",
  "settings.rate.rpm": "Requests per minute",
  "settings.advanced": "Advanced",
  "settings.cooldowns.title": "Cooldowns",
  "settings.cooldowns.desc": "How long the router keeps a provider paused after failures.",
  "settings.cooldowns.after429": "After 429 (ms)",
  "settings.cooldowns.after5xx": "After 5xx (ms)",
  "settings.cooldowns.afterTimeout": "After timeout (ms)",
  "settings.health.title": "Provider health checks",
  "settings.health.desc": "Background availability checks when there is no traffic.",
  "settings.health.interval": "Provider health-check interval, ms",
  "settings.health.intervalHint": "0 — disabled. Background provider checks when they carry no traffic.",

  /* API keys ----------------------------------------------------------------- */
  "settings.keys.title": "API keys",
  "settings.keys.desc": "Keys your clients use to talk to the router.",
  "settings.keys.create": "Create key",
  "settings.keys.loading": "Loading keys…",
  "settings.keys.empty.title": "No API keys yet",
  "settings.keys.empty.hint": "Create a key to authenticate requests to the /v1 endpoints.",
  "settings.keys.revoked": "Revoked",
  "settings.keys.never": "Never",
  "settings.keys.revoke": "Revoke",
  "settings.keys.createTitle": "Create an API key",
  "settings.keys.createdTitle": "API key created",
  "settings.keys.nameHint": "Something to help you recognise the key later, e.g. “production”.",
  "settings.keys.copyWarning": "Copy the key now — it is shown only once and will not be available again.",
  "settings.keys.securityWarning": "Treat it like a password: anyone with this key can use your router.",
  "settings.keys.revokeTitle": "Revoke API key",
  "settings.keys.revokeMessage": "Revoke “{name}”? Clients using {prefix}•••••• will immediately start getting 401.",
  "settings.keys.revokeConfirm": "Revoke key",

  /* Configuration export / import -------------------------------------------- */
  "settings.export.title": "Configuration",
  "settings.export.desc": "A backup of models, providers and settings.",
  "settings.export.json": "Export JSON",
  "settings.export.importJson": "Import JSON",
  "settings.export.note": "The export does not include provider API keys — re-enter them after importing.",
  "import.title": "Import configuration",
  "import.merge": "Merge",
  "import.mergeHint": "add what is missing",
  "import.replace": "Replace",
  "import.replaceHint": "remove current models and import",
  "import.invalidJson": "The file is not valid JSON.",
  "import.emptyFile": "The file is empty or corrupted.",
  "import.version": "Unsupported config file version — expected 1.",
  "import.noModels": "The file contains no model list.",
  "import.readFile": "Could not read the file.",
  "import.imported": "Imported:",
  "import.errors": "Errors:",
  "import.keysWarning": "API keys are not carried over — you will need to re-enter them",
  "import.confirm": "Import",

  /* Plural building blocks ------------------------------------------------------ */
  "count.models": ["model", "models"],
  "count.providers": ["provider", "providers"],
  "count.requests": ["request", "requests"],
  "count.tokens": ["token", "tokens"],
};

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = "mixroute.lang";
const listeners = new Set<() => void>();

function readLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "ru") return stored;
  } catch {
    /* storage unavailable */
  }
  return "ru";
}

let currentLang: Lang = readLang();

try {
  document.documentElement.lang = currentLang;
} catch {
  /* no DOM */
}

export function getLang(): Lang {
  return currentLang;
}

export function setLang(next: Lang): void {
  if (next === currentLang) return;
  currentLang = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* storage unavailable */
  }
  try {
    document.documentElement.lang = next;
  } catch {
    /* no DOM */
  }
  listeners.forEach((notify) => notify());
}

/* ------------------------------------------------------------------ */
/* Translation                                                         */
/* ------------------------------------------------------------------ */

const numberFormats: Record<Lang, Intl.NumberFormat> = {
  ru: new Intl.NumberFormat("ru-RU"),
  en: new Intl.NumberFormat("en-US"),
};

/** Russian plural rules: forms are [one, few, many]. */
function ruFormIndex(value: number): 0 | 1 | 2 {
  const abs = Math.abs(value) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return 2;
  if (last === 1) return 0;
  if (last > 1 && last < 5) return 1;
  return 2;
}

function pickForm(forms: readonly string[], lang: Lang, n: number): string {
  if (forms.length <= 1) return forms[0] ?? "";
  if (lang === "en") return Math.abs(n) === 1 ? (forms[0] ?? "") : (forms[forms.length - 1] ?? "");
  return forms[ruFormIndex(n)] ?? forms[forms.length - 1] ?? "";
}

function interpolate(template: string, lang: Lang, vars?: TVars): string {
  if (vars === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    if (value === undefined) return match;
    return typeof value === "number" ? numberFormats[lang].format(value) : value;
  });
}

function translateFor(lang: Lang, key: TranslationKey, vars?: TVars): string {
  const dict = lang === "en" ? en : ru;
  const value: string | readonly string[] | undefined = dict[key];
  if (value === undefined) return key;

  let template: string;
  if (typeof value === "string") {
    template = value;
  } else {
    const n = typeof vars?.n === "number" ? vars.n : Number(vars?.n ?? 0);
    template = pickForm(value, lang, Number.isNaN(n) ? 0 : n);
  }
  return interpolate(template, lang, vars);
}

/** Standalone translator for non-component code (api, format, hooks). */
export function t(key: TranslationKey, vars?: TVars): string {
  return translateFor(currentLang, key, vars);
}

export type TFn = (key: TranslationKey, vars?: TVars) => string;

export interface TApi {
  t: TFn;
  lang: Lang;
  setLang: (lang: Lang) => void;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): Lang {
  return currentLang;
}

/** React hook: re-renders the component whenever the language changes. */
export function useT(): TApi {
  const lang = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const translate = useCallback<TFn>(
    (key, vars) => translateFor(lang, key, vars),
    [lang],
  );
  return { t: translate, lang, setLang };
}
