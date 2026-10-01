import clsx from "clsx";
import { Pencil, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import {
  Button,
  Confirm,
  EmptyState,
  ErrorNote,
  Loading,
  ProviderForm,
  StatusBadge,
  Toggle,
  type TestResponse,
} from "../components";
import { formatLatency } from "../format";
import { useT, type TranslationKey, type TVars } from "../i18n";
import { useAction, useApi } from "../hooks";
import type { Model, Provider } from "../types";

interface ProviderModalState {
  mode: "create" | "edit";
  provider?: Provider;
}

interface ConfirmSpec {
  titleKey: TranslationKey;
  messageKey: TranslationKey;
  vars?: TVars;
  action: () => Promise<unknown>;
}

export default function ProvidersPage() {
  const { t } = useT();
  const tableHeaders = [
    t("common.name"),
    t("common.model"),
    t("table.type"),
    "Base URL",
    t("table.status"),
    t("table.priority"),
    t("table.enabled"),
    "",
  ];

  const providersQuery = useApi<{ providers: Provider[] }>("/admin/api/providers");
  const modelsQuery = useApi<{ models: Model[] }>("/admin/api/models");

  const providers = providersQuery.data?.providers ?? [];
  const models = modelsQuery.data?.models ?? [];

  const [providerModal, setProviderModal] = useState<ProviderModalState | null>(null);
  const [confirmSpec, setConfirmSpec] = useState<ConfirmSpec | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<number, { ok: boolean; text: string }>>({});

  const reload = () => {
    providersQuery.reload();
    modelsQuery.reload();
  };

  const confirmAction = useAction(async () => {
    if (!confirmSpec) return;
    await confirmSpec.action();
  });

  const toggleProvider = useAction(async (provider: Provider, enabled: boolean) => {
    await api(`/admin/api/providers/${provider.id}`, {
      method: "PATCH",
      body: { enabled: enabled ? 1 : 0 },
    });
    providersQuery.reload();
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

  function askDelete(provider: Provider) {
    setActionError(null);
    setConfirmSpec({
      titleKey: "confirm.deleteProvider.title",
      messageKey: "confirm.deleteProvider.message",
      vars: { name: provider.name },
      action: () => api(`/admin/api/providers/${provider.id}`, { method: "DELETE" }),
    });
  }

  const loading = (providersQuery.loading && !providersQuery.data) ||
    (modelsQuery.loading && !modelsQuery.data);
  const error = providersQuery.error ?? modelsQuery.error;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t("nav.providers")}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">{t("providers.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            onClick={reload}
            aria-label={t("a11y.refreshProviders")}
            className="px-2"
          >
            <RefreshCw aria-hidden className="h-4 w-4" />
          </Button>
          <Button variant="primary" onClick={() => setProviderModal({ mode: "create" })}>
            {t("models.addProvider")}
          </Button>
        </div>
      </div>

      {actionError && <ErrorNote message={actionError} />}
      {error && <ErrorNote message={error} onRetry={reload} />}
      {loading && <Loading />}

      {!loading && providers.length === 0 && (
        <EmptyState title={t("providers.empty.title")} hint={t("providers.empty.hint")} />
      )}

      {providers.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-xs font-medium text-zinc-500 dark:border-zinc-800">
                  {tableHeaders.map((header, index) => (
                    <th key={index} className="px-4 py-2.5 font-medium">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
                {providers.map((provider) => {
                  const test = tests[provider.id];
                  return (
                    <tr
                      key={provider.id}
                      className="transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                    >
                      <td className="px-4 py-3 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {provider.name}
                      </td>
                      <td className="px-4 py-3 text-sm text-zinc-600 dark:text-zinc-400">
                        {provider.model_name}
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-500">{provider.type}</td>
                      <td className="max-w-56 px-4 py-3">
                        <span
                          className="block truncate font-mono text-xs text-zinc-500"
                          title={provider.base_url}
                        >
                          {provider.base_url}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={provider.status} />
                      </td>
                      <td className="px-4 py-3 text-xs tabular-nums text-zinc-500">
                        P{provider.priority}
                      </td>
                      <td className="px-4 py-3">
                        <Toggle
                          checked={provider.enabled === 1}
                          onChange={(enabled) => toggleProvider.run(provider, enabled)}
                          disabled={toggleProvider.pending}
                          label={t("providerRow.enable", { name: provider.name })}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          {test && (
                            <span
                              className={clsx(
                                "max-w-32 truncate text-xs font-medium",
                                test.ok
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-red-600 dark:text-red-400",
                              )}
                              title={test.text}
                            >
                              {test.text}
                            </span>
                          )}
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => testProvider.run(provider)}
                            pending={testProvider.pending}
                          >
                            {t("common.test")}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="px-1.5"
                            aria-label={t("a11y.edit", { name: provider.name })}
                            onClick={() => setProviderModal({ mode: "edit", provider })}
                          >
                            <Pencil aria-hidden className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="px-1.5"
                            aria-label={t("a11y.delete", { name: provider.name })}
                            onClick={() => askDelete(provider)}
                          >
                            <Trash2 aria-hidden className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {providerModal && (
        <ProviderForm
          models={models}
          mode={providerModal.mode}
          initial={providerModal.provider}
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
