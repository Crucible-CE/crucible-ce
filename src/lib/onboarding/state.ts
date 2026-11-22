// Persisted onboarding bookkeeping (OnboardingState rows). Only what cannot be
// derived from real data lives here: the welcome-modal dismissal, a hidden Ops
// Room card, skipped optional steps and the self-sent test page.

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export type OnboardingScope = "user" | "org";

export const WELCOME_DISMISSED_KEY = "welcome_dismissed";
export const CARD_HIDDEN_KEY = "card_hidden";
export const TEST_PAGE_KEY = "test_page";
export const skipKey = (step: string) => `skip:${step}`;

export interface TestPageState {
  /** OnboardingState row id; doubles as the page id in the signed ack link. */
  id: string;
  /** Send counter (0-999), bound into the ack token like an escalation level. */
  seq: number;
  sentAt: string;
  /** Set when at least one channel accepted the test page. */
  deliveredAt: string | null;
  channels: { provider: string; channel: string; status: string; error?: string | null }[];
  /** Acknowledgement of THIS send (null while it awaits an ack). */
  ackedAt: string | null;
  ackedVia: string | null;
  /** First acknowledgement ever: the onboarding step stays done across re-sends. */
  everAckedAt: string | null;
}

/** Parse a stored test-page value; null for anything malformed. */
export function readTestPage(id: string, value: unknown): TestPageState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.seq !== "number" || typeof v.sentAt !== "string") return null;
  const str = (x: unknown) => (typeof x === "string" ? x : null);
  return {
    id,
    seq: v.seq,
    sentAt: v.sentAt,
    deliveredAt: str(v.deliveredAt),
    channels: Array.isArray(v.channels) ? (v.channels as TestPageState["channels"]) : [],
    ackedAt: str(v.ackedAt),
    ackedVia: str(v.ackedVia),
    everAckedAt: str(v.everAckedAt),
  };
}

/** Every key -> value for one subject. */
export async function loadStates(scope: OnboardingScope, subjectId: string): Promise<Map<string, Prisma.JsonValue | null>> {
  const rows = await db.onboardingState.findMany({ where: { scope, subjectId }, select: { key: true, value: true } });
  return new Map(rows.map((r) => [r.key, r.value]));
}

export async function setState(scope: OnboardingScope, subjectId: string, key: string, value: Prisma.InputJsonValue = true): Promise<void> {
  await db.onboardingState.upsert({
    where: { scope_subjectId_key: { scope, subjectId, key } },
    create: { scope, subjectId, key, value },
    update: { value },
  });
}

export async function clearState(scope: OnboardingScope, subjectId: string, key: string): Promise<void> {
  await db.onboardingState.deleteMany({ where: { scope, subjectId, key } });
}

/** Step keys skipped for a subject (keys stored as "skip:<step>"). */
export function skippedSteps(states: Map<string, unknown>): Set<string> {
  const out = new Set<string>();
  for (const k of states.keys()) if (k.startsWith("skip:")) out.add(k.slice(5));
  return out;
}
