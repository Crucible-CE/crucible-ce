"use client";

// Browser-side calls for two-factor sign-in (Settings > Security, the
// require-MFA enrollment page and the sign-in second step).

import { startAuthentication, startRegistration } from "@simplewebauthn/browser";

export interface MfaStatus {
  enabled: boolean;
  requireMfa: boolean;
  totp: { enabled: boolean; enabledAt: string | null };
  webauthn: {
    available: boolean;
    reason: string | null;
    credentials: {
      id: string;
      name: string;
      createdAt: string;
      lastUsedAt: string | null;
      transports: string[];
      kind: "passkey" | "security_key";
      backedUp: boolean;
    }[];
  };
  recovery: { remaining: number; total: number; generatedAt: string | null; low: boolean };
  hasPassword: boolean;
  reauthUntil: string | null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export async function api<T = Record<string, unknown>>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(typeof data.error === "string" ? data.error : `Couldn't complete the request (${res.status}). Try again.`, res.status, typeof data.code === "string" ? data.code : undefined);
  }
  return data as T;
}

export const fetchMfaStatus = () => api<MfaStatus>("/api/user/mfa");

/** A user-facing message for a WebAuthn ceremony that failed in the browser. */
export function webauthnErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  const name = err instanceof Error ? err.name : "";
  if (name === "NotAllowedError") return "Security key request cancelled or timed out.";
  if (name === "InvalidStateError") return "That security key is already added.";
  if (name === "SecurityError") return "Security keys need https or localhost.";
  return err instanceof Error && err.message ? err.message : "Couldn't use the security key. Try again.";
}

/** Register a new key: options -> browser ceremony -> verify. Returns new recovery codes, if any. */
export async function registerSecurityKey(name: string): Promise<string[] | null> {
  const { options } = await api<{ options: Parameters<typeof startRegistration>[0]["optionsJSON"] }>("/api/user/mfa/webauthn/options", { method: "POST" });
  const response = await startRegistration({ optionsJSON: options });
  const done = await api<{ recoveryCodes: string[] | null }>("/api/user/mfa/webauthn", { method: "POST", body: { name, response } });
  return done.recoveryCodes;
}

/** Run an authentication ceremony against options from `optionsUrl`; returns the JSON response to send on. */
export async function securityKeyAssertion(optionsUrl: string): Promise<string> {
  const { options } = await api<{ options: Parameters<typeof startAuthentication>[0]["optionsJSON"] }>(optionsUrl, { method: "POST" });
  const response = await startAuthentication({ optionsJSON: options });
  return JSON.stringify(response);
}

export function formatDate(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
