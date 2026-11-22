// Sending a broadcast over the out-of-band delivery providers
// (lib/delivery): the same providers, toll-fraud limits and signed acknowledge
// links as paging. Per recipient and selected channel:
//   app      in-app notification to the member (or the member linked to a contact)
//   email    the active email transport (SMTP or Resend)
//   sms      Twilio SMS, metered (lib/delivery/metered) and verified phones only
//   voice    Twilio voice, the same rules as SMS
//   webhook  every configured webhook and delivery plugin
// One BroadcastDelivery row per (recipient, provider). A channel that cannot
// reach someone is recorded as an honest skip, never dropped. Every message
// carries the recipient's signed ack link (/api/public/page-ack/<token>, the
// paging link), so a broadcast is acknowledged like a page.

import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { createNotification } from "@/lib/notifications";
import { ackUrlFor } from "@/lib/delivery/engine";
import { allProviders } from "@/lib/delivery/registry";
import { safeSend } from "@/lib/delivery/safe-send";
import { checkMeteredRateLimit } from "@/lib/delivery/metered";
import { activeEmailTransport } from "@/lib/email/transport";
import type { DeliveryMessage, DeliveryResult, RegisteredProvider } from "@/lib/delivery/types";
import { getPublicBaseUrl } from "@/lib/email/resend";
import type { BroadcastChannel, BroadcastTarget } from "./audience";

export interface CreatedBroadcast {
  id: string;
  recipients: { id: string; target: BroadcastTarget }[];
}

interface PlannedChannel {
  channel: string;
  providerId: string;
  reg: RegisteredProvider | null;
  /** Set when the channel is not configured at all. */
  notConfigured?: boolean;
}

/** The providers each selected channel uses right now (pure over the registry). */
export function planBroadcastChannels(channels: BroadcastChannel[], providers: RegisteredProvider[]): PlannedChannel[] {
  const byId = new Map(providers.map((r) => [r.provider.id, r]));
  const configured = (r: RegisteredProvider | undefined) => {
    try {
      return !!r && r.provider.isConfigured();
    } catch {
      return false;
    }
  };
  const plan: PlannedChannel[] = [];
  for (const ch of channels) {
    if (ch === "app") plan.push({ channel: "app", providerId: "app", reg: null });
    else if (ch === "email") {
      const id = activeEmailTransport();
      const reg = id ? byId.get(id) : undefined;
      plan.push(configured(reg) ? { channel: "email", providerId: reg!.provider.id, reg: reg! } : { channel: "email", providerId: "email", reg: null, notConfigured: true });
    } else if (ch === "sms" || ch === "voice") {
      const id = ch === "sms" ? "twilio-sms" : "twilio-voice";
      const reg = byId.get(id);
      plan.push(configured(reg) ? { channel: ch, providerId: id, reg: reg! } : { channel: ch, providerId: id, reg: null, notConfigured: true });
    } else if (ch === "webhook") {
      for (const reg of providers) {
        if (reg.addressed || !configured(reg)) continue;
        plan.push({ channel: reg.provider.channels[0] ?? "webhook", providerId: reg.provider.id, reg });
      }
    }
  }
  return plan;
}

/** Create the broadcast and its recipient rows. Delivery runs separately ({@link deliverBroadcast}). */
export async function createBroadcast(args: {
  organizationId: string;
  sender: { id: string; name: string | null };
  title: string;
  message: string;
  channels: BroadcastChannel[];
  audience: object;
  targets: BroadcastTarget[];
}): Promise<CreatedBroadcast> {
  return db.$transaction(async (tx) => {
    const b = await tx.broadcast.create({
      data: {
        organizationId: args.organizationId,
        title: args.title,
        message: args.message,
        channels: args.channels,
        audience: args.audience,
        createdById: args.sender.id,
        createdByName: args.sender.name,
      },
      select: { id: true },
    });
    // Ids made here so each recipient keeps its resolved addresses for delivery
    // (hex, because the ack token takes [a-z0-9]).
    const recipients = args.targets.map((target) => ({ id: randomBytes(12).toString("hex"), target }));
    await tx.broadcastRecipient.createMany({
      data: recipients.map(({ id, target: t }) => ({ id, organizationId: args.organizationId, broadcastId: b.id, userId: t.userId, contactId: t.contactId, name: t.name })),
    });
    return { id: b.id, recipients };
  });
}

function destinationFor(channel: string, t: BroadcastTarget): string | null {
  if (channel === "email") return t.email;
  if (channel === "sms" || channel === "voice") return t.phone;
  return null;
}

