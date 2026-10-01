import clsx from "clsx";
import { ArrowRight, FlaskConical } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ApiError, apiStream } from "../api";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNote,
  Field,
  Loading,
  Select,
} from "../components";
import { formatDuration, formatTokens } from "../format";
import { t, useT } from "../i18n";
import { useApi } from "../hooks";
import type {
  ChatCompletionChunk,
  Model,
  PlaygroundMessage,
  PlaygroundMeta,
  PlaygroundRole,
  PlaygroundRequest,
} from "../types";

/** A message as shown in the chat, with routing metadata once completed. */
interface ChatLine {
  role: PlaygroundRole;
  content: string;
  meta?: PlaygroundMeta;
}

interface ChainPart {
  text: string;
  isStatus: boolean;
}

/**
 * Failover chain for the meta line: attempts flattened as "provider → status",
 * followed by the provider that actually served the answer («A → 429 → B»).
 */
function failoverChain(meta: PlaygroundMeta): ChainPart[] {
  const chain: ChainPart[] = [];
  for (const attempt of meta.attempts) {
    chain.push({ text: attempt.provider, isStatus: false });
    chain.push({ text: String(attempt.status), isStatus: true });
  }
  const last = meta.attempts[meta.attempts.length - 1];
  if (meta.provider_name !== "" && (!last || last.provider !== meta.provider_name)) {
    chain.push({ text: meta.provider_name, isStatus: false });
  }
  return chain;
}

function readError(err: unknown): string {
  if (err instanceof ApiError) return err.status === 401 ? t("error.noAccess") : err.message;
  if (err instanceof Error) return err.message;
  return t("error.somethingWrong");
}

