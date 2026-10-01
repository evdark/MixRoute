import clsx from "clsx";
import { Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import {
  Badge,
  Button,
  Confirm,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Loading,
  Modal,
  ProviderForm,
  statusMeta,
  Toggle,
  type TestResponse,
} from "../components";
import { formatCost, formatLatency } from "../format";
import { useT, type TranslationKey, type TVars } from "../i18n";
import { useAction, useApi } from "../hooks";
import type { Model, Provider } from "../types";

/* ------------------------------------------------------------------ */
/* Model create / edit modal                                           */
/* ------------------------------------------------------------------ */

interface ModelModalProps {
  mode: "create" | "edit";
  initial?: Model;
  onSaved: () => void;
  onClose: () => void;
}

function parseCost(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function ModelModal({ mode, initial, onSaved, onClose }: ModelModalProps) {
  const { t } = useT();
  const [name, setName] = useState(initial?.name ?? "");
  const [inputCost, setInputCost] = useState(initial ? String(initial.input_cost) : "");
  const [outputCost, setOutputCost] = useState(initial ? String(initial.output_cost) : "");
  const [aliasesText, setAliasesText] = useState("");

  const save = useAction(async () => {
    const parsedInput = parseCost(inputCost);
    const parsedOutput = parseCost(outputCost);

    if (mode === "edit" && initial) {
      return api<{ model: Model }>(`/admin/api/models/${initial.id}`, {
        method: "PATCH",
        body: {
          name: name.trim(),
          ...(parsedInput === undefined ? {} : { input_cost: parsedInput }),
          ...(parsedOutput === undefined ? {} : { output_cost: parsedOutput }),
        },
      });
    }

    const aliases = aliasesText
      .split(",")
      .map((alias) => alias.trim())
      .filter((alias) => alias.length > 0);

    return api<{ model: Model }>("/admin/api/models", {
      method: "POST",
      body: {
        name: name.trim(),
        ...(parsedInput === undefined ? {} : { input_cost: parsedInput }),
        ...(parsedOutput === undefined ? {} : { output_cost: parsedOutput }),
        ...(aliases.length > 0 ? { aliases } : {}),
      },
    });
  });

  async function submit() {
    const outcome = await save.run();
    if (outcome.ok) onSaved();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === "edit" ? t("modelModal.edit") : t("modelModal.create")}
      width="sm"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={save.pending}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            pending={save.pending}
            disabled={name.trim() === ""}
          >
            {mode === "edit" ? t("modelModal.saveEdit") : t("modelModal.saveCreate")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label={t("common.name")}>
          <Input
            autoFocus
            placeholder="claude-opus-5.5"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label={t("modelModal.inputCost")}>
            <Input
              type="number"
              min={0}
              step="0.0001"
              placeholder="0.0030"
              value={inputCost}
              onChange={(event) => setInputCost(event.target.value)}
            />
          </Field>
          <Field label={t("modelModal.outputCost")}>
            <Input
              type="number"
              min={0}
              step="0.0001"
              placeholder="0.0150"
              value={outputCost}
              onChange={(event) => setOutputCost(event.target.value)}
            />
          </Field>
        </div>

        {mode === "create" && (
          <Field label={t("modelModal.aliases")} hint={t("modelModal.aliasesHint")}>
            <Input
              placeholder="opus-5.5, opus"
              value={aliasesText}
              onChange={(event) => setAliasesText(event.target.value)}
            />
          </Field>
        )}

        {save.error && <p className="text-xs text-red-600 dark:text-red-400">{save.error}</p>}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Provider row (inside a model card)                                  */
/* ------------------------------------------------------------------ */

interface ProviderRowProps {
  provider: Provider;
  testResult?: { ok: boolean; text: string };
  testing: boolean;
  toggling: boolean;
  onTest: () => void;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}

function ProviderRow({
  provider,
  testResult,
  testing,
  toggling,
  onTest,
  onToggle,
  onEdit,
  onDelete,
}: ProviderRowProps) {
  const { t } = useT();
  const meta = statusMeta(provider.status);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-zinc-100 px-4 py-3 dark:border-zinc-800/70 sm:px-5">
      <div className="min-w-0 flex-1 basis-56">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {provider.name}
          </span>
          <Badge tone="default">{provider.type}</Badge>
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-zinc-500">
          <span className="truncate" title={provider.base_url}>
            {provider.base_url}
          </span>
          <span className="shrink-0 text-zinc-300 dark:text-zinc-600">·</span>
          <span className="truncate font-mono" title={provider.upstream_model}>
            {provider.upstream_model}
          </span>
        </div>
      </div>

      <span className="flex shrink-0 items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
        <span className={clsx("h-1.5 w-1.5 rounded-full", meta.dot)} />
        {meta.label}
      </span>

      <span
        className="shrink-0 text-xs tabular-nums text-zinc-500"
        title={t("providerRow.priority", { n: provider.priority })}
      >
        P{provider.priority}
      </span>

      <Toggle
        checked={provider.enabled === 1}
        onChange={onToggle}
        disabled={toggling}
        label={t("providerRow.enable", { name: provider.name })}
      />

      <div className="flex shrink-0 items-center gap-2">
        {testResult && (
          <span
            className={clsx(
              "max-w-40 truncate text-xs font-medium",
              testResult.ok
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400",
            )}
            title={testResult.text}
          >
            {testResult.text}
          </span>
        )}
        <Button size="sm" variant="secondary" onClick={onTest} pending={testing}>
          {t("common.test")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="px-1.5"
          aria-label={t("a11y.edit", { name: provider.name })}
          onClick={onEdit}
        >
          <Pencil aria-hidden className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="px-1.5"
          aria-label={t("a11y.delete", { name: provider.name })}
          onClick={onDelete}
        >
          <Trash2 aria-hidden className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

interface ModelModalState {
  mode: "create" | "edit";
  model?: Model;
}

interface ProviderModalState {
  mode: "create" | "edit";
  modelId?: number;
  provider?: Provider;
}

interface ConfirmSpec {
  titleKey: TranslationKey;
  messageKey: TranslationKey;
  vars?: TVars;
  action: () => Promise<unknown>;
}

export default function ModelsPage() {
  const { t } = useT();
  const { data, error, loading, reload } = useApi<{ models: Model[] }>("/admin/api/models");
  const models = data?.models ?? [];

  const [modelModal, setModelModal] = useState<ModelModalState | null>(null);
  const [providerModal, setProviderModal] = useState<ProviderModalState | null>(null);
  const [confirmSpec, setConfirmSpec] = useState<ConfirmSpec | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [aliasOpen, setAliasOpen] = useState<number | null>(null);
  const [aliasDraft, setAliasDraft] = useState("");
  const [tests, setTests] = useState<Record<number, { ok: boolean; text: string }>>({});

  const confirmAction = useAction(async () => {
    if (!confirmSpec) return;
    await confirmSpec.action();
  });

  const toggleProvider = useAction(async (provider: Provider, enabled: boolean) => {
    await api(`/admin/api/providers/${provider.id}`, {
      method: "PATCH",
      body: { enabled: enabled ? 1 : 0 },
    });
    reload();
  });

  const testProvider = useAction(async (provider: Provider) => {
    const result = await api<TestResponse>(`/admin/api/providers/${provider.id}/test`, {
      method: "POST",
    });
    setTests((previous) => ({
      ...previous,
      [provider.id]: result.ok
        ? { ok: true, text: `✓ ${formatLatency(result.latency_ms)}` }
        : { ok: false, text: `✗ ${result.error ?? t("error.noConnection")}` },
    }));
    return result;
  });

  const addAlias = useAction(async (modelId: number, alias: string) => {
    await api(`/admin/api/models/${modelId}/aliases`, {
      method: "POST",
      body: { alias },
    });
  });

  const removeAlias = useAction(async (alias: string) => {
    await api(`/admin/api/aliases/${encodeURIComponent(alias)}`, { method: "DELETE" });
  });

  async function runConfirm() {
    const outcome = await confirmAction.run();
    if (outcome.ok) {
      setConfirmSpec(null);
      setActionError(null);
      reload();
    } else {
      setActionError(outcome.error ?? t("error.actionFailed"));
    }
  }

  async function submitAlias(modelId: number) {
    const alias = aliasDraft.trim();
    if (alias === "") return;
    const outcome = await addAlias.run(modelId, alias);
    if (outcome.ok) {
      setAliasOpen(null);
      setAliasDraft("");
      setActionError(null);
      reload();
    } else {
      setActionError(outcome.error ?? t("models.addAliasFailed"));
    }
  }

  async function deleteAlias(alias: string) {
    const outcome = await removeAlias.run(alias);
    setActionError(outcome.ok ? null : (outcome.error ?? t("models.removeAliasFailed")));
    if (outcome.ok) reload();
  }

  function askDeleteModel(model: Model) {
    setActionError(null);
    setConfirmSpec({
      titleKey: "confirm.deleteModel.title",
      messageKey: "confirm.deleteModel.message",
      vars: { name: model.name },
      action: () => api(`/admin/api/models/${model.id}`, { method: "DELETE" }),
    });
  }

  function askDeleteProvider(provider: Provider) {
    setActionError(null);
    setConfirmSpec({
      titleKey: "confirm.deleteProvider.title",
      messageKey: "confirm.deleteProvider.message",
      vars: { name: provider.name },
      action: async () => {
        await api(`/admin/api/providers/${provider.id}`, { method: "DELETE" });
        reload();
      },
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t("nav.models")}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">{t("models.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            onClick={reload}
            aria-label={t("a11y.refreshModels")}
            className="px-2"
          >
            <RefreshCw aria-hidden className="h-4 w-4" />
          </Button>
          <Button variant="secondary" onClick={() => setModelModal({ mode: "create" })}>
            {t("models.addModel")}
          </Button>
          <Button
            variant="primary"
            onClick={() => setProviderModal({ mode: "create" })}
          >
            {t("models.addProvider")}
          </Button>
        </div>
      </div>

      {actionError && <ErrorNote message={actionError} />}
      {error && <ErrorNote message={error} onRetry={reload} />}
      {loading && !data && <Loading />}

      {data && models.length === 0 && !loading && (
        <EmptyState title={t("empty.noModels")} hint={t("models.emptyHint")} />
      )}

      <div className="space-y-4">
        {models.map((model) => (
          <div
            key={model.id}
            className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5 sm:px-5">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  {model.name}
                </p>
                <p className="mt-0.5 text-xs tabular-nums text-zinc-500">
                  {t("models.costLine", {
                    input: formatCost(model.input_cost),
                    output: formatCost(model.output_cost),
                  })}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="px-1.5"
                  aria-label={t("a11y.edit", { name: model.name })}
                  onClick={() => setModelModal({ mode: "edit", model })}
                >
                  <Pencil aria-hidden className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="px-1.5"
                  aria-label={t("a11y.delete", { name: model.name })}
                  onClick={() => askDeleteModel(model)}
                >
                  <Trash2 aria-hidden className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3 sm:px-5">
              {model.aliases.map((alias) => (
                <Badge key={alias} tone="default" className="font-mono">
                  {alias}
                  <button
                    type="button"
                    aria-label={t("a11y.removeAlias", { alias })}
                    onClick={() => deleteAlias(alias)}
                    className="-mr-1 text-zinc-400 transition-colors hover:text-red-500"
                  >
                    <X aria-hidden className="h-3 w-3" />
                  </button>
                </Badge>
              ))}

              {aliasOpen === model.id ? (
                <form
                  className="flex items-center gap-1.5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitAlias(model.id);
                  }}
                >
                  {/* Plain input: the shared Input is full-width by design. */}
                  <input
                    autoFocus
                    aria-label={t("a11y.newAlias")}
                    placeholder={t("alias.placeholder")}
                    className="h-8 w-36 rounded-lg border border-zinc-200 bg-white px-2.5 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-500/20 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                    value={aliasDraft}
                    onChange={(event) => setAliasDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        setAliasOpen(null);
                        setAliasDraft("");
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    type="submit"
                    pending={addAlias.pending}
                    disabled={aliasDraft.trim() === ""}
                  >
                    {t("common.add")}
                  </Button>
                </form>
              ) : (
                <button
                  type="button"
                  className="rounded-full px-2 py-0.5 text-[11px] font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                  onClick={() => {
                    setAliasOpen(model.id);
                    setAliasDraft("");
                  }}
                >
                  {t("alias.add")}
                </button>
              )}
            </div>

            {model.providers.length === 0 ? (
              <div className="border-t border-zinc-100 px-4 py-4 text-xs text-zinc-500 dark:border-zinc-800/70 sm:px-5">
                {t("models.noProviders")}
              </div>
            ) : (
              model.providers.map((provider) => (
                <ProviderRow
                  key={provider.id}
                  provider={provider}
                  testResult={tests[provider.id]}
                  testing={testProvider.pending}
                  toggling={toggleProvider.pending}
                  onTest={() => testProvider.run(provider)}
                  onToggle={(enabled) => toggleProvider.run(provider, enabled)}
                  onEdit={() =>
                    setProviderModal({ mode: "edit", provider, modelId: provider.model_id })
                  }
                  onDelete={() => askDeleteProvider(provider)}
                />
              ))
            )}

            <div className="border-t border-zinc-100 px-4 py-2.5 dark:border-zinc-800/70 sm:px-5">
              <Button
                size="sm"
                variant="ghost"
                icon={<Plus aria-hidden className="h-3.5 w-3.5" />}
                onClick={() => setProviderModal({ mode: "create", modelId: model.id })}
              >
                {t("models.addProviderPlain")}
              </Button>
            </div>
          </div>
        ))}
      </div>

      {modelModal && (
        <ModelModal
          mode={modelModal.mode}
          initial={modelModal.model}
          onClose={() => setModelModal(null)}
          onSaved={() => {
            setModelModal(null);
            reload();
          }}
        />
      )}

      {providerModal && (
        <ProviderForm
          models={models}
          mode={providerModal.mode}
          initial={providerModal.provider}
          initialModelId={providerModal.modelId}
          onClose={() => setProviderModal(null)}
          onSaved={() => {
            setProviderModal(null);
            reload();
          }}
        />
      )}

      {confirmSpec && (
        <Confirm
          open
          title={t(confirmSpec.titleKey)}
          message={t(confirmSpec.messageKey, confirmSpec.vars)}
          confirmLabel={t(confirmSpec.titleKey)}
          pending={confirmAction.pending}
          onConfirm={runConfirm}
          onClose={() => setConfirmSpec(null)}
        />
      )}
    </div>
  );
}
