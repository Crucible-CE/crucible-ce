// Outbound HTTP for delivery: the signed webhook and every plugin (via
// ProviderContext.guardedPost) go through the same SSRF guard (./ssrf).
//
// Plain http:// is refused unless DELIVERY_WEBHOOK_ALLOW_PRIVATE=true: a page
// carries a live ack link and incident details, and must not cross the network
// in clear text. That switch exists for LOCAL TESTING / private dev receivers.

import { guardedPost, SsrfBlockedError, type HttpPost } from "./ssrf";
import type { GuardedPostOptions } from "./types";

export const DEFAULT_OUTBOUND_TIMEOUT_MS = 10_000;
const MAX_OUTBOUND_TIMEOUT_MS = 20_000;

export function webhookAllowPrivate(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.DELIVERY_WEBHOOK_ALLOW_PRIVATE ?? "").trim().toLowerCase() === "true";
}

/** Why this URL may not be used (scheme rule only; addresses are checked at connect time), or null. */
export function outboundUrlProblem(rawUrl: string, allowPrivate: boolean): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return "not a valid URL";
  }
  if (url.protocol === "https:") return null;
  if (url.protocol === "http:") {
    return allowPrivate ? null : "http:// not allowed. Use https, or set DELIVERY_WEBHOOK_ALLOW_PRIVATE=true for a private receiver";
  }
  return `scheme ${url.protocol} is not allowed (https only)`;
}

/** The SSRF-guarded POST handed to plugin factories as `ctx.guardedPost`. */
export function createPluginGuardedPost(
  env: NodeJS.ProcessEnv = process.env,
  post: HttpPost = guardedPost,
): (url: string, opts: GuardedPostOptions) => Promise<{ status: number; body: string }> {
  return async (url, opts) => {
    const allowPrivate = webhookAllowPrivate(env);
    const problem = outboundUrlProblem(url, allowPrivate);
    if (problem) throw new SsrfBlockedError(`Outbound URL refused: ${problem}`);
    const requested = Number(opts?.timeoutMs);
    const timeoutMs = Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_OUTBOUND_TIMEOUT_MS) : DEFAULT_OUTBOUND_TIMEOUT_MS;
    const body = typeof opts?.body === "string" ? opts.body : "";
    return post(url, body, { ...(opts?.headers ?? {}) }, { timeoutMs, allowPrivate });
  };
}
