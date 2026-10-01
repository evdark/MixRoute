import { AdapterError } from "../types.js";

export function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  if (b.endsWith(p)) return b;
  return `${b}${p}`;
}

/** Perform an upstream HTTP request, converting network failures into AdapterError. */
export async function upstreamFetch(
  url: string,
  init: RequestInit,
  signal: AbortSignal
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal });
  } catch (err) {
    if (signal.aborted) {
      throw new AdapterError("Upstream request timed out", { code: "timeout" });
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new AdapterError(`Connection error: ${message}`, { code: "connection" });
  }
}

export async function readErrorBody(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.slice(0, 500);
  } catch {
    return "";
  }
}

/** Async iterator over `data:` lines of an SSE stream (yields payload strings). */
export async function* sseLines(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal
): AsyncGenerator<string, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal.aborted) throw new AdapterError("Upstream request timed out", { code: "timeout" });
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx).replace(/\r$/, "");
        buffer = buffer.slice(idx + 1);
        if (line.startsWith("data:")) {
          const payload = line.slice(5).trim();
          if (payload) yield payload;
        }
        // event:/id:/retry: lines are ignored
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}
