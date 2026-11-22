import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminContext } from "@/lib/auth/admin-guard";
import { parseJsonBody } from "@/lib/http/parse-body";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { activeEmailTransport } from "@/lib/email/transport";
import { retryBackoffMinutes, numberCeilingHourlyLimit, orgHourlyLimit, recipientHourlyLimit } from "@/lib/delivery/config";
import { allProviders, ensurePluginsLoaded } from "@/lib/delivery/registry";
import { inboundSmsAckEnabled, twilioCallbackBase } from "@/lib/delivery/providers/twilio";
import { resolvePageRecipient, sendTestDelivery } from "@/lib/delivery/engine";
import { webhookAllowPrivate } from "@/lib/delivery/providers/webhook";
import { logAudit } from "@/lib/audit/log";

// Settings -> Delivery (org admin). GET lists every delivery provider
// (built-in + plugins) with its configured state; POST sends a test message
// through one provider to the calling admin's own email/phone.

function isConfigured(fn: () => boolean): boolean {
  try {
    return fn();
  } catch {
    return false;
  }
}

/** Why a provider is not configured (e.g. a webhook with no secret), when it says. */
function notConfiguredReason(p: { notConfiguredReason?: () => string | null }): string | null {
  try {
    const r = typeof p.notConfiguredReason === "function" ? p.notConfiguredReason() : null;
    return typeof r === "string" && r.trim() ? r.slice(0, 300) : null;
  } catch {
    return null;
  }
}

export async function GET() {
  const admin = await getAdminContext();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [providers, report, me] = await Promise.all([
    allProviders(),
    ensurePluginsLoaded(),
    resolvePageRecipient({ organizationId: admin.organizationId, targetUserId: admin.userId, targetContactId: null, targetLabel: null }),
  ]);
  const email = activeEmailTransport();
  return NextResponse.json(
    {
      providers: providers.map((r) => ({
        id: r.provider.id,
        displayName: r.provider.displayName,
        channels: r.provider.channels,
        source: r.source,
        configured: isConfigured(() => r.provider.isConfigured()),
        notConfiguredReason: isConfigured(() => r.provider.isConfigured()) ? null : notConfiguredReason(r.provider),
        file: r.file ? path.basename(r.file) : null,
        // Email: only the active transport carries pages.
        carriesPages: r.provider.channels.includes("email") ? r.provider.id === email : true,
      })),
      pluginErrors: report.errors.map((e) => ({ file: path.basename(e.file), error: e.error })),
      pluginsDir: report.dir,
      settings: {
        activeEmailTransport: email,
        retryBackoffMinutes: retryBackoffMinutes(),
        recipientHourlyLimit: recipientHourlyLimit(),
        orgHourlyLimit: orgHourlyLimit(),
        numberCeilingHourlyLimit: numberCeilingHourlyLimit(),
        twilioCallbacks: twilioCallbackBase() !== null,
        inboundSmsAck: inboundSmsAckEnabled(),
        webhookAllowPrivate: webhookAllowPrivate(),
      },
      me: { name: me?.name ?? admin.name, email: me?.email ?? admin.email, phone: me?.phone ?? null },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

const testSchema = z.object({ providerId: z.string().min(1).max(64) });

export async function POST(req: Request) {
  const admin = await getAdminContext();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = await parseJsonBody(req, testSchema);
  if (!parsed.ok) return parsed.response;

  // Test sends can hit SMS/voice: keep them well under toll-fraud territory.
  const rl = await checkRateLimit({ namespace: "delivery-test", identifier: admin.userId, windowMs: 10 * 60_000, max: 10 });
  if (!rl.allowed) {
    return NextResponse.json({ error: `Too many test sends. Try again in ${rl.retryAfter}s.` }, { status: 429 });
  }

  const me = await resolvePageRecipient({
    organizationId: admin.organizationId,
    targetUserId: admin.userId,
    targetContactId: null,
    targetLabel: null,
  });
  if (!me) return NextResponse.json({ error: "Couldn't find your account. Try again." }, { status: 400 });

  const result = await sendTestDelivery(parsed.data.providerId, me);
  await logAudit({
    actorUserId: admin.userId,
    actorEmail: admin.email,
    actorName: admin.name,
    organizationId: admin.organizationId,
    action: "delivery.test_sent",
    targetType: "DeliveryProvider",
    targetId: parsed.data.providerId,
    metadata: { status: result.status },
  });
  console.log(`[delivery] test send via ${parsed.data.providerId} by admin ${admin.userId}: ${result.status}${result.error ? ` (${result.error})` : ""}`);
  return NextResponse.json({ result });
}
