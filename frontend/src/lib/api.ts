import type { Envelope, User } from "./types";

/**
 * Thin fetch wrapper for the ForgeDeploy API.
 * - The access token lives only in memory (never localStorage).
 * - The refresh token is an HTTP-only cookie the backend sets on /api/auth.
 * - A 401 triggers one refresh (shared by concurrent requests), then one retry.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let accessToken: string | null = null;
let onSessionChange: ((user: User | null) => void) | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function hasAccessToken() {
  return accessToken !== null;
}

/** session.ts registers here so refreshes and logouts update the UI. */
export function setSessionListener(listener: (user: User | null) => void) {
  onSessionChange = listener;
}

let refreshInFlight: Promise<boolean> | null = null;

/** Rotates the refresh cookie and gets a new access token. Never throws. */
export function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch("/api/auth/refresh", {
        method: "POST",
        credentials: "include",
      });

      if (!response.ok) {
        accessToken = null;
        onSessionChange?.(null);
        return false;
      }

      const body = (await response.json()) as Envelope<{
        user: User;
        accessToken: string;
      }>;

      accessToken = body.data.accessToken;
      onSessionChange?.(body.data.user);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  /** Send the access token and refresh on 401. Default true. */
  auth?: boolean;
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json" };

  // Fastify rejects an empty body declared as JSON, so only set it when there is one.
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (options.auth !== false && accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  return fetch(`/api${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: "include",
    signal: options.signal,
  });
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response = await send(path, options);

  if (response.status === 401 && options.auth !== false) {
    if (await refreshSession()) {
      response = await send(path, options);
    }
  }

  const text = await response.text();
  let body: unknown = null;

  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const payload = (body ?? {}) as {
      message?: string;
      errors?: { path: string; message: string }[];
    };

    if (response.status === 401 && options.auth !== false) {
      accessToken = null;
      onSessionChange?.(null);
    }

    throw new ApiError(
      payload.message ?? `Request failed (${response.status})`,
      response.status,
      payload.errors,
    );
  }

  return body as T;
}

/** Most endpoints wrap results in { success, data }. */
export async function apiData<T>(path: string, options?: RequestOptions): Promise<T> {
  const body = await api<Envelope<T>>(path, options);
  return body.data;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.details?.length) {
      return error.details.map((d) => (d.path ? `${d.path}: ${d.message}` : d.message)).join("; ");
    }

    return error.message;
  }

  return error instanceof Error ? error.message : "Something went wrong";
}
