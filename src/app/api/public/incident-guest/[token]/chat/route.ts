import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { emitToIncident, SOCKET_EVENTS } from "@/lib/socket/server";
import { GUEST_HEADERS, guestGate } from "@/lib/incident/guest";
import { parseJsonBody } from "@/lib/http/parse-body";
import { stripNul } from "@/lib/http/limits";

interface RouteContext {
  params: Promise<{ token: string }>;
}

const postSchema = z.object({ message: z.string().trim().min(1).max(4000) });

// POST /api/public/incident-guest/[token]/chat: a guest posts to the incident
// chat. Stored like any chat message (authored as the guest) and pushed to the
// incident room so responders see it live.
export async function POST(req: Request, context: RouteContext) {
  const { token } = await context.params;
  const gate = await guestGate(req, token, "chat");
  if (!gate.ok) return gate.response;
  const { ctx } = gate;

  const parsed = await parseJsonBody(req, postSchema);
  if (!parsed.ok) return parsed.response;

  const msg = await db.incidentChatMessage.create({
    data: {
      incidentId: ctx.incidentId,
      organizationId: ctx.organizationId,
      userId: ctx.principalId,
      userName: ctx.displayName,
      message: stripNul(parsed.data.message),
    },
    select: { id: true, userId: true, userName: true, message: true, createdAt: true },
  });

  emitToIncident(ctx.incidentId, SOCKET_EVENTS.CHAT_MESSAGE, {
    incidentId: ctx.incidentId,
    id: msg.id,
    userId: msg.userId,
    userName: msg.userName,
    message: msg.message,
    createdAt: msg.createdAt.toISOString(),
  });

  return NextResponse.json(msg, { status: 201, headers: GUEST_HEADERS });
}
