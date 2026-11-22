// Provider registry: built-ins (re-read from env on every call, so a config
// change shows up after restart without stale singletons) + plugins (loaded
// once per process).
//
// Plugin state lives on globalThis: server.ts (tsx) and the Next.js route
// bundles are separate module graphs inside ONE process, and both must see the
// same loaded plugins without importing them twice.

import { createResendProvider, createSmtpProvider } from "./providers/email";
import { createTwilioSmsProvider, createTwilioVoiceProvider } from "./providers/twilio";
import { createWebhookProvider, webhookTargetsFromEnv } from "./providers/webhook";
import { loadPlugins, providersDir, type PluginLoadReport } from "./plugins";
import type { DeliveryChannel, DeliveryResult, RegisteredProvider } from "./types";
import { activeEmailTransport } from "@/lib/email/transport";

const BUILTIN_IDS = new Set(["smtp", "resend", "twilio-sms", "twilio-voice", "email", "sms", "voice"]);

const g = globalThis as unknown as { __crucibleDeliveryPlugins?: Promise<PluginLoadReport> };

export function builtinProviders(env: NodeJS.ProcessEnv = process.env): RegisteredProvider[] {
  const webhooks = webhookTargetsFromEnv(env).map((t) => ({
    provider: createWebhookProvider(t),
    source: "builtin" as const,
    addressed: false,
  }));
  return [
    { provider: createSmtpProvider(), source: "builtin", addressed: true },
    { provider: createResendProvider(), source: "builtin", addressed: true },
    { provider: createTwilioSmsProvider(), source: "builtin", addressed: true },
    { provider: createTwilioVoiceProvider(), source: "builtin", addressed: true },
    ...webhooks,
  ];
}

/** Load plugins once per process (idempotent; safe to call from anywhere). */
export function ensurePluginsLoaded(): Promise<PluginLoadReport> {
  if (!g.__crucibleDeliveryPlugins) {
    const reserved = new Set([...BUILTIN_IDS, ...webhookTargetsFromEnv().map((t) => t.id)]);
    g.__crucibleDeliveryPlugins = loadPlugins(providersDir(), { reservedIds: reserved }).catch((e) => {
      console.error("[delivery] plugin loading failed:", e);
      return { dir: providersDir(), loaded: [], errors: [{ file: providersDir(), error: String(e) }] };
    });
  }
  return g.__crucibleDeliveryPlugins;
}

export async function allProviders(): Promise<RegisteredProvider[]> {
  const report = await ensurePluginsLoaded();
  return [
    ...builtinProviders(),
    ...report.loaded.map((p) => ({ provider: p.provider, source: "plugin" as const, file: p.file, addressed: false })),
  ];
}

/**
 * A planned send: the provider, or (for a built-in channel with nothing
 * configured) an honest skip row so the page shows "email: skipped, not
 * configured" instead of silently omitting the channel.
 */
export type PlannedSend =
  | { kind: "send"; reg: RegisteredProvider; channel: DeliveryChannel }
  | { kind: "skip"; providerId: string; channel: DeliveryChannel; result: DeliveryResult };

/**
 * Fan-out plan for one recipient:
 *   email  -> the active email transport (one of smtp/resend), if any
 *   sms    -> twilio-sms;  voice -> twilio-voice
 *   every configured webhook and every configured plugin
 * Unconfigured built-in channels become "skipped: not configured" rows;
 * unconfigured webhooks/plugins are left out (they are opt-in extras).
 */
export function planFanOut(providers: RegisteredProvider[]): PlannedSend[] {
  const plan: PlannedSend[] = [];
  const byId = new Map(providers.map((r) => [r.provider.id, r]));

  const email = activeEmailTransport();
  const emailReg = email ? byId.get(email) : undefined;
  if (emailReg && emailReg.provider.isConfigured()) plan.push({ kind: "send", reg: emailReg, channel: "email" });
  else plan.push({ kind: "skip", providerId: "email", channel: "email", result: { status: "skipped", error: "not configured" } });

  for (const [id, channel] of [["twilio-sms", "sms"], ["twilio-voice", "voice"]] as const) {
    const reg = byId.get(id);
    if (reg && reg.provider.isConfigured()) plan.push({ kind: "send", reg, channel });
    else plan.push({ kind: "skip", providerId: id, channel, result: { status: "skipped", error: "not configured" } });
  }

  for (const reg of providers) {
    if (reg.addressed) continue;
    let configured = false;
    try {
      configured = reg.provider.isConfigured();
    } catch {
      configured = false;
    }
    if (!configured) continue;
    plan.push({ kind: "send", reg, channel: reg.provider.channels[0] });
  }
  return plan;
}
