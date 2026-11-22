// Exercise chat. Channels: all (everyone), team (one team; control sees every
// team), control (control only). Messages are stored; the socket only says
// "chat changed" and clients refetch.

import { db } from "@/lib/db";
import type { ParticipantRow, Viewer } from "@/lib/exercise/runtime/types";
import type { EmitScope } from "@/lib/exercise/socket/events";
import { ServiceError } from "./errors";
import type { ChatChannel } from "./schemas";

export const CHAT_LIMIT = 200;

export interface ChatItem {
  id: string;
  channel: string;
  teamId: string | null;
  teamName: string | null;
  participantId: string;
  author: string;
  isGuest: boolean;
  body: string;
  at: Date;
  mine: boolean;
}

export async function listChat(exerciseId: string, viewer: Viewer): Promise<ChatItem[]> {
  const me = viewer.participant;
  const or: Array<Record<string, unknown>> = [{ channel: "all" }];
  if (viewer.isControl) {
    or.push({ channel: "team" }, { channel: "control" });
  } else if (me?.teamId) {
    or.push({ channel: "team", teamId: me.teamId });
  }
  const rows = await db.chatMessage.findMany({
    where: { exerciseId, OR: or },
    orderBy: { at: "desc" },
    take: CHAT_LIMIT,
    include: { participant: { select: { displayName: true, isGuest: true } }, team: { select: { name: true } } },
  });
  return rows.reverse().map((m) => ({
    id: m.id,
    channel: m.channel,
    teamId: m.teamId,
    teamName: m.team?.name ?? null,
    participantId: m.participantId,
    author: m.participant.displayName,
    isGuest: m.participant.isGuest,
    body: m.body,
    at: m.at,
    mine: m.participantId === me?.id,
  }));
}

export async function postChat(
  exerciseId: string,
  viewer: Viewer,
  participant: ParticipantRow,
  input: { body: string; channel: ChatChannel; teamId?: string | null },
): Promise<{ id: string; scope: EmitScope }> {
  const ex = await db.exercise.findUnique({ where: { id: exerciseId }, select: { status: true } });
  if (!ex) throw new ServiceError(404, "Exercise not found.");
  if (ex.status === "abandoned") throw new ServiceError(409, "This exercise was abandoned.");

  let teamId: string | null = null;
  let scope: EmitScope = "all";
  if (input.channel === "control") {
    if (!viewer.isControl) throw new ServiceError(403, "Only the control team can use this channel.");
    scope = "control";
  } else if (input.channel === "team") {
    if (viewer.isControl && input.teamId) teamId = input.teamId;
    else teamId = participant.teamId;
    if (!teamId) throw new ServiceError(400, "Join a team to use team chat.");
    const t = await db.team.findFirst({ where: { id: teamId, exerciseId }, select: { id: true } });
    if (!t) throw new ServiceError(400, "That team is not part of this exercise.");
    scope = { teamId };
  }
  const row = await db.chatMessage.create({
    data: { exerciseId, channel: input.channel, teamId, participantId: participant.id, body: input.body },
    select: { id: true },
  });
  return { id: row.id, scope };
}
