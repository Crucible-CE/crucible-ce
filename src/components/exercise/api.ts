"use client";

// Small fetch helpers for exercise screens. JSON in, JSON out, errors as text.

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

type ErrorBody = { error?: string; details?: { fieldErrors?: Record<string, string[]>; formErrors?: string[] } | string } | null;

export function errorText(body: ErrorBody, fallback: string): string {
  const d = body?.details;
  if (d && typeof d === "object") {
    const field = d.fieldErrors ? Object.values(d.fieldErrors).flat()[0] : undefined;
    if (field) return field;
    if (d.formErrors?.[0]) return d.formErrors[0];
  }
  return body?.error && body.error !== "Invalid input" ? body.error : fallback;
}

export async function api<T = Record<string, unknown>>(
  url: string,
  opts: { method?: string; body?: unknown; fallback?: string } = {},
): Promise<ApiResult<T>> {
  const fallback = opts.fallback ?? "That did not work. Try again.";
  try {
    const res = await fetch(url, {
      method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
      headers: opts.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      cache: "no-store",
    });
    const data = (await res.json().catch(() => null)) as (T & ErrorBody) | null;
    if (!res.ok) return { ok: false, status: res.status, error: errorText(data, fallback) };
    return { ok: true, data: (data ?? {}) as T };
  } catch {
    return { ok: false, status: 0, error: "Could not reach the server. Check your connection and try again." };
  }
}
