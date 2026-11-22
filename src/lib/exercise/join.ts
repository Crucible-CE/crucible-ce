// Join by code. Public: guests get a Participant {isGuest, roles:[player]} and
// a guest session cookie (set by the route); signed-in users get a normal
// user Participant instead.
//
// Guards:
//   - per-IP limit on every attempt, per-IP limit on failed lookups, per-code limit
//   - a code works only when the exercise has join by code on and is in the
//     lobby, live or paused
//   - wrong codes count in the per-IP failure limit. Validation errors on a
//     right code (taken name, bad name, missing team) count nowhere: they are
//     not guesses. Exercise.joinCodeFailures at JOIN_CODE_MAX_FAILURES still
//     locks a code until it is rotated.
//   - guests per exercise are capped (GUEST_CAP_PER_EXERCISE, default 60) and
//     so are guest joins per IP per exercise (10)
//   - display names are sanitized and unique per exercise

import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/exercise/auth/session";
import { normalizeJoinCode, sanitizeDisplayName, JOIN_CODE_LENGTH } from "@/lib/exercise/auth/guest";
import { SETUP_CODE_ALPHABET } from "@/lib/setup/setup-code";
import { checkRateLimit, ipFromRequest, peekRateLimit, recordRateLimitHit, type RateLimitOptions } from "@/lib/security/rate-limit";
import { bumpVersion } from "@/lib/exercise/runtime/transition";
import { MODE_LABELS } from "@/lib/exercise/modes/registry";
import type { Mode } from "@/lib/exercise/runtime/types";
import { ServiceError } from "./errors";
import { JOIN_CODE_MAX_FAILURES } from "./lobby";
import { readPlan } from "./schemas";
import { uniqueDisplayName } from "./participants";

const JOINABLE = ["lobby", "live", "paused"];
const NO_MATCH = "That code does not match an open exercise. Check it and try again.";
const LOCKED = "This code is locked. Ask the facilitator for a new one.";

export class RateLimitedError extends ServiceError {
  constructor(public retryAfter: number) {
    super(429, "Too many attempts. Try again later.");
  }
}

const ipLimit = (ip: string): RateLimitOptions => ({ namespace: "join:ip", identifier: ip, windowMs: 10 * 60_000, max: 60 });
const ipFailLimit = (ip: string): RateLimitOptions => ({ namespace: "join:ipfail", identifier: ip, windowMs: 15 * 60_000, max: 15 });
const codeLimit = (code: string): RateLimitOptions => ({ namespace: "join:code", identifier: code, windowMs: 10 * 60_000, max: 300 });
/** Guest joins from one IP into one exercise. */
export const GUEST_JOINS_PER_IP = 10;
const guestIpLimit = (exerciseId: string, ip: string): RateLimitOptions => ({
  namespace: "join:guestip",
  identifier: `${exerciseId}:${ip}`,
  windowMs: 24 * 60 * 60_000,
  max: GUEST_JOINS_PER_IP,
});

/** Most guests one exercise takes. GUEST_CAP_PER_EXERCISE overrides the default 60. */
export function guestCap(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.GUEST_CAP_PER_EXERCISE);
  return Number.isInteger(n) && n > 0 ? n : 60;
}
const FULL = "This exercise has no room for more guests. Ask the facilitator for help.";
const IP_FULL = "Too many guests joined from this network. Ask the facilitator for help.";

function wellFormed(code: string): boolean {
  if (code.length !== JOIN_CODE_LENGTH) return false;
  for (const ch of code) if (!SETUP_CODE_ALPHABET.includes(ch)) return false;
  return true;
}

async function limitOrThrow(opts: RateLimitOptions, mode: "check" | "peek") {
  const r = mode === "check" ? await checkRateLimit(opts) : await peekRateLimit(opts);
  if (!r.allowed) throw new RateLimitedError(r.retryAfter);
}

interface Found {
  id: string;
  title: string;
  mode: string;
  status: string;
  guestJoin: boolean;
  joinCodeFailures: number;
  plan: unknown;
}

/** Rate limit, then find the exercise behind a code. Throws ServiceError on any failure. */
async function findByCode(req: Request, rawCode: string): Promise<{ ex: Found; code: string; ip: string }> {
  const ip = ipFromRequest(req);
  await limitOrThrow(ipLimit(ip), "check");
  await limitOrThrow(ipFailLimit(ip), "peek");
  const code = normalizeJoinCode(rawCode);
  if (!wellFormed(code)) {
    await recordRateLimitHit(ipFailLimit(ip));
    throw new ServiceError(404, NO_MATCH);
  }
  await limitOrThrow(codeLimit(code), "check");
  const ex = await db.exercise.findUnique({
    where: { joinCode: code },
    select: { id: true, title: true, mode: true, status: true, guestJoin: true, joinCodeFailures: true, plan: true },
  });
  if (!ex) {
    await recordRateLimitHit(ipFailLimit(ip));
    throw new ServiceError(404, NO_MATCH);
  }
  if (ex.joinCodeFailures >= JOIN_CODE_MAX_FAILURES) throw new ServiceError(403, LOCKED);
  if (!ex.guestJoin || !JOINABLE.includes(ex.status)) {
    await recordRateLimitHit(ipFailLimit(ip));
    throw new ServiceError(404, NO_MATCH);
  }
  return { ex, code, ip };
}

export interface JoinPreview {
  exerciseId: string;
  title: string;
  modeLabel: string;
  status: string;
  teamChoice: boolean;
  teams: Array<{ id: string; name: string }>;
  signedIn: boolean;
  alreadyJoined: boolean;
}

