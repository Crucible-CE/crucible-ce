// Acknowledging the onboarding self test page (see ./test-page). Kept apart
// from the sender so the public ack route only pulls in the database.

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { TEST_PAGE_KEY, readTestPage, type TestPageState } from "./state";

export interface TestPageRecord {
  state: TestPageState;
  userId: string;
  userName: string | null;
  updatedAt: Date;
}

/** The test page behind an ack token's page id, or null when it is not one. */
export async function findTestPage(id: string): Promise<TestPageRecord | null> {
  const row = await db.onboardingState.findUnique({
    where: { id },
    select: { id: true, scope: true, key: true, subjectId: true, value: true, updatedAt: true },
  });
  if (!row || row.scope !== "user" || row.key !== TEST_PAGE_KEY) return null;
  const state = readTestPage(row.id, row.value);
  if (!state) return null;
  const user = await db.user.findUnique({ where: { id: row.subjectId }, select: { name: true, email: true, isActive: true } });
  if (!user?.isActive) return null;
  return { state, userId: row.subjectId, userName: user.name ?? user.email, updatedAt: row.updatedAt };
}

/** Why a test page cannot be acknowledged with this level, or null when it can. */
export function testPageStateMessage(state: TestPageState, level: number | undefined): string | null {
  if (state.ackedAt) return "This test page has already been acknowledged.";
  if (level !== undefined && level !== state.seq) return "A newer test page was sent. Use the latest link.";
  return null;
}

/**
 * Guarded ack: wins only if the row is unchanged since it was read (a newer
 * send or a concurrent ack changes updatedAt), so a double tap records one ack.
 */
export async function ackTestPage(rec: TestPageRecord, via: "app" | "link", level?: number, now: Date = new Date()): Promise<boolean> {
  if (testPageStateMessage(rec.state, level)) return false;
  const { id, ...rest } = rec.state;
  const next = { ...rest, ackedAt: now.toISOString(), ackedVia: via, everAckedAt: rest.everAckedAt ?? now.toISOString() };
  const r = await db.onboardingState.updateMany({
    where: { id, updatedAt: rec.updatedAt },
    data: { value: next as unknown as Prisma.InputJsonValue },
  });
  return r.count === 1;
}