export default function PlaygroundPage() {
  const { t } = useT();
  const modelsQuery = useApi<{ models: Model[] }>("/admin/api/models");
  const models = modelsQuery.data?.models ?? [];

  const [model, setModel] = useState("");
  const [messages, setMessages] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement>(null);

  // Preselect the first available model.
  useEffect(() => {
    const first = modelsQuery.data?.models[0]?.name;
    if (model === "" && first) setModel(first);
  }, [modelsQuery.data, model]);

  // Keep the newest token in view while the answer streams in.
  useEffect(() => {
    const element = listRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages, streamText]);

  const canSend =
    !streaming && model !== "" && draft.trim() !== "" && models.length > 0;

  async function send() {
    const text = draft.trim();
    if (!canSend) return;

    const outgoing: PlaygroundMessage[] = [
      ...messages.map(({ role, content }) => ({ role, content })),
      { role: "user", content: text },
    ];

    setMessages((previous) => [...previous, { role: "user", content: text }]);
    setDraft("");
    setError(null);
    setStreaming(true);
    setStreamText("");

    let acc = "";
    let meta: PlaygroundMeta | null = null;

    try {
      const response = await apiStream("/admin/api/playground", {
        model,
        messages: outgoing,
        stream: true,
      } satisfies PlaygroundRequest);

      if (!response.body) throw new ApiError(t("api.emptyStream"), 0);

      const applyPayload = (payload: string): boolean => {
        if (payload === "[DONE]") return true;
        let parsed: unknown;
        try {
          parsed = JSON.parse(payload);
        } catch {
          return false;
        }
        if (parsed === null || typeof parsed !== "object") return false;
        const chunk = parsed as ChatCompletionChunk;
        if (chunk.__mixroute_meta) {
          meta = chunk.__mixroute_meta;
          return false;
        }
        const content = chunk.choices?.[0]?.delta?.content;
        if (typeof content === "string" && content !== "") {
          acc += content;
          setStreamText(acc);
        }
        return false;
      };

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;

      while (!finished) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line; each frame is
        // `data: <payload>` (optionally CRLF-terminated).
        let separator = buffer.indexOf("\n\n");
        while (separator !== -1) {
          const frame = buffer.slice(0, separator);
          buffer = buffer.slice(separator + 2);

          for (const rawLine of frame.split("\n")) {
            const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "") continue;
            if (applyPayload(payload)) {
              finished = true;
              break;
            }
          }

          if (finished) break;
          separator = buffer.indexOf("\n\n");
        }
      }

      if (meta !== null || acc !== "") {
        const completed: ChatLine = {
          role: "assistant",
          content: acc,
          ...(meta !== null ? { meta } : {}),
        };
        setMessages((previous) => [...previous, completed]);
      }
    } catch (err) {
      // Keep the conversation as it was; the note below explains the failure.
      setError(readError(err));
    } finally {
      setStreamText(null);
      setStreaming(false);
    }
  }

  function reset() {
    if (streaming) return;
    setMessages([]);
    setStreamText(null);
    setError(null);
    setDraft("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  const liveLine: ChatLine | null =
    streaming ? { role: "assistant", content: streamText ?? "" } : null;
  const visibleLines = liveLine ? [...messages, liveLine] : messages;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t("nav.playground")}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">{t("playground.subtitle")}</p>
        </div>
      </div>

      {modelsQuery.error && (
        <ErrorNote message={modelsQuery.error} onRetry={modelsQuery.reload} />
      )}
      {modelsQuery.loading && models.length === 0 && (
        <Loading label={t("playground.loadingModels")} />
      )}

      {!modelsQuery.loading && models.length === 0 && !modelsQuery.error && (
        <EmptyState title={t("empty.noModels")} hint={t("playground.emptyHint")} />
      )}

      {models.length > 0 && (
        <>
          <div className="max-w-xs">
            <Field label={t("common.model")}>
              <Select value={model} onChange={(event) => setModel(event.target.value)}>
                {model !== "" && !models.some((item) => item.name === model) && (
                  <option value={model}>{model}</option>
                )}
                {models.map((item) => (
                  <option key={item.id} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="flex h-[min(60vh,32rem)] flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <div ref={listRef} className="flex-1 space-y-5 overflow-y-auto p-4">
              {visibleLines.length === 0 ? (
                <div className="flex h-full items-center justify-center px-6 text-center">
                  <div>
                    <FlaskConical
                      aria-hidden
                      className="mx-auto h-6 w-6 text-zinc-300 dark:text-zinc-600"
                    />
                    <p className="mt-2 max-w-sm text-sm text-zinc-500">
                      {t("playground.emptyChat")}
                    </p>
                  </div>
                </div>
              ) : (
                visibleLines.map((line, index) => {
                  const isLive = streaming && index === visibleLines.length - 1;
                  const isUser = line.role === "user";
                  return (
                    <div key={index}>
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                        {isUser ? t("playground.you") : t("playground.assistant")}
                      </span>

                      {isUser ? (
                        <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-800 dark:text-zinc-200">
                          {line.content}
                        </p>
                      ) : line.content === "" ? (
                        isLive && (
                          <p className="mt-1 animate-pulse text-sm text-zinc-400">…</p>
                        )
                      ) : (
                        <pre className="mt-1 whitespace-pre-wrap break-words rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-xs leading-relaxed text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
                          {line.content}
                        </pre>
                      )}

                      {line.meta && (
                        <div className="mt-2 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
                            <Badge tone="default">{line.meta.provider_name}</Badge>
                            <span className="tabular-nums">
                              {formatDuration(line.meta.duration_ms)}
                            </span>
                            {line.meta.usage && (
                              <>
                                <span className="text-zinc-300 dark:text-zinc-600">·</span>
                                <span className="tabular-nums">
                                  {t("playground.tokens", {
                                    in: formatTokens(line.meta.usage.prompt_tokens),
                                    out: formatTokens(line.meta.usage.completion_tokens),
                                  })}
                                </span>
                              </>
                            )}
                          </div>

                          {line.meta.attempts.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1 text-xs">
                              <span className="text-zinc-400">{t("playground.failovers")}</span>
                              {failoverChain(line.meta).map((part, partIndex) => (
                                <Fragment key={`${part.text}-${partIndex}`}>
                                  {partIndex > 0 && (
                                    <ArrowRight
                                      aria-hidden
                                      className="h-3 w-3 text-zinc-400"
                                    />
                                  )}
                                  <span
                                    className={clsx(
                                      part.isStatus
                                        ? "font-medium text-amber-600 dark:text-amber-400"
                                        : "text-zinc-700 dark:text-zinc-300",
                                    )}
                                  >
                                    {part.text}
                                  </span>
                                </Fragment>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <form
              className="border-t border-zinc-100 p-3 dark:border-zinc-800/70"
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              <textarea
                rows={3}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder={t("playground.placeholder")}
                className="w-full resize-none rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-500/20 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-600"
              />

              {error && <ErrorNote message={error} className="mt-2" />}

              <div className="mt-2 flex items-center justify-between gap-2">
                <Button variant="ghost" onClick={reset} disabled={streaming}>
                  {t("playground.reset")}
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  pending={streaming}
                  disabled={!canSend}
                >
                  {t("playground.send")}
                </Button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
