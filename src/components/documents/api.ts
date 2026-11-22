"use client";

// Fetch helpers for the document screens. JSON in, JSON out, errors as text.

export type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string; body: unknown };

type ErrorBody = { error?: string; details?: { fieldErrors?: Record<string, string[]>; formErrors?: string[] } | string } | null;

export function errorText(body: unknown, fallback: string): string {
  const b = body as ErrorBody;
  const d = b?.details;
  if (d && typeof d === "object") {
    const field = d.fieldErrors ? Object.values(d.fieldErrors).flat()[0] : undefined;
    if (field) return field;
    if (d.formErrors?.[0]) return d.formErrors[0];
  }
  return b?.error && b.error !== "Invalid input" ? b.error : fallback;
}

export async function request<T = Record<string, unknown>>(
  url: string,
  opts: { method?: string; body?: unknown; form?: FormData; fallback?: string } = {},
): Promise<Result<T>> {
  const fallback = opts.fallback ?? "That did not work. Try again.";
  try {
    const res = await fetch(url, {
      method: opts.method ?? (opts.body === undefined && !opts.form ? "GET" : "POST"),
      headers: opts.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: opts.form ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
      cache: "no-store",
    });
    const data = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) return { ok: false, status: res.status, error: errorText(data, fallback), body: data };
    return { ok: true, data: (data ?? {}) as T };
  } catch {
    return { ok: false, status: 0, error: "Could not reach the server. Check your connection and try again.", body: null };
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
