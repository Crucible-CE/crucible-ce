import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { liveIncidentWhere } from "@/lib/incident/live";
import { GUEST_HEADERS, GUEST_INCIDENT_SELECT, guestGate } from "@/lib/incident/guest";
import { parseChatQuery, chatPageArgs, afterCursorWhere, CHAT_LIMITS } from "@/lib/chat/paginate";

interface RouteContext {
  params: Promise<{ token: string }>;
}

// GET /api/public/incident-guest/[token]: the guest view of ONE incident: a
// summary, the chat (cold load = newest messages; ?after=<id> = newer delta,
// guests have no socket and poll) and what the invite allows. The token is
// the credential; nothing here reads a session.
export async function GET(req: Request, context: RouteContext) {
  const { token } = await context.params;
  const gate = await guestGate(req, token, "read");
  if (!gate.ok) return gate.response;
  const { ctx } = gate;

  const incident = await db.incident.findFirst({ where: liveIncidentWhere({ id: ctx.incidentId }), select: GUEST_INCIDENT_SELECT });
  if (!incident) return NextResponse.json({ error: "This link is not valid." }, { status: 401, headers: GUEST_HEADERS });

  const { limit, after } = parseChatQuery(req.url, CHAT_LIMITS.incident);
  const afterRow = after
    ? await db.incidentChatMessage.findUnique({ where: { id: after }, select: { id: true, createdAt: true, incidentId: true } })
    : null;
  // A cursor from another incident degrades to a cold load: never another incident's rows.
  const scopedAfterRow = afterRow && afterRow.incidentId === ctx.incidentId ? afterRow : null;
  const page = chatPageArgs({ limit, after, afterRow: scopedAfterRow });
  const rows = await db.incidentChatMessage.findMany({
    where: { incidentId: ctx.incidentId, ...(page.incremental && scopedAfterRow ? afterCursorWhere(scopedAfterRow) : {}) },
    orderBy: page.orderBy,
    take: page.take,
    select: { id: true, userId: true, userName: true, message: true, createdAt: true },
  });
  const messages = page.incremental ? rows : rows.reverse();

  return NextResponse.json(
    {
      incident,
      guest: { displayName: ctx.displayName, principalId: ctx.principalId, canUpload: ctx.canUpload, expiresAt: ctx.expiresAt },
      messages,
      nextCursor: messages.at(-1)?.id ?? after ?? null,
    },
    { headers: GUEST_HEADERS },
  );
}
