import { t } from "./i18n";

const PASSWORD_KEY = "mixroute.password";

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export interface ApiOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
}

type UnauthorizedHandler = () => void;

let unauthorizedHandler: UnauthorizedHandler | null = null;

/** Register the callback fired whenever the API answers 401. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

export function getPassword(): string {
  try {
    return localStorage.getItem(PASSWORD_KEY) ?? "";
  } catch {
    return "";
  }
}

export function storePassword(password: string): void {
  try {
    localStorage.setItem(PASSWORD_KEY, password);
  } catch {
    /* storage unavailable */
  }
}

export function clearPassword(): void {
  try {
    localStorage.removeItem(PASSWORD_KEY);
  } catch {
    /* storage unavailable */
  }
}

function readErrorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const value = (payload as { error: unknown }).error;
    if (typeof value === "string" && value.trim().length > 0) return value;
    // OpenAI-style errors: { error: { message, type, code } }
    if (value && typeof value === "object" && "message" in value) {
      const message = (value as { message: unknown }).message;
      if (typeof message === "string" && message.trim().length > 0) return message;
    }
  }
  return t("api.httpError", { status });
}

/**
 * Fetch wrapper for the admin API. Always sends the admin password header,
 * handles JSON bodies and throws `ApiError` (carrying the HTTP status) on
 * failure. A 401 clears the stored password and notifies the app so the
 * login screen can be shown.
 */
export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { method = "GET", body } = options;

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: {
        "x-admin-password": getPassword(),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(t("api.unreachable"), 0);
  }

  if (response.status === 401) {
    clearPassword();
    unauthorizedHandler?.();
    throw new ApiError("Unauthorized", 401);
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text.length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    throw new ApiError(readErrorMessage(payload, response.status), response.status);
  }

  return payload as T;
}

/**
 * POSTs a JSON body and returns the raw `Response` so callers can consume a
 * streaming (SSE) body themselves. Error statuses throw `ApiError` with the
 * server-provided message before any bytes are read; a 401 is handled exactly
 * like in `api`.
 */
export async function apiStream(path: string, body: unknown): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: {
        "x-admin-password": getPassword(),
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(t("api.unreachable"), 0);
  }

  if (response.status === 401) {
    clearPassword();
    unauthorizedHandler?.();
    throw new ApiError("Unauthorized", 401);
  }

  if (!response.ok) {
    let payload: unknown = null;
    try {
      const text = await response.text();
      payload = text.length > 0 ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    throw new ApiError(readErrorMessage(payload, response.status), response.status);
  }

  return response;
}
