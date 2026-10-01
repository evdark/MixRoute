import clsx from "clsx";
import { Download, RefreshCw, Upload } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { api } from "../api";
import {
  Badge,
  Button,
  CopyButton,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Loading,
  Modal,
  Select,
} from "../components";
import { formatDateTime, timeAgo } from "../format";
import { t, useT, type TranslationKey } from "../i18n";
import { useAction, useApi } from "../hooks";
import type {
  ApiKey,
  ExportConfig,
  ImportMode,
  ImportResponse,
  Model,
  Settings,
} from "../types";

interface Draft {
  routing_strategy: Settings["routing_strategy"];
  default_model: string;
  retry_count: string;
  timeout_ms: string;
  cooldown_429_ms: string;
  cooldown_5xx_ms: string;
  cooldown_timeout_ms: string;
  rate_limit_rpm: string;
  health_check_interval_ms: string;
}

function toDraft(settings: Settings): Draft {
  return {
    routing_strategy: settings.routing_strategy,
    default_model: settings.default_model,
    retry_count: String(settings.retry_count),
    timeout_ms: String(settings.timeout_ms),
    cooldown_429_ms: String(settings.cooldown_429_ms),
    cooldown_5xx_ms: String(settings.cooldown_5xx_ms),
    cooldown_timeout_ms: String(settings.cooldown_timeout_ms),
    rate_limit_rpm: String(settings.rate_limit_rpm),
    health_check_interval_ms: settings.health_check_interval_ms ?? "0",
  };
}

function toNumber(value: string): number {
  const trimmed = value.trim();
  if (trimmed === "") return 0;
  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? 0 : parsed;
}

const IMPORT_MODES: { value: ImportMode; titleKey: TranslationKey; hintKey: TranslationKey }[] = [
  { value: "merge", titleKey: "import.merge", hintKey: "import.mergeHint" },
  { value: "replace", titleKey: "import.replace", hintKey: "import.replaceHint" },
];

/** Minimal validation of a picked config file before offering the import. */
function parseImportFile(raw: string): { data: ExportConfig } | { error: TranslationKey } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: "import.invalidJson" };
  }
  if (parsed === null || typeof parsed !== "object") {
    return { error: "import.emptyFile" };
  }
  const record = parsed as Record<string, unknown>;
  if (record.version !== 1) {
    return { error: "import.version" };
  }
  if (!Array.isArray(record.models)) {
    return { error: "import.noModels" };
  }
  return { data: parsed as ExportConfig };
}

function SectionCard({
  title,
  description,
  footer,
  children,
}: {
  title: string;
  description?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="border-b border-zinc-100 px-5 py-4 dark:border-zinc-800/70">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-zinc-500">{description}</p>}
      </div>
      <div className="space-y-4 px-5 py-4">{children}</div>
      {footer && (
        <div className="flex items-center justify-end gap-3 border-t border-zinc-100 px-5 py-3 dark:border-zinc-800/70">
          {footer}
        </div>
      )}
    </section>
  );
}

function SavedFlag({ visible }: { visible: boolean }) {
  const { t } = useT();
  return (
    <span
      className={clsx(
        "text-xs font-medium text-emerald-600 transition-opacity dark:text-emerald-400",
        visible ? "opacity-100" : "opacity-0",
      )}
    >
      {t("settings.saved")}
    </span>
  );
}

