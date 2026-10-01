import type { ServerResponse } from "node:http";

export type WriteResult = "ok" | "closed";

/**
 * SSE write with backpressure: resolves "ok" immediately when the socket
 * accepted the data, otherwise waits for 'drain' so a slow client throttles
 * the upstream read instead of ballooning server memory.
 * Resolves "closed" if the client disconnected (or the socket errored).
 */
export function writeWithBackpressure(res: ServerResponse, payload: string): Promise<WriteResult> {
  return new Promise((resolve) => {
    if (res.writableEnded || res.destroyed) {
      resolve("closed");
      return;
    }
    let settled = false;
    const cleanup = () => {
      res.off("drain", onDrain);
      res.off("close", onClose);
      res.off("error", onClose);
    };
    const done = (result: WriteResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const onDrain = () => done("ok");
    const onClose = () => done("closed");

    res.once("drain", onDrain);
    res.once("close", onClose);
    res.once("error", onClose);

    try {
      if (res.write(payload)) done("ok");
    } catch {
      done("closed");
    }
  });
}
