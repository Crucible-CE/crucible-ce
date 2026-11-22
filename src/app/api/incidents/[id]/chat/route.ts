import { NextResponse } from "next/server";
import { accessibleIncidentsWhere } from "@/lib/incident/access";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { emitToIncident, SOCKET_EVENTS } from "@/lib/socket/server";
import { parseMentions } from "@/lib/incident/mentions";
import { notify } from "@/lib/notifications/dispatch";
import { parseJsonBody } from "@/lib/http/parse-body";
import { parseChatQuery, chatPageArgs, afterCursorWhere, CHAT_LIMITS } from "@/lib/chat/paginate";
import { assertIncidentWritable } from "@/lib/incident/lock";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const postSchema = z.object({ message: z.string().min(1).max(4000) });

// GET /api/incidents/[id]/chat — war-room chat history (oldest → newest).
export async function GET(req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  const incident = await db.incident.findFirst({
    where: { id, ...accessibleIncidentsWhere(session.user) },
    select: { id: true },
  });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // cold load = NEWEST N (the old oldest-N query froze the backlog past
  // the cap); ?after=<id> = strictly-newer delta for incremental polling.
  const { limit, after } = parseChatQuery(req.url, CHAT_LIMITS.incident);
  const afterRow = after
    ? await db.incidentChatMessage.findUnique({
        where: { id: after },
        select: { id: true, createdAt: true, incidentId: true },
      })
    : null;
  const scopedAfterRow = afterRow && afterRow.incidentId === id ? afterRow : null;
  const page = chatPageArgs({ limit, after, afterRow: scopedAfterRow });

  const rows = await db.incidentChatMessage.findMany({
    where: { incidentId: id, ...(page.incremental && scopedAfterRow ? afterCursorWhere(scopedAfterRow) : {}) },
    orderBy: page.orderBy,
    take: page.take,
  });
  const messages = page.incremental ? rows : rows.reverse();

  return NextResponse.json(
    { messages, nextCursor: messages.at(-1)?.id ?? after ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// POST /api/incidents/[id]/chat — send a war-room chat message. Persisted
// (auditable) and broadcast to the incident room in real time.
export async function POST(req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  const orgId = session.user.organizationId;
  const incident = await db.incident.findFirst({
    where: { id, ...accessibleIncidentsWhere(session.user) },
    select: { id: true },
  });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const locked = await assertIncidentWritable(session.user, { id });
  if (locked) return locked;

  const parsed = await parseJsonBody(req, postSchema);
  if (!parsed.ok) return parsed.response;

  const userName = session.user.name ?? session.user.email ?? session.user.id;
  const msg = await db.incidentChatMessage.create({
    data: {
      incidentId: id,
      organizationId: orgId,
      userId: session.user.id,
      userName,
      message: parsed.data.message,
    },
  });

  // @mentions → notify the mentioned org members (best-effort, excludes self).
  try {
    const members = await db.user.findMany({
      where: { organizationId: orgId, isActive: true },
      select: { id: true, name: true, email: true },
    });
    const mentioned = parseMentions(parsed.data.message, members).filter((t) => t !== session.user.id);
    if (mentioned.length > 0) {
      await notify({
        event: "mention",
        organizationId: orgId,
        incidentId: id,
        actorUserId: session.user.id,
        recipientIds: mentioned,
        title: `${userName} mentioned you in an incident`,
        body: parsed.data.message.slice(0, 200),
        link: `/incidents/${id}/chat`,
        metadata: { incidentId: id },
      });
    }
  } catch (err) {
    console.error("[chat] mention notify failed:", err);
  }

  // Delivery is room-isolated to `incident:{id}`.
  emitToIncident(id, SOCKET_EVENTS.CHAT_MESSAGE, {
    incidentId: id,
    id: msg.id,
    userId: session.user.id,
    userName,
    message: msg.message,
    createdAt: msg.createdAt.toISOString(),
  });

  return NextResponse.json(msg, { status: 201 });
}
