// Example Crucible CE delivery provider: push pages to an ntfy topic
// (https://ntfy.sh or a self-hosted ntfy server). Inert until NTFY_TOPIC is set.
//
//   NTFY_TOPIC   required, e.g. "acme-incidents-7f3k" (pick an unguessable name on ntfy.sh)
//   NTFY_URL     default https://ntfy.sh (a self-hosted http:// or private-network
//                server needs DELIVERY_WEBHOOK_ALLOW_PRIVATE=true)
//   NTFY_TOKEN   optional access token (self-hosted / reserved topics)
//
// Try it:  NTFY_TOPIC=my-test-topic npm run provider:test -- ./providers/example-ntfy.mjs
//
// The contract is documented in docs/delivery-providers.md. A provider module
// default-exports either a provider object or a factory receiving
// { env, logger, guardedPost } and returning one (sync or async).
//
// Outbound HTTP goes through ctx.guardedPost (SSRF guard, https only, no
// redirects, hard timeout), never raw fetch(): a mistyped or hostile NTFY_URL
// can't turn the app into a proxy into the internal network.

/**
 * @param {{
 *   env: Record<string, string | undefined>,
 *   logger: { info: Function, warn: Function, error: Function },
 *   guardedPost: (url: string, opts: { headers?: Record<string, string>, body: string, timeoutMs?: number }) => Promise<{ status: number, body: string }>,
 * }} ctx
 */
export default function createNtfyProvider({ env, logger, guardedPost }) {
  const base = (env.NTFY_URL || "https://ntfy.sh").replace(/\/+$/, "");
  const topic = (env.NTFY_TOPIC || "").trim();
  const token = (env.NTFY_TOKEN || "").trim();

  return {
    id: "ntfy",
    displayName: "ntfy push",
    channels: ["push"],

    isConfigured() {
      return topic.length > 0 && typeof guardedPost === "function";
    },

    notConfiguredReason() {
      if (!topic) return "NTFY_TOPIC is not set";
      if (typeof guardedPost !== "function") return "this Crucible version does not provide ctx.guardedPost";
      return null;
    },

    /**
     * @param {import("../src/lib/delivery/types").DeliveryMessage} message
     * @param {import("../src/lib/delivery/types").DeliveryRecipient} recipient
     */
    async send(message, recipient) {
      if (!topic || typeof guardedPost !== "function") return { status: "skipped", error: "not configured (NTFY_TOPIC)" };

      const critical = message.incident?.severity === "critical";
      const headers = {
        // ntfy headers must be ASCII; keep the title plain. A restricted page's
        // title is already redacted ("[HIGH] Restricted incident page").
        Title: message.title.replace(/[^\x20-\x7e]/g, "?").slice(0, 200),
        Priority: message.kind === "ack" ? "2" : critical ? "5" : "4",
        Tags: message.kind === "ack" ? "white_check_mark" : "rotating_light",
        // Same id on every retry of this page level: lets you dedupe.
        "X-Crucible-Delivery": message.id,
        "X-Crucible-Delivery-Attempt": String(message.attempt ?? 1),
      };
      // No deep link on a restricted page (its incident.url is blank anyway).
      if (message.incident?.url && !message.restricted) headers.Click = message.incident.url;
      if (message.ackUrl) headers.Actions = `view, Acknowledge, ${message.ackUrl}, clear=true`;
      if (token) headers.Authorization = `Bearer ${token}`;

      const body = `${message.text}\n\nFor: ${recipient.name}`;
      try {
        const res = await guardedPost(`${base}/${encodeURIComponent(topic)}`, { headers, body, timeoutMs: 10_000 });
        if (res.status < 200 || res.status >= 300) return { status: "failed", error: `ntfy HTTP ${res.status}` };
        let id;
        try {
          id = JSON.parse(res.body).id;
        } catch {
          id = undefined;
        }
        return { status: "sent", providerRef: typeof id === "string" ? id : undefined };
      } catch (err) {
        logger.warn("send failed:", err instanceof Error ? err.message : err);
        return { status: "failed", error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
