import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { parseJsonBody } from "@/lib/http/parse-body";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { logAudit } from "@/lib/audit/log";
import { BROADCAST_CHANNELS, MAX_BROADCAST_RECIPIENTS, audienceIsEmpty, audienceSchema, resolveAudience } from "@/lib/broadcast/audience";
import { createBroadcast, deliverBroadcast } from "@/lib/broadcast/send";
import { summarizeBroadcast } from "@/lib/broadcast/summary";

// Broadcast messaging: administrators and contributors (incidents.edit), the
// same people who page. Readers receive broadcasts but cannot send or list them.

// GET /api/broadcasts: the last 50 broadcasts with delivery and ack counts.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session.user, "incidents.edit")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const rows = await db.broadcast.findMany({
    where: { organizationId: session.user.organizationId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      title: true,
      message: true,
      channels: true,
      createdByName: true,
      createdAt: true,
      recipients: { select: { acknowledgedAt: true, deliveries: { select: { channel: true, status: true } } } },
    },
  });
  return NextResponse.json(
    { broadcasts: rows.map((b) => ({ id: b.id, title: b.title, message: b.message, channels: b.channels, createdByName: b.createdByName, createdAt: b.createdAt, ...summarizeBroadcast(b.recipients) })) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

const postSchema = z.object({
  title: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(1500),
  channels: z.array(z.enum(BROADCAST_CHANNELS)).min(1).max(BROADCAST_CHANNELS.length),
  audience: audienceSchema,
  /** Count the recipients without sending. */
  preview: z.boolean().optional(),
});

// POST /api/broadcasts: send a broadcast (or preview its recipient count).
// Delivery runs in the background; GET /api/broadcasts/[id] shows progress.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session.user, "incidents.edit")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const orgId = session.user.organizationId;

  const parsed = await parseJsonBody(req, postSchema);
  if (!parsed.ok) return parsed.response;
  const data = parsed.data;
  if (audienceIsEmpty(data.audience)) return NextResponse.json({ error: "Pick at least one person or group." }, { status: 400 });

  const targets = await resolveAudience(orgId, data.audience);
  if (data.preview) {
    return NextResponse.json({
      recipients: targets.length,
      tooMany: targets.length > MAX_BROADCAST_RECIPIENTS,
      withEmail: targets.filter((t) => t.email).length,
      withPhone: targets.filter((t) => t.phone).length,
      withApp: targets.filter((t) => t.userId).length,
    });
  }
  if (targets.length === 0) return NextResponse.json({ error: "Nobody matches that selection." }, { status: 400 });
  if (targets.length > MAX_BROADCAST_RECIPIENTS) return NextResponse.json({ error: `A broadcast reaches at most ${MAX_BROADCAST_RECIPIENTS} people.` }, { status: 400 });

  // Blast radius and cost cap: 10 broadcasts a minute per organization.
  const rl = await checkRateLimit({ namespace: "broadcast:send", identifier: orgId, windowMs: 60_000, max: 10 });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many broadcasts. Wait a minute and try again." }, { status: 429, headers: { "Retry-After": String(rl.retryAfter) } });
  }

  const senderName = session.user.name ?? session.user.email ?? null;
  const created = await createBroadcast({
    organizationId: orgId,
    sender: { id: session.user.id, name: senderName },
    title: data.title,
    message: data.message,
    channels: data.channels,
    audience: data.audience,
    targets,
  });
  await logAudit({
    actorUserId: session.user.id,
    actorEmail: session.user.email,
    actorName: session.user.name,
    organizationId: orgId,
    action: "broadcast.sent",
    targetType: "Broadcast",
    targetId: created.id,
    targetLabel: data.title,
    metadata: { recipients: created.recipients.length, channels: data.channels },
  });
  void deliverBroadcast(created).catch((e) => console.error(`[broadcast] ${created.id} delivery failed:`, e));
  return NextResponse.json({ id: created.id, recipients: created.recipients.length }, { status: 201 });
}
