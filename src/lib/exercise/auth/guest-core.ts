// Guest helpers with no Next.js imports, safe for the custom server process
// (socket handshake) as well as route handlers. See src/auth/guest.ts.
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { parseGuestCookieValue } from "@/lib/exercise/auth/guest-cookie";

export function hashGuestToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface GuestPrincipal {
  exerciseId: string;
  participantId: string;
}

/**
 * Validate a raw guest cookie value against the DB: the token hash must
 * exist, be unexpired, belong to the exercise named in the cookie, and point
 * at a guest participant that has not been removed.
 */
export async function resolveGuestCookieValue(value: string | null, now: Date = new Date()): Promise<GuestPrincipal | null> {
  const parsed = parseGuestCookieValue(value);
  if (!parsed) return null;
  const session = await db.guestSession.findUnique({
    where: { tokenHash: hashGuestToken(parsed.token) },
    select: {
      exerciseId: true,
      participantId: true,
      expiresAt: true,
      participant: { select: { removedAt: true, isGuest: true, exerciseId: true } },
    },
  });
  if (!session) return null;
  if (session.expiresAt <= now) return null;
  if (session.exerciseId !== parsed.exerciseId) return null;
  if (!session.participant || session.participant.removedAt || !session.participant.isGuest) return null;
  if (session.participant.exerciseId !== session.exerciseId) return null;
  return { exerciseId: session.exerciseId, participantId: session.participantId };
}

