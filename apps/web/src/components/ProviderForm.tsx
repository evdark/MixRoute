import clsx from "clsx";
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, Plus, Search } from "lucide-react";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { api } from "../api";
import { formatLatency } from "../format";
import { useT, type TranslationKey } from "../i18n";
import { useAction } from "../hooks";
import type { Model, Provider } from "../types";
import { Badge } from "./Badge";
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
  {
    id: "openrouter",
    label: "OpenRouter",
    type: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
  },
  { id: "openai", label: "OpenAI", type: "openai", baseUrl: "https://api.openai.com/v1" },
  { id: "anthropic", label: "Anthropic", type: "anthropic", baseUrl: "https://api.anthropic.com" },
  {
    id: "gemini",
    label: "Google Gemini",
    type: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
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
  { id: "custom", labelKey: "preset.custom" },
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

/** One row of the mapping step: upstream model → your MixRoute model. */
interface Target {
  modelId: string;
  newName: string;
}

export interface ProviderFormProps {
  models: Model[];
  mode: "create" | "edit";
  initial?: Provider;
  initialModelId?: number;
  onSaved: () => void;
  onClose: () => void;
}

/**
 * Shared create/edit provider form used by both the Models and Providers
 * pages.
 *
 * Create mode is a three-step wizard:
 *   ① connection — preset tiles, name, key, base URL
 *   ② pick the upstream models you need (multi-select, search, manual add)
 *   ③ map each picked model onto one of your MixRoute models
 *      (an existing one, or a brand-new model created inline)
 *
 * Edit mode stacks the same sections on one screen and keeps a single
 * upstream model per provider — radio semantics instead of checkboxes.
 *
 * Sections are plain render functions (not nested components) so typing in
 * an input never remounts the field and loses focus.
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
  const creating = mode === "create";

  /* Step 1 — connection ------------------------------------------------ */
  const [step, setStep] = useState(1);
  const [name, setName] = useState(provider?.name ?? "");
  const [type, setType] = useState<ProviderType>(provider?.type ?? "openai-compatible");
  const [baseUrl, setBaseUrl] = useState(provider?.base_url ?? "");
  const [presetId, setPresetId] = useState(
    provider === undefined ? "custom" : presetFor(provider.type, provider.base_url),
  );
  const [apiKey, setApiKey] = useState("");
  const [priority, setPriority] = useState(provider === undefined ? "" : String(provider.priority));
  const [revealKey, setRevealKey] = useState(false);

  /* Step 2/3 — upstream models & their mapping ------------------------- */
  const [selected, setSelected] = useState<string[]>(
    provider === undefined ? [] : [provider.upstream_model],
  );
  const [targets, setTargets] = useState<Record<string, Target>>(() => {
    if (provider === undefined) return {};
    return { [provider.upstream_model]: { modelId: String(provider.model_id), newName: "" } };
  });
  const [fetched, setFetched] = useState<FetchModelsResponse | null>(null);
  const [query, setQuery] = useState("");
  const [manual, setManual] = useState("");
  const [result, setResult] = useState<TestResponse | null>(null);

  /** Sensible default per upstream model: preselected → same-name → new. */
  function defaultTarget(upstream: string): Target {
    if (provider !== undefined) return { modelId: String(provider.model_id), newName: "" };
    if (initialModelId !== undefined) return { modelId: String(initialModelId), newName: "" };
    const sameName = models.find((model) => model.name === upstream);
    if (sameName !== undefined) return { modelId: String(sameName.id), newName: "" };
    return { modelId: CREATE_MODEL_VALUE, newName: upstream };
  }

  function ensureTarget(upstream: string): void {
    if (targets[upstream] !== undefined) return;
    setTargets((prev) => ({ ...prev, [upstream]: defaultTarget(upstream) }));
  }

  function setTarget(upstream: string, next: Target): void {
    setTargets((prev) => ({ ...prev, [upstream]: next }));
  }

  /** Create: checkbox semantics. Edit: radio — one upstream model at a time. */
  function toggleModel(upstream: string): void {
    if (!creating) {
      if (selected[0] === upstream) return;
      setSelected([upstream]);
      ensureTarget(upstream);
      return;
    }
    if (selected.includes(upstream)) {
      setSelected(selected.filter((item) => item !== upstream));
    } else {
      setSelected([...selected, upstream]);
      ensureTarget(upstream);
    }
  }

  function addManual(): void {
    const upstream = manual.trim();
    if (upstream === "") return;
    if (creating) {
      if (!selected.includes(upstream)) {
        setSelected([...selected, upstream]);
        ensureTarget(upstream);
      }
    } else if (selected[0] !== upstream) {
      setSelected([upstream]);
      ensureTarget(upstream);
    }
    setManual("");
  }

  const targetFor = (upstream: string): Target =>
    targets[upstream] ?? defaultTarget(upstream);

  const targetValid = (target: Target): boolean =>
    target.modelId !== CREATE_MODEL_VALUE || target.newName.trim() !== "";

  /* Actions ------------------------------------------------------------ */

  const test = useAction(async (): Promise<TestResponse> => {
    const upstream = selected[0] ?? provider?.upstream_model ?? "";
    if (provider && apiKey.trim() === "") {
      return api<TestResponse>(`/admin/api/providers/${provider.id}/test`, { method: "POST" });
    }
    return api<TestResponse>("/admin/api/providers/test", {
      method: "POST",
      body: {
        type,
        base_url: baseUrl.trim(),
        api_key: apiKey,
        upstream_model: upstream,
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
    const trimmedPriority = priority.trim();
    const parsedPriority =
      trimmedPriority === "" || Number.isNaN(Number(trimmedPriority))
        ? undefined
        : Number(trimmedPriority);
    const priorityPayload = parsedPriority === undefined ? {} : { priority: parsedPriority };

    // Logical-model name → id, created on demand and memoised for this save
    // so two upstream models mapped to one new name share a single model.
    const modelIds = new Map<string, number>(models.map((model) => [model.name, model.id]));
    async function resolveModelId(target: Target): Promise<number> {
      if (target.modelId !== CREATE_MODEL_VALUE) return Number(target.modelId);
      const newName = target.newName.trim();
      const cached = modelIds.get(newName);
      if (cached !== undefined) return cached;
      const created = await api<{ model: Model }>("/admin/api/models", {
        method: "POST",
        body: { name: newName },
      });
      modelIds.set(newName, created.model.id);
      return created.model.id;
    }

    if (provider) {
      const upstream = selected[0] ?? provider.upstream_model;
      const modelId = await resolveModelId(targetFor(upstream));
      return api<{ provider: Provider }>(`/admin/api/providers/${provider.id}`, {
        method: "PATCH",
        body: {
          model_id: modelId,
          name: name.trim(),
          type,
          base_url: baseUrl.trim(),
          upstream_model: upstream,
          ...(apiKey.trim() === "" ? {} : { api_key: apiKey }),
          ...priorityPayload,
        },
      });
    }

    const baseName = name.trim();
    const many = selected.length > 1;
    for (const upstream of selected) {
      const modelId = await resolveModelId(targetFor(upstream));
      await api<{ provider: Provider }>("/admin/api/providers", {
        method: "POST",
        body: {
          model_id: modelId,
          name: many ? `${baseName} · ${upstream}` : baseName,
          type,
          base_url: baseUrl.trim(),
          api_key: apiKey,
          upstream_model: upstream,
          enabled: 1,
          ...priorityPayload,
        },
      });
    }
    return true;
  });

  /* Derived state ------------------------------------------------------ */

  const canFetch = baseUrl.trim() !== "" && (provider !== undefined || apiKey.trim() !== "");
  const canTest = baseUrl.trim() !== "" && selected.length > 0;
  const step1Valid =
    name.trim() !== "" && baseUrl.trim() !== "" && (!creating || apiKey.trim() !== "");
  const step2Valid = selected.length > 0;
  const canSave =
    step1Valid && step2Valid && selected.every((upstream) => targetValid(targetFor(upstream)));

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
  function applyPreset(id: string): void {
    const preset = PRESETS.find((item) => item.id === id);
    setPresetId(id);
    if (preset === undefined) return;
    if (preset.type !== undefined && preset.baseUrl !== undefined) {
      setType(preset.type);
      setBaseUrl(preset.baseUrl);
      setFetched(null);
    }
    // Pre-fill the name with the preset's label while it is empty or still
    // just another preset's label — never overwrite what the user typed.
    const label = preset.labelKey !== undefined ? t(preset.labelKey) : preset.label;
    if (preset.id !== "custom" && label !== undefined) {
      const current = name.trim();
      const isUntouched =
        current === "" ||
        PRESETS.some((item) => {
          const itemLabel = item.labelKey !== undefined ? t(item.labelKey) : item.label;
          return itemLabel !== undefined && itemLabel === current;
        });
      if (isUntouched) setName(label);
    }
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

  const visibleModels = useMemo(() => {
    const all = fetched?.models ?? [];
    const needle = query.trim().toLowerCase();
    const filtered =
      needle === "" ? all : all.filter((model) => model.toLowerCase().includes(needle));
    // Manually added names stay visible even if the provider list omits them.
    const listed = new Set(filtered);
    const extras = selected.filter((item) => !listed.has(item));
    return [...filtered, ...extras];
  }, [fetched, query, selected]);

  const stepLabels = [
    t("providerForm.stepConnect"),
    t("providerForm.stepModels"),
    t("providerForm.stepMapping"),
  ];

  /* Sections (plain render functions — no focus loss on re-render) ------ */

  function section(n: number, title: string, children: ReactNode): ReactNode {
    return (
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/15 text-[10px] font-semibold text-accent">
            {n}
          </span>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-2">{title}</h3>
        </div>
        {children}
      </section>
    );
  }

  function connectionFields(): ReactNode {
    return (
      <>
        <div>
          <span className="mb-1.5 block text-xs font-medium text-ink-2">
            {t("common.provider")}
          </span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {PRESETS.map((preset) => {
              const label = preset.labelKey !== undefined ? t(preset.labelKey) : preset.label;
              const active = presetId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset.id)}
                  className={clsx(
                    "rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                    active
                      ? "border-accent/60 bg-accent/10 font-medium text-ink"
                      : "border-hairline bg-panel-2 text-ink-2 hover:border-ink-3/40 hover:text-ink",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <span className="mt-1.5 block text-xs text-ink-3">{t("providerForm.presetHint")}</span>
        </div>

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

        <Field
          label={t("providerForm.apiKey")}
          hint={provider ? t("providerForm.keepKeyHint") : t("providerForm.keyRequiredHint")}
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
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3 transition-colors hover:text-ink"
            >
              {revealKey ? (
                <EyeOff aria-hidden className="h-4 w-4" />
              ) : (
                <Eye aria-hidden className="h-4 w-4" />
              )}
            </button>
          </span>
        </Field>
      </>
    );
  }

  function modelPickerFields(): ReactNode {
    return (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon={<Search aria-hidden className="h-3.5 w-3.5" />}
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
          <span className="ml-auto text-xs text-ink-3">
            {selected.length > 0
              ? t("providerForm.selectedCount", { n: selected.length })
              : t("providerForm.selectOne")}
          </span>
        </div>

        {fetchError && <p className="text-xs text-red-600 dark:text-red-400">{fetchError}</p>}

        {fetched && fetched.models.length > 0 && (
          <>
            <Input
              aria-label={t("providerForm.searchPlaceholder")}
              placeholder={t("providerForm.searchPlaceholder")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="max-h-56 overflow-y-auto rounded-lg border border-hairline bg-panel-2 p-1">
              {visibleModels.map((model) => {
                const checked = selected.includes(model);
                return (
                  <label
                    key={model}
                    className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-panel"
                  >
                    <input
                      type={creating ? "checkbox" : "radio"}
                      name={creating ? undefined : "upstream-model"}
                      checked={checked}
                      onChange={() => toggleModel(model)}
                      className="h-3.5 w-3.5 shrink-0 accent-emerald-500"
                    />
                    <span
                      className={clsx(
                        "truncate font-mono text-xs",
                        checked ? "text-ink" : "text-ink-2",
                      )}
                    >
                      {model}
                    </span>
                  </label>
                );
              })}
              {visibleModels.length === 0 && (
                <p className="px-2 py-3 text-center text-xs text-ink-3">
                  {t("providerForm.noMatches")}
                </p>
              )}
            </div>
          </>
        )}

        <div className="flex items-center gap-2">
          <Input
            aria-label={t("providerForm.manualPlaceholder")}
            placeholder={t("providerForm.manualPlaceholder")}
            value={manual}
            onChange={(event) => setManual(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addManual();
              }
            }}
            className="flex-1"
          />
          <Button
            size="sm"
            variant="secondary"
            icon={<Plus aria-hidden className="h-3.5 w-3.5" />}
            onClick={addManual}
            disabled={manual.trim() === ""}
          >
            {t("providerForm.addManually")}
          </Button>
        </div>

        {selected.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {selected.map((upstream) => (
              <Badge key={upstream} tone="default" className="font-mono">
                {upstream}
                {(!creating || selected.length > 1) && (
                  <button
                    type="button"
                    aria-label={t("a11y.removeSelectedModel", { name: upstream })}
                    onClick={() => toggleModel(upstream)}
                    className="-mr-1 ml-1 text-ink-3 transition-colors hover:text-red-500"
                  >
                    ×
                  </button>
                )}
              </Badge>
            ))}
          </div>
        )}
      </>
    );
  }

  function mappingFields(): ReactNode {
    if (selected.length === 0) return null;
    const many = selected.length > 1;
    return (
      <>
        <p className="text-xs text-ink-3">{t("providerForm.mappingHint")}</p>
        <div className="space-y-3">
          {selected.map((upstream) => {
            const target = targetFor(upstream);
            return (
              <div
                key={upstream}
                className="rounded-lg border border-hairline bg-panel-2 px-3 py-2.5"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="min-w-0 truncate font-mono text-xs font-medium text-ink"
                    title={upstream}
                  >
                    {upstream}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <ArrowRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-ink-3" />
                  <span className="min-w-0 flex-1">
                    <Select
                      aria-label={t("providerForm.mappingAria", { name: upstream })}
                      value={target.modelId}
                      onChange={(event) => {
                        const value = event.target.value;
                        setTarget(
                          upstream,
                          value === CREATE_MODEL_VALUE
                            ? { modelId: value, newName: target.newName || upstream }
                            : { modelId: value, newName: "" },
                        );
                      }}
                    >
                      {models.map((model) => (
                        <option key={model.id} value={String(model.id)}>
                          {model.name}
                        </option>
                      ))}
                      <option value={CREATE_MODEL_VALUE}>
                        {t("providerForm.createModelOption")}
                      </option>
                    </Select>
                  </span>
                </div>
                {target.modelId === CREATE_MODEL_VALUE ? (
                  <Input
                    className="mt-2"
                    aria-label={t("providerForm.newModelName")}
                    placeholder="claude-opus-5.5"
                    value={target.newName}
                    onChange={(event) =>
                      setTarget(upstream, { ...target, newName: event.target.value })
                    }
                  />
                ) : (
                  many && (
                    <p className="mt-1.5 text-[11px] text-ink-3">
                      {t("providerForm.willBeNamed", {
                        name: `${name.trim() || "—"} · ${upstream}`,
                      })}
                    </p>
                  )
                )}
              </div>
            );
          })}
        </div>
      </>
    );
  }

  function stepper(): ReactNode {
    return (
      <div className="mb-4 flex items-center gap-1">
        {stepLabels.map((label, index) => {
          const number = index + 1;
          const state = step === number ? "active" : step > number ? "done" : "todo";
          return (
            <Fragment key={label}>
              {index > 0 && <span className="h-px flex-1 bg-hairline" />}
              <span
                className={clsx(
                  "flex shrink-0 items-center gap-1.5 text-xs font-medium",
                  state === "active" ? "text-ink" : state === "done" ? "text-accent" : "text-ink-3",
                )}
              >
                <span
                  className={clsx(
                    "flex h-5 w-5 items-center justify-center rounded-full border text-[10px]",
                    state === "active"
                      ? "border-accent bg-accent text-black"
                      : state === "done"
                        ? "border-accent/50 text-accent"
                        : "border-hairline",
                  )}
                >
                  {state === "done" ? <Check aria-hidden className="h-3 w-3" /> : number}
                </span>
                <span className="hidden sm:inline">{label}</span>
              </span>
            </Fragment>
          );
        })}
      </div>
    );
  }

  /* Footer ------------------------------------------------------------- */

  const resultNode = resultText && (
    <span
      className={clsx(
        "max-w-40 truncate text-xs font-medium",
        result?.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400",
      )}
      title={resultText}
    >
      {resultText}
    </span>
  );

  const createFooter = (
    <div className="flex w-full flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        {step > 1 && (
          <Button
            variant="ghost"
            onClick={() => setStep((current) => Math.max(1, current - 1))}
            disabled={save.pending}
            icon={<ArrowLeft aria-hidden className="h-3.5 w-3.5" />}
          >
            {t("providerForm.back")}
          </Button>
        )}
        {step >= 2 && (
          <Button variant="secondary" onClick={runTest} pending={test.pending} disabled={!canTest}>
            {t("providerForm.test")}
          </Button>
        )}
        {resultNode}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={onClose} disabled={save.pending}>
          {t("common.cancel")}
        </Button>
        {step < 3 ? (
          <Button
            variant="primary"
            onClick={() => setStep((current) => Math.min(3, current + 1))}
            disabled={step === 1 ? !step1Valid : !step2Valid}
          >
            {t("providerForm.next")}
            <ArrowRight aria-hidden className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <Button variant="primary" onClick={submit} pending={save.pending} disabled={!canSave}>
            {t("providerForm.createCount", { n: selected.length })}
          </Button>
        )}
      </div>
    </div>
  );

  const editFooter = (
    <div className="flex w-full flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        {resultNode}
        <Button variant="secondary" onClick={runTest} pending={test.pending} disabled={!canTest}>
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
  );

  /* Body --------------------------------------------------------------- */

  const errorNode = errorMessage && (
    <p className="text-xs text-red-600 dark:text-red-400">{errorMessage}</p>
  );

  const body = creating ? (
    <div>
      {stepper()}
      <div key={step} className="anim-fade space-y-4">
        {step === 1 && connectionFields()}
        {step === 2 && modelPickerFields()}
        {step === 3 && mappingFields()}
        {errorNode}
      </div>
    </div>
  ) : (
    <div className="space-y-5">
      {section(1, stepLabels[0], connectionFields())}
      <div className="h-px bg-hairline-soft" />
      {section(2, stepLabels[1], modelPickerFields())}
      <div className="h-px bg-hairline-soft" />
      {section(3, stepLabels[2], mappingFields())}
      {errorNode}
    </div>
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={provider ? t("providerForm.edit") : t("providerForm.create")}
      width={creating ? "lg" : "md"}
      footer={creating ? createFooter : editFooter}
    >
      {body}
    </Modal>
  );
}
