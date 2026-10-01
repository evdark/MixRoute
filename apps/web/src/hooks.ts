import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { t } from "./i18n";

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) return t("error.noAccess");
  if (error instanceof Error) return error.message;
  return t("error.somethingWrong");
}

/**
 * Loads JSON from `path` on mount and whenever `path` changes or `reload`
 * is called. 401 responses are swallowed here because the auth gate in
 * `App` already reacts to them.
 */
export function useApi<T>(path: string): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  const reload = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    api<T>(path)
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled && !(err instanceof ApiError && err.status === 401)) {
          setError(messageOf(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [path, version]);

  return { data, error, loading, reload };
}

/**
 * Eased count-up for KPI numbers. Re-animates whenever `target` changes,
 * respects `prefers-reduced-motion` (jumps straight to the value there).
 */
export function useCountUp(target: number, duration = 900): number {
  const [value, setValue] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;

    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      fromRef.current = target;
      setValue(target);
      return;
    }

    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(from + (target - from) * eased);
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  return value;
}

export interface ActionResult<R> {
  ok: boolean;
  data?: R;
  error?: string;
}

export interface Action<R, Args extends unknown[]> {
  run: (...args: Args) => Promise<ActionResult<R>>;
  pending: boolean;
  error: string | null;
}

/**
 * Wraps a mutation so callers get `pending`/`error` state for free.
 * Buttons can pass `pending` down to stay disabled while running.
 */
export function useAction<Args extends unknown[], R>(
  fn: (...args: Args) => Promise<R>,
): Action<R, Args> {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fnRef = useRef(fn);

  useEffect(() => {
    fnRef.current = fn;
  });

  const run = useCallback(async (...args: Args): Promise<ActionResult<R>> => {
    setPending(true);
    setError(null);
    try {
      const data = await fnRef.current(...args);
      return { ok: true, data };
    } catch (err) {
      const message = messageOf(err);
      setError(message);
      return { ok: false, error: message };
    } finally {
      setPending(false);
    }
  }, []);

  return { run, pending, error };
}
