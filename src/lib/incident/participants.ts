// Auto-enrol the reporter / assignee as incident participants (founder rule).
//
// The access check grants a LOCKED incident only to participants, same-org
// administrators and the incident commander — reporter and assignee get no
// implicit access. Instead they are added as ordinary (removable) participants
// at the moments they become involved: incident creation, (re)assignment, and
// locking (lib: the lock route seeds the current team). Idempotent: an
// existing participant row is left untouched; users outside the org are
// ignored.

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

type ParticipantClient = Pick<Prisma.TransactionClient, "user" | "incidentParticipant">;

export async function ensureIncidentParticipants(
  args: {
    organizationId: string;
    incidentId: string;
    userIds: (string | null | undefined)[];
    addedBy?: { id: string | null; name: string | null } | null;
  },
  client: ParticipantClient = db,
): Promise<number> {
  const ids = [...new Set(args.userIds.filter((x): x is string => !!x))];
  if (ids.length === 0) return 0;
  const users = await client.user.findMany({
    where: { id: { in: ids }, organizationId: args.organizationId },
    select: { id: true, name: true, email: true },
  });
  let added = 0;
  for (const u of users) {
    await client.incidentParticipant.upsert({
      where: { incidentId_userId: { incidentId: args.incidentId, userId: u.id } },
      create: {
        organizationId: args.organizationId,
        incidentId: args.incidentId,
        userId: u.id,
        userName: u.name ?? u.email ?? "Unknown",
        userEmail: u.email ?? null,
        role: "responder",
        addedById: args.addedBy?.id ?? null,
        addedByName: args.addedBy?.name ?? null,
      },
      update: {},
    });
    added += 1;
  }
  return added;
}
