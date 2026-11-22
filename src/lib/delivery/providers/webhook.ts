// Signed generic webhook: the universal adapter (ntfy, Signal/Matrix bridges,
// PagerDuty Events via a relay, an in-house paging service, ...).
//
//   DELIVERY_WEBHOOK_URL       one URL, or a comma-separated list
//   DELIVERY_WEBHOOK_URL_2..N  additional URLs (each its own provider)
//   DELIVERY_WEBHOOK_SECRET    HMAC secret; DELIVERY_WEBHOOK_SECRET_N overrides per URL
//   DELIVERY_WEBHOOK_ALLOW_PRIVATE=true  LOCAL TESTING ONLY: allow private
//                              targets and plain http:// URLs
//
// JSON POST, 10 s timeout, no redirects, SSRF-guarded, https only. A webhook
// without a secret is never sent to (isConfigured() false; Settings ->
// Delivery says why). Payload schema and signature verification:
// docs/delivery-providers.md.

import { signatureHeader, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "../signing";
import { guardedPost, type HttpPost } from "../ssrf";
import { outboundUrlProblem, webhookAllowPrivate } from "../outbound-http";
import type { DeliveryMessage, DeliveryProvider, DeliveryRecipient, DeliveryResult } from "../types";

export { webhookAllowPrivate };

export const WEBHOOK_TIMEOUT_MS = 10_000;
export const ATTEMPT_HEADER = "X-Crucible-Delivery-Attempt";

export interface WebhookTarget {
  id: string;
  url: string;
  secret: string | null;
}

/** Why this webhook target can't be sent to, or null when it can. */
export function webhookTargetProblem(target: WebhookTarget, allowPrivate: boolean = webhookAllowPrivate()): string | null {
  if (!target.url) return "no URL";
  if (!target.secret) return "DELIVERY_WEBHOOK_SECRET not set";
  const problem = outboundUrlProblem(target.url, allowPrivate);
  return problem ? `URL ${problem}` : null;
}

/**
 * Boot-log warnings for the configured webhooks: missing secrets (never sent
 * to), plain http:// URLs (refused unless DELIVERY_WEBHOOK_ALLOW_PRIVATE=true,
 * and clear text even then).
 */
export function webhookBootWarnings(env: NodeJS.ProcessEnv = process.env): string[] {
  const allowPrivate = webhookAllowPrivate(env);
  const out: string[] = [];
  for (const t of webhookTargetsFromEnv(env)) {
    if (!t.secret) out.push(`webhook "${t.id}" (${hostOf(t.url)}) has no DELIVERY_WEBHOOK_SECRET: it will NOT be sent to`);
    if (/^http:\/\//i.test(t.url)) {
      out.push(
        allowPrivate
          ? `webhook "${t.id}" uses plain http:// (allowed by DELIVERY_WEBHOOK_ALLOW_PRIVATE=true; pages and ack links cross the network unencrypted)`
          : `webhook "${t.id}" uses plain http://: refused. Use https, or set DELIVERY_WEBHOOK_ALLOW_PRIVATE=true for a private/dev receiver`,
      );
    }
  }
  return out;
}

/** Parse the configured webhook targets. Ids: webhook, webhook-2, webhook-3, ... */
export function webhookTargetsFromEnv(env: NodeJS.ProcessEnv = process.env): WebhookTarget[] {
  const defaultSecret = env.DELIVERY_WEBHOOK_SECRET?.trim() || null;
  const urls: string[] = (env.DELIVERY_WEBHOOK_URL ?? "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  const numbered = Object.keys(env)
    .map((k) => /^DELIVERY_WEBHOOK_URL_(\d+)$/.exec(k))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => parseInt(m[1], 10))
    .sort((a, b) => a - b);
  const out: WebhookTarget[] = urls.map((url, i) => ({
    id: i === 0 ? "webhook" : `webhook-${i + 1}`,
    url,
    secret: (i === 0 ? null : env[`DELIVERY_WEBHOOK_SECRET_${i + 1}`]?.trim()) || defaultSecret,
  }));
  for (const n of numbered) {
    const url = env[`DELIVERY_WEBHOOK_URL_${n}`]?.trim();
    if (!url) continue;
    let id = `webhook-${n}`;
    while (out.some((t) => t.id === id)) id = `${id}b`;
    out.push({ id, url, secret: env[`DELIVERY_WEBHOOK_SECRET_${n}`]?.trim() || defaultSecret });
  }
  return out;
}

/** The JSON body a webhook receives (schema v1). */
export function webhookPayload(msg: DeliveryMessage, recipient: DeliveryRecipient) {
  return {
    version: 1,
    type: `crucible.${msg.kind}`,
    id: msg.id,
    attempt: msg.attempt,
    restricted: Boolean(msg.restricted),
    sentAt: msg.sentAt,
    title: msg.title,
    text: msg.text,
    ackUrl: msg.ackUrl,
    incident: msg.incident,
    page: msg.page,
    recipient: {
      name: recipient.name,
      email: recipient.email ?? null,
      phone: recipient.phone ?? null,
      userId: recipient.userId ?? null,
      contactId: recipient.contactId ?? null,
    },
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid URL";
  }
}

export function createWebhookProvider(
  target: WebhookTarget,
  opts: { allowPrivate?: boolean; post?: HttpPost; now?: () => number } = {},
): DeliveryProvider {
  const post = opts.post ?? guardedPost;
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  const allowPrivate = () => opts.allowPrivate ?? webhookAllowPrivate();
  return {
    id: target.id,
    displayName: `Webhook (${hostOf(target.url)})`,
    channels: ["webhook"],
    // Unsigned webhooks are refused: a receiver must be able to tell a real
    // page from a forged one. Plain http:// only for private/dev receivers.
    isConfigured: () => webhookTargetProblem(target, allowPrivate()) === null,
    notConfiguredReason: () => webhookTargetProblem(target, allowPrivate()),
    async send(msg: DeliveryMessage, recipient: DeliveryRecipient): Promise<DeliveryResult> {
      const problem = webhookTargetProblem(target, allowPrivate());
      if (problem || !target.secret) return { status: "skipped", error: `not configured (${problem ?? "DELIVERY_WEBHOOK_SECRET not set"})` };
      // The signature covers the exact body bytes sent (attempt included).
      const body = JSON.stringify(webhookPayload(msg, recipient));
      const t = now();
      try {
        const res = await post(
          target.url,
          body,
          {
            "Content-Type": "application/json",
            "User-Agent": "Crucible-CE-Delivery/1",
            [TIMESTAMP_HEADER]: String(t),
            [SIGNATURE_HEADER]: signatureHeader(target.secret, t, body),
            "X-Crucible-Event": `crucible.${msg.kind}`,
            "X-Crucible-Delivery": msg.id,
            [ATTEMPT_HEADER]: String(msg.attempt),
          },
          { timeoutMs: WEBHOOK_TIMEOUT_MS, allowPrivate: allowPrivate() },
        );
        if (res.status >= 200 && res.status < 300) return { status: "sent", providerRef: `HTTP ${res.status}` };
        if (res.status >= 300 && res.status < 400) return { status: "failed", error: `HTTP ${res.status}: redirects are not followed` };
        return { status: "failed", error: `HTTP ${res.status}${res.body ? `: ${res.body.slice(0, 200)}` : ""}` };
      } catch (e) {
        return { status: "failed", error: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}
