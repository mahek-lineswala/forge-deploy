import { useSyncExternalStore } from "react";

import {
  api,
  hasAccessToken,
  refreshSession,
  setAccessToken,
  setSessionListener,
} from "./api";
import type { Envelope, User } from "./types";

type SessionState =
  | { status: "unknown"; user: null }
  | { status: "authenticated"; user: User }
  | { status: "anonymous"; user: null };

let state: SessionState = { status: "unknown", user: null };
const listeners = new Set<() => void>();

function setState(next: SessionState) {
  state = next;
  listeners.forEach((listener) => listener());
}

setSessionListener((user) => {
  setState(user ? { status: "authenticated", user } : { status: "anonymous", user: null });
});

export function useSession(): SessionState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

/**
 * Used by route guards. On first load the access token is gone (memory only),
 * so this tries the refresh cookie once; afterwards the answer is cached.
 */
export async function ensureSession(): Promise<boolean> {
  if (state.status === "authenticated" && hasAccessToken()) return true;
  if (state.status === "anonymous") return false;

  return refreshSession();
}

export async function login(email: string, password: string): Promise<User> {
  const body = await api<Envelope<{ user: User; accessToken: string }>>("/auth/login", {
    method: "POST",
    body: { email, password },
    auth: false,
  });

  setAccessToken(body.data.accessToken);
  setState({ status: "authenticated", user: body.data.user });
  return body.data.user;
}

export async function register(
  name: string,
  email: string,
  password: string,
): Promise<void> {
  await api("/auth/register", {
    method: "POST",
    body: { name: name || undefined, email, password },
    auth: false,
  });
}

export async function logout(): Promise<void> {
  try {
    await api("/auth/logout", { method: "POST", auth: false });
  } finally {
    setAccessToken(null);
    setState({ status: "anonymous", user: null });
  }
}
