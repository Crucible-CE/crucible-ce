// =============================================================================
// Out-of-band delivery: the provider contract.
// =============================================================================
// A DeliveryProvider moves one message to one recipient over one or more
// channels. Built-ins (SMTP, Resend, Twilio SMS/voice, signed webhook) and
// user plugins (PROVIDERS_DIR) implement the same shape. Documented for plugin
// authors in docs/delivery-providers.md; keep the two in sync.
// =============================================================================

export const DELIVERY_CHANNELS = ["email", "sms", "voice", "push", "webhook", "custom"] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

export type DeliveryKind = "page" | "escalation" | "ack" | "test" | "broadcast";

export interface DeliveryMessage {
  kind: DeliveryKind;
  /**
   * Stable idempotency key: `${pageId}:${level}:${providerId}` for page and
   * escalation kinds, `broadcast:${recipientId}:${providerId}` for broadcasts. It does NOT change between retries of the same page
   * level, so a receiver that already handled it can drop a retry.
   */
  id: string;
  /** 1-based attempt number of this send (retries count up; same `id`). */
  attempt: number;
  /**
   * True when the page is for a LOCKED incident its target may not see: the
   * message carries severity + ack link only (no title, note or deep link;
   * `incident.id` and `incident.url` are blanked). Never show more.
   */
  restricted?: boolean;
  incident: {
    id: string;
    title: string;
    severity: string;
    /** Deep link into the app (requires sign-in). */
    url: string;
  } | null;
  page: { id: string; level: number; priority: string } | null;
  /** One-line headline, e.g. "[CRITICAL] Paged: Ransomware on file servers". */
  title: string;
  /** Plain-text body (already includes the pager's note, if any). */
  text: string;
  /** Signed, single-use, expiring acknowledge link (null for test/ack kinds). */
  ackUrl: string | null;
  /** ISO-8601 timestamp of this send. */
  sentAt: string;
}

export interface DeliveryRecipient {
  name: string;
  email?: string | null;
  /** E.164, e.g. +15551234567. */
  phone?: string | null;
  userId?: string | null;
  contactId?: string | null;
}

export type DeliveryStatus = "sent" | "failed" | "skipped";

export interface DeliveryResult {
  status: DeliveryStatus;
  /** Provider-side id (message id, call SID) for audit / status callbacks. */
  providerRef?: string;
  /** Failure reason, or why the send was skipped. */
  error?: string;
}

export interface DeliveryProvider {
  /** Unique, stable id: lowercase letters, digits, "-", "_", "." (max 64). */
  id: string;
  displayName: string;
  channels: DeliveryChannel[];
  /** Cheap and synchronous: are the env/config values this provider needs present? */
  isConfigured(): boolean;
  /**
   * Optional: when isConfigured() is false, a short human reason shown in
   * Settings -> Delivery (e.g. "DELIVERY_WEBHOOK_SECRET is required").
   */
  notConfiguredReason?(): string | null;
  send(message: DeliveryMessage, recipient: DeliveryRecipient): Promise<DeliveryResult>;
}

export interface ProviderLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/** Options for {@link ProviderContext.guardedPost}. */
export interface GuardedPostOptions {
  headers?: Record<string, string>;
  body: string;
  /** Hard wall-clock timeout (default 10 000 ms, capped at 20 000). */
  timeoutMs?: number;
}

/** What a plugin factory receives. */
export interface ProviderContext {
  env: NodeJS.ProcessEnv;
  logger: ProviderLogger;
  /**
   * SSRF-guarded HTTP POST (the transport the signed webhook uses): https
   * only (http:// and private/loopback/link-local targets only with
   * DELIVERY_WEBHOOK_ALLOW_PRIVATE=true), every resolved address checked at
   * connect time, redirects never followed, hard timeout. Resolves with the
   * status and the first 2 KB of the response body; rejects on a blocked
   * target, a transport error or a timeout. Use it instead of raw fetch().
   */
  guardedPost(url: string, opts: GuardedPostOptions): Promise<{ status: number; body: string }>;
}

/** Where a provider came from (shown in Settings → Delivery). */
export type ProviderSource = "builtin" | "plugin";

export interface RegisteredProvider {
  provider: DeliveryProvider;
  source: ProviderSource;
  /** Plugin file path (plugins only). */
  file?: string;
  /**
   * Built-in addressed channels (email/sms/voice) only reach a recipient who
   * has that address. Webhooks and plugins receive every page and decide
   * themselves (returning "skipped" when they cannot address the recipient).
   */
  addressed: boolean;
}