async function record(row: {
  organizationId: string;
  broadcastId: string;
  recipientId: string;
  provider: string;
  channel: string;
  destination: string | null;
  result: DeliveryResult | { status: "pending" };
}): Promise<string | null> {
  const created = await db.broadcastDelivery.createManyAndReturn({
    data: [
      {
        organizationId: row.organizationId,
        broadcastId: row.broadcastId,
        recipientId: row.recipientId,
        provider: row.provider,
        channel: row.channel,
        destination: row.destination,
        status: row.result.status,
        providerRef: "providerRef" in row.result ? (row.result.providerRef ?? null) : null,
        error: "error" in row.result ? (row.result.error ?? null) : null,
      },
    ],
    skipDuplicates: true,
    select: { id: true },
  });
  return created[0]?.id ?? null;
}

/**
 * Deliver a created broadcast to its recipients over its channels. Idempotent
 * on (recipient, provider): a repeat run sends nothing twice. One failure
 * never stops the rest. Returns the number of attempts that were sent.
 */
export async function deliverBroadcast(created: CreatedBroadcast, now: Date = new Date()): Promise<number> {
  const b = await db.broadcast.findUnique({
    where: { id: created.id },
    select: { id: true, organizationId: true, title: true, message: true, channels: true, createdByName: true },
  });
  if (!b) return 0;
  const channels = (Array.isArray(b.channels) ? b.channels : []) as BroadcastChannel[];
  const plan = planBroadcastChannels(channels, await allProviders());

  const base = getPublicBaseUrl().replace(/\/+$/, "");
  let sent = 0;
  for (const { id: recipientId, target: t } of created.recipients) {
    const r = { id: recipientId };
    let ackUrl: string | null = null;
    try {
      ackUrl = ackUrlFor(r.id, 0, now);
    } catch {
      ackUrl = null;
    }
    for (const p of plan) {
      const common = { organizationId: b.organizationId, broadcastId: b.id, recipientId: r.id, provider: p.providerId, channel: p.channel };
      try {
        if (p.channel === "app") {
          if (!t.userId) {
            await record({ ...common, destination: null, result: { status: "skipped", error: "no app account" } });
            continue;
          }
          const rowId = await record({ ...common, destination: null, result: { status: "pending" } });
          if (!rowId) continue;
          const link = ackUrl ? ackUrl.slice(base.length) || null : null;
          const n = await createNotification(t.userId, "broadcast", b.title, b.message, { broadcastId: b.id, recipientId: r.id }, link ?? "/inbox");
          await db.broadcastDelivery.update({ where: { id: rowId }, data: n ? { status: "sent" } : { status: "failed", error: "notification not created" } });
          if (n) sent++;
          continue;
        }
        if (p.notConfigured || !p.reg) {
          await record({ ...common, destination: null, result: { status: "skipped", error: "not configured" } });
          continue;
        }
        const destination = destinationFor(p.channel, t);
        const addressed = p.channel === "email" || p.channel === "sms" || p.channel === "voice";
        if (addressed && !destination) {
          const error = (p.channel === "sms" || p.channel === "voice") && t.phoneBlocked ? t.phoneBlocked : p.channel === "email" ? "no email address on file" : "no phone number on file";
          await record({ ...common, destination: null, result: { status: "skipped", error } });
          continue;
        }
        if ((p.channel === "sms" || p.channel === "voice") && destination) {
          const hit = await checkMeteredRateLimit(b.organizationId, destination, p.channel, now);
          if (hit) {
            await record({ ...common, destination, result: { status: "skipped", error: hit.reason } });
            continue;
          }
          // Counted by the same toll-fraud gate as every other SMS and call.
          await db.meteredSend.create({ data: { organizationId: b.organizationId, channel: p.channel, destination, purpose: "broadcast", createdAt: now } });
        }
        const rowId = await record({ ...common, destination, result: { status: "pending" } });
        if (!rowId) continue;
        const msg: DeliveryMessage = {
          kind: "broadcast",
          id: `broadcast:${r.id}:${p.providerId}`,
          attempt: 1,
          incident: null,
          page: null,
          title: b.title,
          text: `${b.message}${b.createdByName ? `\n\nSent by ${b.createdByName}.` : ""}`,
          ackUrl,
          sentAt: now.toISOString(),
        };
        const result = await safeSend(p.reg.provider, msg, { name: t.name, email: t.email, phone: t.phone, userId: t.userId, contactId: t.contactId });
        await db.broadcastDelivery.update({ where: { id: rowId }, data: { status: result.status, providerRef: result.providerRef ?? null, error: result.error ?? null } });
        if (result.status === "sent") sent++;
      } catch (err) {
        console.error(`[broadcast] ${b.id} ${p.providerId} for ${r.id} failed:`, err);
        await db.broadcastDelivery
          .updateMany({ where: { recipientId: r.id, provider: p.providerId, status: "pending" }, data: { status: "failed", error: `internal error: ${err instanceof Error ? err.message : String(err)}`.slice(0, 1000) } })
          .catch(() => {});
      }
    }
  }
  return sent;
}