export default function SettingsPage() {
  const { t } = useT();
  const settingsQuery = useApi<{ settings: Settings }>("/admin/api/settings");
  const modelsQuery = useApi<{ models: Model[] }>("/admin/api/models");
  const keysQuery = useApi<{ keys: ApiKey[] }>("/admin/api/keys");

  const [draft, setDraft] = useState<Draft | null>(null);
  const [savedSection, setSavedSection] = useState<string | null>(null);
  const [revokeSpec, setRevokeSpec] = useState<ApiKey | null>(null);
  const [keyModalOpen, setKeyModalOpen] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const importFileRef = useRef<HTMLInputElement>(null);
  const [importData, setImportData] = useState<ExportConfig | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>("merge");
  const [importResult, setImportResult] = useState<ImportResponse | null>(null);
  const [importFileError, setImportFileError] = useState<TranslationKey | null>(null);

  useEffect(() => {
    if (settingsQuery.data && draft === null) {
      setDraft(toDraft(settingsQuery.data.settings));
    }
  }, [settingsQuery.data, draft]);

  useEffect(() => {
    if (savedSection === null) return;
    const timer = window.setTimeout(() => setSavedSection(null), 2500);
    return () => window.clearTimeout(timer);
  }, [savedSection]);

  const models = modelsQuery.data?.models ?? [];
  const keys = keysQuery.data?.keys ?? [];

  function patch(values: Partial<Draft>) {
    setDraft((previous) => (previous ? { ...previous, ...values } : previous));
  }

  const saveRouting = useAction(async () => {
    if (!draft) return;
    await api("/admin/api/settings", {
      method: "PUT",
      body: {
        routing_strategy: draft.routing_strategy,
        default_model: draft.default_model,
        retry_count: toNumber(draft.retry_count),
        timeout_ms: toNumber(draft.timeout_ms),
      },
    });
    setSavedSection("routing");
  });

  const saveCooldowns = useAction(async () => {
    if (!draft) return;
    await api("/admin/api/settings", {
      method: "PUT",
      body: {
        cooldown_429_ms: toNumber(draft.cooldown_429_ms),
        cooldown_5xx_ms: toNumber(draft.cooldown_5xx_ms),
        cooldown_timeout_ms: toNumber(draft.cooldown_timeout_ms),
      },
    });
    setSavedSection("cooldowns");
  });

  const saveRateLimit = useAction(async () => {
    if (!draft) return;
    await api("/admin/api/settings", {
      method: "PUT",
      body: { rate_limit_rpm: toNumber(draft.rate_limit_rpm) },
    });
    setSavedSection("rate");
  });

  const saveHealth = useAction(async () => {
    if (!draft) return;
    await api("/admin/api/settings", {
      method: "PUT",
      body: { health_check_interval_ms: String(toNumber(draft.health_check_interval_ms)) },
    });
    setSavedSection("health");
  });

  const exportConfig = useAction(async () => {
    const data = await api<ExportConfig>("/admin/api/export");
    const stamp = new Date().toISOString().slice(0, 10);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `mixroute-config-${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });

  const importConfig = useAction(async (mode: ImportMode, data: ExportConfig) =>
    api<ImportResponse>("/admin/api/import", { method: "POST", body: { mode, data } }),
  );

  const createKey = useAction(async (name: string) =>
    api<{ key: string; record: ApiKey }>("/admin/api/keys", {
      method: "POST",
      body: { name },
    }),
  );

  const revokeKey = useAction(async (key: ApiKey) => {
    await api(`/admin/api/keys/${key.id}`, { method: "DELETE" });
  });

  async function submitNewKey() {
    const name = keyName.trim();
    if (name === "") return;
    const outcome = await createKey.run(name);
    if (outcome.ok && outcome.data) {
      setCreatedKey(outcome.data.key);
      keysQuery.reload();
    }
  }

  async function runRevoke() {
    if (!revokeSpec) return;
    const outcome = await revokeKey.run(revokeSpec);
    if (outcome.ok) {
      setRevokeSpec(null);
      keysQuery.reload();
    }
  }

  function closeKeyModal() {
    setKeyModalOpen(false);
    setCreatedKey(null);
    setKeyName("");
  }

  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImportFileError(null);
    setImportResult(null);

    let raw: string;
    try {
      raw = await file.text();
    } catch {
      setImportFileError("import.readFile");
      return;
    }

    const parsed = parseImportFile(raw);
    if ("error" in parsed) {
      setImportFileError(parsed.error);
      return;
    }
    setImportMode("merge");
    setImportData(parsed.data);
  }

  async function runImport() {
    if (!importData) return;
    const outcome = await importConfig.run(importMode, importData);
    if (outcome.ok && outcome.data) {
      setImportResult(outcome.data);
      modelsQuery.reload();
    }
  }

  function closeImportModal() {
    setImportData(null);
    setImportResult(null);
    setImportFileError(null);
  }

  const loading = settingsQuery.loading && draft === null;
  const error = settingsQuery.error ?? modelsQuery.error ?? keysQuery.error;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t("nav.settings")}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">{t("settings.subtitle")}</p>
        </div>
        <Button
          variant="ghost"
          onClick={() => {
            settingsQuery.reload();
            modelsQuery.reload();
            keysQuery.reload();
          }}
          aria-label={t("a11y.refreshSettings")}
          className="px-2"
        >
          <RefreshCw aria-hidden className="h-4 w-4" />
        </Button>
      </div>

      {error && <ErrorNote message={error} onRetry={() => settingsQuery.reload()} />}
      {loading && <Loading />}

      {draft && (
        <div className="space-y-6">
          {/* ---------------------------------------------------------- */}
          {/* Routing                                                    */}
          {/* ---------------------------------------------------------- */}
          <SectionCard
            title={t("settings.routing.title")}
            description={t("settings.routing.desc")}
            footer={
              <>
                <SavedFlag visible={savedSection === "routing"} />
                <Button
                  variant="primary"
                  size="sm"
                  onClick={saveRouting.run}
                  pending={saveRouting.pending}
                >
                  {t("common.save")}
                </Button>
              </>
            }
          >
            {saveRouting.error && (
              <p className="text-xs text-red-600 dark:text-red-400">{saveRouting.error}</p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("settings.routing.strategy")}>
                <Select
                  value={draft.routing_strategy}
                  onChange={(event) =>
                    patch({ routing_strategy: event.target.value as Settings["routing_strategy"] })
                  }
                >
                  <option value="round_robin">{t("strategy.roundRobin")}</option>
                  <option value="priority">{t("strategy.priority")}</option>
                  <option value="least_used">{t("strategy.leastUsed")}</option>
                </Select>
              </Field>
              <Field label={t("settings.routing.defaultModel")}>
                <Select
                  value={draft.default_model}
                  onChange={(event) => patch({ default_model: event.target.value })}
                >
                  <option value="">{t("settings.routing.noModel")}</option>
                  {!models.some((model) => model.name === draft.default_model) &&
                    draft.default_model !== "" && (
                      <option value={draft.default_model}>{draft.default_model}</option>
                    )}
                  {models.map((model) => (
                    <option key={model.id} value={model.name}>
                      {model.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={t("settings.routing.retries")}
                hint={t("settings.routing.retriesHint")}
              >
                <Input
                  type="number"
                  min={0}
                  value={draft.retry_count}
                  onChange={(event) => patch({ retry_count: event.target.value })}
                />
              </Field>
              <Field
                label={t("settings.routing.timeout")}
                hint={t("settings.routing.timeoutHint")}
              >
                <Input
                  type="number"
                  min={0}
                  value={draft.timeout_ms}
                  onChange={(event) => patch({ timeout_ms: event.target.value })}
                />
              </Field>
            </div>
          </SectionCard>

          {/* ---------------------------------------------------------- */}
          {/* Rate limiting                                               */}
          {/* ---------------------------------------------------------- */}
          <SectionCard
            title={t("settings.rate.title")}
            description={t("settings.rate.desc")}
            footer={
              <>
                <SavedFlag visible={savedSection === "rate"} />
                <Button
                  variant="primary"
                  size="sm"
                  onClick={saveRateLimit.run}
                  pending={saveRateLimit.pending}
                >
                  {t("common.save")}
                </Button>
              </>
            }
          >
            {saveRateLimit.error && (
              <p className="text-xs text-red-600 dark:text-red-400">{saveRateLimit.error}</p>
            )}
            <div className="max-w-56">
              <Field label={t("settings.rate.rpm")}>
                <Input
                  type="number"
                  min={0}
                  placeholder="0"
                  value={draft.rate_limit_rpm}
                  onChange={(event) => patch({ rate_limit_rpm: event.target.value })}
                />
              </Field>
            </div>
          </SectionCard>

          {/* ---------------------------------------------------------- */}
          {/* Advanced                                                    */}
          {/* ---------------------------------------------------------- */}
          <div className="flex items-center gap-3 pt-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              {t("settings.advanced")}
            </span>
            <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
          </div>

          <SectionCard
            title={t("settings.cooldowns.title")}
            description={t("settings.cooldowns.desc")}
            footer={
              <>
                <SavedFlag visible={savedSection === "cooldowns"} />
                <Button
                  variant="primary"
                  size="sm"
                  onClick={saveCooldowns.run}
                  pending={saveCooldowns.pending}
                >
                  {t("common.save")}
                </Button>
              </>
            }
          >
            {saveCooldowns.error && (
              <p className="text-xs text-red-600 dark:text-red-400">{saveCooldowns.error}</p>
            )}
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t("settings.cooldowns.after429")}>
                <Input
                  type="number"
                  min={0}
                  value={draft.cooldown_429_ms}
                  onChange={(event) => patch({ cooldown_429_ms: event.target.value })}
                />
              </Field>
              <Field label={t("settings.cooldowns.after5xx")}>
                <Input
                  type="number"
                  min={0}
                  value={draft.cooldown_5xx_ms}
                  onChange={(event) => patch({ cooldown_5xx_ms: event.target.value })}
                />
              </Field>
              <Field label={t("settings.cooldowns.afterTimeout")}>
                <Input
                  type="number"
                  min={0}
                  value={draft.cooldown_timeout_ms}
                  onChange={(event) => patch({ cooldown_timeout_ms: event.target.value })}
                />
              </Field>
            </div>
          </SectionCard>

          <SectionCard
            title={t("settings.health.title")}
            description={t("settings.health.desc")}
            footer={
              <>
                <SavedFlag visible={savedSection === "health"} />
                <Button
                  variant="primary"
                  size="sm"
                  onClick={saveHealth.run}
                  pending={saveHealth.pending}
                >
                  {t("common.save")}
                </Button>
              </>
            }
          >
            {saveHealth.error && (
              <p className="text-xs text-red-600 dark:text-red-400">{saveHealth.error}</p>
            )}
            <div className="max-w-56">
              <Field label={t("settings.health.interval")} hint={t("settings.health.intervalHint")}>
                <Input
                  type="number"
                  min={0}
                  placeholder="0"
                  value={draft.health_check_interval_ms}
                  onChange={(event) => patch({ health_check_interval_ms: event.target.value })}
                />
              </Field>
            </div>
          </SectionCard>

          {/* ---------------------------------------------------------- */}
          {/* API keys                                                    */}
          {/* ---------------------------------------------------------- */}
          <SectionCard
            title={t("settings.keys.title")}
            description={t("settings.keys.desc")}
            footer={
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setKeyModalOpen(true);
                  setCreatedKey(null);
                  setKeyName("");
                }}
              >
                {t("settings.keys.create")}
              </Button>
            }
          >
            {keysQuery.loading && keys.length === 0 ? (
              <Loading label={t("settings.keys.loading")} />
            ) : keys.length === 0 ? (
              <EmptyState
                title={t("settings.keys.empty.title")}
                hint={t("settings.keys.empty.hint")}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-100 text-xs font-medium text-zinc-500 dark:border-zinc-800/70">
                      <th className="pb-2 pr-4 font-medium">{t("table.name")}</th>
                      <th className="pb-2 pr-4 font-medium">{t("table.key")}</th>
                      <th className="pb-2 pr-4 font-medium">{t("table.created")}</th>
                      <th className="pb-2 pr-4 font-medium">{t("table.lastUsed")}</th>
                      <th className="pb-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
                    {keys.map((key) => (
                      <tr key={key.id}>
                        <td className="py-2.5 pr-4">
                          <span className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                            {key.name}
                            {key.revoked === 1 && (
                              <Badge tone="danger">{t("settings.keys.revoked")}</Badge>
                            )}
                          </span>
                        </td>
                        <td className="py-2.5 pr-4 font-mono text-xs text-zinc-500">
                          {key.prefix}••••••
                        </td>
                        <td
                          className="py-2.5 pr-4 text-xs text-zinc-500"
                          title={formatDateTime(key.created_at)}
                        >
                          {timeAgo(key.created_at)}
                        </td>
                        <td
                          className="py-2.5 pr-4 text-xs text-zinc-500"
                          title={
                            key.last_used_at === null ? undefined : formatDateTime(key.last_used_at)
                          }
                        >
                          {key.last_used_at === null ? t("settings.keys.never") : timeAgo(key.last_used_at)}
                        </td>
                        <td className="py-2.5 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={key.revoked === 1 || revokeKey.pending}
                            onClick={() => setRevokeSpec(key)}
                          >
                            {t("settings.keys.revoke")}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          {/* ---------------------------------------------------------- */}
          {/* Configuration export / import                               */}
          {/* ---------------------------------------------------------- */}
          <SectionCard
            title={t("settings.export.title")}
            description={t("settings.export.desc")}
          >
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="secondary"
                icon={<Download aria-hidden className="h-4 w-4" />}
                onClick={exportConfig.run}
                pending={exportConfig.pending}
              >
                {t("settings.export.json")}
              </Button>
              <Button
                variant="secondary"
                icon={<Upload aria-hidden className="h-4 w-4" />}
                onClick={() => importFileRef.current?.click()}
                disabled={importConfig.pending}
              >
                {t("settings.export.importJson")}
              </Button>
              <input
                ref={importFileRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={handleImportFile}
              />
            </div>
            <p className="text-xs text-zinc-500">{t("settings.export.note")}</p>
            {exportConfig.error && (
              <p className="text-xs text-red-600 dark:text-red-400">{exportConfig.error}</p>
            )}
            {importFileError && (
              <p className="text-xs text-red-600 dark:text-red-400">{t(importFileError)}</p>
            )}
          </SectionCard>

        </div>
      )}

      {/* Create key modal (full key shown once). */}
      {keyModalOpen && (
        <Modal
          open
          onClose={closeKeyModal}
          title={createdKey ? t("settings.keys.createdTitle") : t("settings.keys.createTitle")}
          width="sm"
          footer={
            createdKey ? (
              <Button variant="primary" onClick={closeKeyModal}>
                {t("common.done")}
              </Button>
            ) : (
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={closeKeyModal} disabled={createKey.pending}>
                  {t("common.cancel")}
                </Button>
                <Button
                  variant="primary"
                  onClick={submitNewKey}
                  pending={createKey.pending}
                  disabled={keyName.trim() === ""}
                >
                  {t("settings.keys.create")}
                </Button>
              </div>
            )
          }
        >
          {createdKey ? (
            <div className="space-y-3">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {t("settings.keys.copyWarning")}
              </p>
              <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
                <code className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-800 dark:text-zinc-200">
                  {createdKey}
                </code>
                <CopyButton text={createdKey} />
              </div>
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {t("settings.keys.securityWarning")}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <Field label={t("common.name")} hint={t("settings.keys.nameHint")}>
                <Input
                  autoFocus
                  placeholder="production"
                  value={keyName}
                  onChange={(event) => setKeyName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") submitNewKey();
                  }}
                />
              </Field>
              {createKey.error && (
                <p className="text-xs text-red-600 dark:text-red-400">{createKey.error}</p>
              )}
            </div>
          )}
        </Modal>
      )}

      {revokeSpec && (
        <Modal
          open
          onClose={() => setRevokeSpec(null)}
          title={t("settings.keys.revokeTitle")}
          width="sm"
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setRevokeSpec(null)}>
                {t("common.cancel")}
              </Button>
              <Button variant="danger" onClick={runRevoke} pending={revokeKey.pending}>
                {t("settings.keys.revokeConfirm")}
              </Button>
            </div>
          }
        >
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {t("settings.keys.revokeMessage", {
              name: revokeSpec.name,
              prefix: revokeSpec.prefix,
            })}
          </p>
          {revokeKey.error && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">{revokeKey.error}</p>
          )}
        </Modal>
      )}

      {/* Import config modal (mode choice + result). */}
      {importData && (
        <Modal
          open
          onClose={closeImportModal}
          title={t("import.title")}
          width="md"
          footer={
            importResult ? (
              <div className="flex justify-end">
                <Button variant="primary" onClick={closeImportModal}>
                  {t("common.done")}
                </Button>
              </div>
            ) : (
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={closeImportModal} disabled={importConfig.pending}>
                  {t("common.cancel")}
                </Button>
                <Button
                  variant="primary"
                  onClick={runImport}
                  pending={importConfig.pending}
                >
                  {t("import.confirm")}
                </Button>
              </div>
            )
          }
        >
          {importResult ? (
            <div className="space-y-3">
              <p className="text-sm text-zinc-700 dark:text-zinc-300">
                {t("import.imported")} {t("count.models", { n: importResult.imported.models })},{" "}
                {t("count.providers", { n: importResult.imported.providers })}
              </p>
              {importResult.errors.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    {t("import.errors")}
                  </p>
                  <ul className="mt-1 space-y-1">
                    {importResult.errors.map((message, index) => (
                      <li
                        key={index}
                        className="text-xs text-amber-600 dark:text-amber-400"
                      >
                        {message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                {IMPORT_MODES.map((option) => (
                  <label
                    key={option.value}
                    className={clsx(
                      "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                      importMode === option.value
                        ? "border-zinc-400 bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800"
                        : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700",
                    )}
                  >
                    <input
                      type="radio"
                      name="mixroute-import-mode"
                      className="mt-0.5"
                      checked={importMode === option.value}
                      onChange={() => setImportMode(option.value)}
                    />
                    <span>
                      <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {t(option.titleKey)}
                      </span>
                      <span className="block text-xs text-zinc-500">{t(option.hintKey)}</span>
                    </span>
                  </label>
                ))}
              </div>

              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400">
                {t("import.keysWarning")}
              </p>

              {importConfig.error && (
                <p className="text-xs text-red-600 dark:text-red-400">{importConfig.error}</p>
              )}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
