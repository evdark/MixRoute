import clsx from "clsx";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { formatLatency } from "../format";
import { useT, type TranslationKey } from "../i18n";
import { useAction } from "../hooks";
import type { Model, Provider } from "../types";
import { Button } from "./Button";
import { Field } from "./Field";
import { Input } from "./Input";
import { Modal } from "./Modal";
import { Select } from "./Select";

export interface TestResponse {
  ok: boolean;
  latency_ms?: number;
  model?: string;
  error?: string;
}

interface FetchModelsResponse {
  models: string[];
  error?: string;
}

type ProviderType = Provider["type"];

const TYPE_OPTIONS: { value: ProviderType; label: string }[] = [
  { value: "openai-compatible", label: "OpenAI-compatible" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "gemini", label: "Gemini" },
];

/** Well-known providers: picking one fills in `type` + `base_url`. */
interface ProviderPreset {
  id: string;
  label?: string;
  labelKey?: TranslationKey;
  type?: ProviderType;
  baseUrl?: string;
}

const PRESETS: ProviderPreset[] = [
  { id: "custom", labelKey: "preset.custom" },
  { id: "openai", label: "OpenAI", type: "openai", baseUrl: "https://api.openai.com/v1" },
  { id: "anthropic", label: "Anthropic", type: "anthropic", baseUrl: "https://api.anthropic.com" },
  {
    id: "gemini",
    label: "Google Gemini",
    type: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    type: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
  },
  {
    id: "groq",
    label: "Groq",
    type: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    type: "openai-compatible",
    baseUrl: "https://api.deepseek.com/v1",
  },
  {
    id: "together",
    label: "Together",
    type: "openai-compatible",
    baseUrl: "https://api.together.xyz/v1",
  },
  {
    id: "mistral",
    label: "Mistral",
    type: "openai-compatible",
    baseUrl: "https://api.mistral.ai/v1",
  },
  {
    id: "ollama",
    labelKey: "preset.ollama",
    type: "openai-compatible",
    baseUrl: "http://localhost:11434/v1",
  },
];

/** Exact (type, base_url) match of a preset, or "custom". */
function presetFor(type: ProviderType, baseUrl: string): string {
  const url = baseUrl.trim();
  const match = PRESETS.find(
    (preset) => preset.type !== undefined && preset.type === type && preset.baseUrl === url,
  );
  return match?.id ?? "custom";
}

const CREATE_MODEL_VALUE = "__create_model__";

export interface ProviderFormProps {
  models: Model[];
  mode: "create" | "edit";
  initial?: Provider;
  initialModelId?: number;
  onSaved: () => void;
  onClose: () => void;
}

/**
 * Shared create/edit provider modal used by both the Models and Providers
 * pages. Handles connection testing, inline model creation and fetching the
 * upstream model list from the provider.
 */