/** What the join page shows for a code. */
export async function previewJoin(req: Request, rawCode: string, user: SessionUser | null): Promise<JoinPreview> {
  const { ex } = await findByCode(req, rawCode);
  const plan = readPlan(ex.plan);
  const teams = await db.team.findMany({ where: { exerciseId: ex.id }, orderBy: { seq: "asc" }, select: { id: true, name: true } });
  let alreadyJoined = false;
  if (user) {
    const p = await db.participant.findUnique({ where: { exerciseId_userId: { exerciseId: ex.id, userId: user.id } }, select: { removedAt: true } });
    alreadyJoined = Boolean(p && !p.removedAt);
  }
  return {
    exerciseId: ex.id,
    title: ex.title,
    modeLabel: MODE_LABELS[ex.mode as Mode] ?? ex.mode,
    status: ex.status,
    teamChoice: plan.guestTeamChoice && teams.length > 0,
    teams: plan.guestTeamChoice ? teams : [],
    signedIn: Boolean(user),
    alreadyJoined,
  };
}

/** The team with the fewest active players, for guests who do not choose. */
async function smallestTeam(exerciseId: string): Promise<string | null> {
  const teams = await db.team.findMany({
    where: { exerciseId },
    orderBy: { seq: "asc" },
    select: { id: true, _count: { select: { participants: { where: { removedAt: null } } } } },
  });
  if (teams.length === 0) return null;
  return [...teams].sort((a, b) => a._count.participants - b._count.participants)[0]!.id;
}

async function pickTeam(ex: Found, requested: string | null | undefined): Promise<string | null> {
  const plan = readPlan(ex.plan);
  const teamCount = await db.team.count({ where: { exerciseId: ex.id } });
  if (teamCount === 0) return null;
  if (!plan.guestTeamChoice) return smallestTeam(ex.id);
  if (!requested) throw new ServiceError(400, "Pick a team.");
  const t = await db.team.findFirst({ where: { id: requested, exerciseId: ex.id }, select: { id: true } });
  if (!t) throw new ServiceError(400, "That team is not part of this exercise. Pick another.");
  return t.id;
}

export type JoinResult =
  | { kind: "guest"; exerciseId: string; participantId: string; displayName: string; teamId: string | null }
  | { kind: "user"; exerciseId: string; participantId: string; created: boolean };

export async function joinByCode(
  req: Request,
  input: { code: string; displayName?: string; title?: string; teamId?: string | null },
  user: SessionUser | null,
): Promise<JoinResult> {
  const { ex, ip } = await findByCode(req, input.code);

  if (user) {
    const existing = await db.participant.findUnique({ where: { exerciseId_userId: { exerciseId: ex.id, userId: user.id } } });
    if (existing?.removedAt) throw new ServiceError(403, "You were removed from this exercise. Ask the facilitator to add you.");
    if (existing) return { kind: "user", exerciseId: ex.id, participantId: existing.id, created: false };
    const teamId = await pickTeam(ex, input.teamId);
    const row = await db.$transaction(async (tx) => {
      const p = await tx.participant.create({
        data: {
          exerciseId: ex.id,
          userId: user.id,
          displayName: await uniqueDisplayName(tx, ex.id, user.name || user.email),
          title: input.title || null,
          teamId,
          roles: ["player"],
          joinedAt: new Date(),
        },
        select: { id: true, displayName: true },
      });
      await tx.exerciseEvent.create({
        data: { exerciseId: ex.id, type: "participant_joined", actorUserId: user.id, actorParticipantId: p.id, data: { displayName: p.displayName, guest: false } },
      });
      await bumpVersion(tx, ex.id);
      return p;
    });
    return { kind: "user", exerciseId: ex.id, participantId: row.id, created: true };
  }

  const name = sanitizeDisplayName(input.displayName ?? "");
  if (!name.ok) throw new ServiceError(400, name.error);
  const clash = await db.participant.findFirst({
    where: { exerciseId: ex.id, displayName: { equals: name.name, mode: "insensitive" } },
    select: { id: true },
  });
  if (clash) throw new ServiceError(409, "That name is taken in this exercise. Pick another.");
  const teamId = await pickTeam(ex, input.teamId);
  const ipCheck = await peekRateLimit(guestIpLimit(ex.id, ip));
  if (!ipCheck.allowed) throw new ServiceError(429, IP_FULL);
  const cap = guestCap();
  try {
    const row = await db.$transaction(async (tx) => {
      // Serialize guest joins per exercise so the cap holds under a burst.
      await tx.$queryRaw`SELECT 1 FROM "Exercise" WHERE id = ${ex.id} FOR UPDATE`;
      const guests = await tx.participant.count({ where: { exerciseId: ex.id, isGuest: true, removedAt: null } });
      if (guests >= cap) throw new ServiceError(409, FULL);
      const p = await tx.participant.create({
        data: {
          exerciseId: ex.id,
          guestName: name.name,
          displayName: name.name,
          title: input.title?.trim().slice(0, 120) || null,
          teamId,
          roles: ["player"],
          isGuest: true,
          joinedAt: new Date(),
        },
        select: { id: true },
      });
      await tx.exerciseEvent.create({
        data: { exerciseId: ex.id, type: "participant_joined", actorParticipantId: p.id, data: { displayName: name.name, guest: true } },
      });
      await bumpVersion(tx, ex.id);
      return p;
    });
    await recordRateLimitHit(guestIpLimit(ex.id, ip));
    return { kind: "guest", exerciseId: ex.id, participantId: row.id, displayName: name.name, teamId };
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new ServiceError(409, "That name is taken in this exercise. Pick another.");
    throw e;
  }
}
