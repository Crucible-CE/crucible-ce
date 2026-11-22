// Acknowledging a broadcast. The signed link is the paging ack link
// (lib/delivery/ack-token) with the recipient id as the "page id" and level 0,
// so /api/public/page-ack/<token> and the voice "press 1" route resolve it
// after looking for an incident page. Only this module pulls the database in
// for those public routes.

import { db } from "@/lib/db";

export interface BroadcastAckRecord {
  recipientId: string;
  broadcastId: string;
  name: string;
  title: string;
  acknowledgedAt: Date | null;
}

/** The broadcast recipient behind an ack token's id, or null when it is not one. */
export async function findBroadcastRecipient(id: string): Promise<BroadcastAckRecord | null> {
  const r = await db.broadcastRecipient.findUnique({
    where: { id },
    select: { id: true, broadcastId: true, name: true, acknowledgedAt: true, broadcast: { select: { title: true } } },
  });
  if (!r) return null;
  return { recipientId: r.id, broadcastId: r.broadcastId, name: r.name, title: r.broadcast.title, acknowledgedAt: r.acknowledgedAt };
}

/** Guarded ack: wins once. False when it was already acknowledged. */
export async function ackBroadcastRecipient(recipientId: string, via: "app" | "link" | "voice", now: Date = new Date()): Promise<boolean> {
  const r = await db.broadcastRecipient.updateMany({ where: { id: recipientId, acknowledgedAt: null }, data: { acknowledgedAt: now, acknowledgedVia: via } });
  return r.count === 1;
}