export function ProviderForm({
  models,
  mode,
  initial,
  initialModelId,
  onSaved,
  onClose,
}: ProviderFormProps) {
  const { t } = useT();
  const provider = mode === "edit" ? initial : undefined;

  const [modelId, setModelId] = useState<string>(() => {
    const id = provider?.model_id ?? initialModelId ?? models[0]?.id;
    // Nothing preselectable — default to creating a model so the form stays usable.
    return id === undefined ? CREATE_MODEL_VALUE : String(id);
  });
  const [newModelName, setNewModelName] = useState("");
  const [name, setName] = useState(provider?.name ?? "");
  const [type, setType] = useState<ProviderType>(provider?.type ?? "openai-compatible");
  const [baseUrl, setBaseUrl] = useState(provider?.base_url ?? "");
  // Always starts at the "custom" preset: existing values stay untouched until a preset is chosen.
  const [presetId, setPresetId] = useState("custom");
  const [apiKey, setApiKey] = useState("");
  const [upstreamModel, setUpstreamModel] = useState(provider?.upstream_model ?? "");
  const [priority, setPriority] = useState(provider === undefined ? "" : String(provider.priority));
  const [revealKey, setRevealKey] = useState(false);
  const [result, setResult] = useState<TestResponse | null>(null);
  const [fetched, setFetched] = useState<FetchModelsResponse | null>(null);

  const creatingModel = modelId === CREATE_MODEL_VALUE;

  const test = useAction(async (): Promise<TestResponse> => {
    if (provider && apiKey.trim() === "") {
      return api<TestResponse>(`/admin/api/providers/${provider.id}/test`, { method: "POST" });
    }
    return api<TestResponse>("/admin/api/providers/test", {
      method: "POST",
      body: {
        type,
        base_url: baseUrl.trim(),
        api_key: apiKey,
        upstream_model: upstreamModel.trim(),
      },
    });
  });

  // Without a key in the field we ask the server to use the stored one.
  const fetchModels = useAction(async (): Promise<FetchModelsResponse> => {
    if (provider && apiKey.trim() === "") {
      return api<FetchModelsResponse>(`/admin/api/providers/${provider.id}/fetch-models`, {
        method: "POST",
      });
    }
    return api<FetchModelsResponse>("/admin/api/providers/fetch-models", {
      method: "POST",
      body: { type, base_url: baseUrl.trim(), api_key: apiKey },
    });
  });

  const save = useAction(async () => {
    let targetModelId = Number(modelId);
    if (creatingModel) {
      const created = await api<{ model: Model }>("/admin/api/models", {
        method: "POST",
        body: { name: newModelName.trim() },
      });
      targetModelId = created.model.id;
    }

    const trimmedPriority = priority.trim();
    const parsedPriority =
      trimmedPriority === "" || Number.isNaN(Number(trimmedPriority))
        ? undefined
        : Number(trimmedPriority);

    if (provider) {
      return api<{ provider: Provider }>(`/admin/api/providers/${provider.id}`, {
        method: "PATCH",
        body: {
          model_id: targetModelId,
          name: name.trim(),
          type,
          base_url: baseUrl.trim(),
          upstream_model: upstreamModel.trim(),
          ...(apiKey.trim() === "" ? {} : { api_key: apiKey }),
          ...(parsedPriority === undefined ? {} : { priority: parsedPriority }),
        },
      });
    }

    return api<{ provider: Provider }>("/admin/api/providers", {
      method: "POST",
      body: {
        model_id: targetModelId,
        name: name.trim(),
        type,
        base_url: baseUrl.trim(),
        api_key: apiKey,
        upstream_model: upstreamModel.trim(),
        ...(parsedPriority === undefined ? {} : { priority: parsedPriority }),
        enabled: 1,
      },
    });
  });

  const canTest = baseUrl.trim() !== "" && upstreamModel.trim() !== "";
  // Create mode needs the key in the field; edit mode can fall back to the stored one.
  const canFetch =
    baseUrl.trim() !== "" && (provider !== undefined || apiKey.trim() !== "");
  const canSave =
    name.trim() !== "" &&
    baseUrl.trim() !== "" &&
    upstreamModel.trim() !== "" &&
    (creatingModel ? newModelName.trim() !== "" : modelId !== "");

  async function runTest() {
    const outcome = await test.run();
    if (outcome.ok && outcome.data) setResult(outcome.data);
  }

  async function runFetchModels() {
    const outcome = await fetchModels.run();
    if (outcome.ok && outcome.data) setFetched(outcome.data);
  }

  async function submit() {
    const outcome = await save.run();
    if (outcome.ok) onSaved();
  }

  /** Choosing a preset overwrites type + base_url; both stay editable after. */
  function applyPreset(id: string) {
    setPresetId(id);
    const preset = PRESETS.find((item) => item.id === id);
    if (preset?.type !== undefined && preset.baseUrl !== undefined) {
      setType(preset.type);
      setBaseUrl(preset.baseUrl);
      setFetched(null);
    }
  }

  function pickModel(model: string) {
    setUpstreamModel(model);
  }

  const errorMessage = save.error ?? test.error;
  // The endpoint answers 200 even on failure: models=[] + error text.
  const fetchError = fetchModels.error ?? fetched?.error ?? null;
  const fetchedCount =
    fetched && fetched.models.length > 0
      ? t("providerForm.loaded", { n: fetched.models.length })
      : null;
  const resultText = result
    ? result.ok
      ? `✓ ${formatLatency(result.latency_ms)}`
      : `✗ ${result.error ?? t("error.noConnection")}`
    : null;

  return (
    <Modal
      open
      onClose={onClose}
      title={provider ? t("providerForm.edit") : t("providerForm.create")}
      width="md"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {resultText && (
              <span
                className={
                  result?.ok
                    ? "truncate text-xs font-medium text-emerald-600 dark:text-emerald-400"
                    : "truncate text-xs font-medium text-red-600 dark:text-red-400"
                }
                title={resultText}
              >
                {resultText}
              </span>
            )}
            <Button
              variant="secondary"
              onClick={runTest}
              pending={test.pending}
              disabled={!canTest}
            >
              {t("providerForm.test")}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose} disabled={save.pending}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" onClick={submit} pending={save.pending} disabled={!canSave}>
              {t("providerForm.save")}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label={t("common.provider")} hint={t("providerForm.presetHint")}>
          <Select value={presetId} onChange={(event) => applyPreset(event.target.value)}>
            {PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.labelKey !== undefined ? t(preset.labelKey) : preset.label}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("common.model")}>
            <Select value={modelId} onChange={(event) => setModelId(event.target.value)}>
              {models.map((model) => (
                <option key={model.id} value={String(model.id)}>
                  {model.name}
                </option>
              ))}
              <option value={CREATE_MODEL_VALUE}>{t("providerForm.createModelOption")}</option>
            </Select>
          </Field>
          <Field label={t("table.priority")} hint={t("providerForm.priorityHint")}>
            <Input
              type="number"
              min={0}
              placeholder="1"
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
            />
          </Field>
        </div>

        {creatingModel && (
          <Field label={t("providerForm.newModelName")}>
            <Input
              placeholder="claude-opus-5.5"
              value={newModelName}
              onChange={(event) => setNewModelName(event.target.value)}
              autoFocus
            />
          </Field>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("common.name")}>
            <Input
              placeholder="OpenRouter primary"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label={t("table.type")}>
            <Select
              value={type}
              onChange={(event) => {
                const nextType = event.target.value as ProviderType;
                setType(nextType);
                setPresetId(presetFor(nextType, baseUrl));
                setFetched(null);
              }}
            >
              {TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Base URL">
            <Input
              placeholder="https://api.example.com/v1"
              value={baseUrl}
              onChange={(event) => {
                setBaseUrl(event.target.value);
                setPresetId(presetFor(type, event.target.value));
                setFetched(null);
              }}
            />
          </Field>
          <div>
            <Field
              label={t("providerForm.upstreamModel")}
              hint={t("providerForm.upstreamModelHint")}
            >
              <Input
                placeholder="claude-opus-5.5"
                value={upstreamModel}
                onChange={(event) => setUpstreamModel(event.target.value)}
              />
            </Field>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={runFetchModels}
                pending={fetchModels.pending}
                disabled={!canFetch}
              >
                {t("providerForm.fetchModels")}
              </Button>
              {fetchedCount && (
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  {fetchedCount}
                </span>
              )}
            </div>

            {fetched && fetched.models.length > 0 && (
              <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-800 dark:bg-zinc-950">
                {fetched.models.map((model) => (
                  <button
                    key={model}
                    type="button"
                    onClick={() => pickModel(model)}
                    className={clsx(
                      "block w-full truncate rounded-md px-2 py-1.5 text-left font-mono text-xs transition-colors",
                      model === upstreamModel
                        ? "bg-zinc-200 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                        : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
                    )}
                  >
                    {model}
                  </button>
                ))}
              </div>
            )}

            {fetchError && (
              <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{fetchError}</p>
            )}
          </div>
        </div>

        <Field
          label={t("providerForm.apiKey")}
          hint={provider ? t("providerForm.keepKeyHint") : undefined}
        >
          <span className="relative block">
            <Input
              type={revealKey ? "text" : "password"}
              placeholder="••••••••"
              autoComplete="off"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              className="pr-10"
            />
            <button
              type="button"
              aria-label={revealKey ? t("a11y.hideApiKey") : t("a11y.showApiKey")}
              onClick={() => setRevealKey((value) => !value)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              {revealKey ? <EyeOff aria-hidden className="h-4 w-4" /> : <Eye aria-hidden className="h-4 w-4" />}
            </button>
          </span>
        </Field>

        {errorMessage && (
          <p className="text-xs text-red-600 dark:text-red-400">{errorMessage}</p>
        )}
      </div>
    </Modal>
  );
}
