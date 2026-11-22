// Private ICS subscription feed token.
//
// One random token per organization. Only its sha256 is stored, in
// ExerciseSettings.policy.icsFeedTokenHash, so the feed URL is shown once when it is
// made and can be replaced (rotated) or turned off at any time. The token is
// not derived from the session secret, so it can be revoked on its own.

import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db, type DbClient } from "@/lib/db";
import { secureEqual } from "@/lib/security/secure-compare";
import { getExerciseSettings, lockExerciseSettings } from "@/lib/exercise/settings";

export const FEED_TOKEN_KEY = "icsFeedTokenHash";

export function hashFeedToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function newFeedToken(): string {
  return randomBytes(32).toString("base64url");
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** The stored hash from an ExerciseSettings.policy value, or null. */
export function feedTokenHashOf(policy: unknown): string | null {
  const h = asRecord(policy)[FEED_TOKEN_KEY];
  return typeof h === "string" && /^[0-9a-f]{64}$/.test(h) ? h : null;
}

/** Constant time check of a presented token against the stored hash. */
export function feedTokenMatches(token: string | null | undefined, storedHash: string | null): boolean {
  if (!storedHash || !token) return false;
  if (token.length < 20 || token.length > 200 || !/^[A-Za-z0-9_-]+$/.test(token)) return false;
  return secureEqual(hashFeedToken(token), storedHash);
}

export async function feedEnabled(client: DbClient = db): Promise<boolean> {
  const i = await getExerciseSettings(client);
  return feedTokenHashOf(i?.policy) !== null;
}

/** Set (token) or clear (null) the stored hash. Other policy keys stay as they are. */
async function writeHash(hash: string | null): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const i = await lockExerciseSettings(tx);
    if (!i) return false;
    const next: Record<string, unknown> = { ...asRecord(i.policy) };
    if (hash) next[FEED_TOKEN_KEY] = hash;
    else delete next[FEED_TOKEN_KEY];
    await tx.exerciseSettings.update({ where: { organizationId: i.organizationId }, data: { policy: next as Prisma.InputJsonValue } });
    return true;
  });
}

/** Make a new token. The old feed URL stops working. Returns the token, or null before setup. */
export async function rotateFeedToken(): Promise<string | null> {
  const token = newFeedToken();
  return (await writeHash(hashFeedToken(token))) ? token : null;
}

export async function disableFeed(): Promise<boolean> {
  return writeHash(null);
}
