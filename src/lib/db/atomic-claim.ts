// Atomic compare-and-swap convention (foundations §2.3).
//
// Any state transition that must happen exactly once (ack, publish, close,
// approve, claim) should be a guarded `updateMany` whose WHERE includes the
// expected pre-state, NOT a findFirst-then-update (which races under concurrency).
// `claimOne` wraps that updateMany and reports whether THIS caller won the race.
//
// Usage:
//   const won = await claimOne(
//     db.incidentPage.updateMany({
//       where: { id, status: "sent" },        // guard on the expected pre-state
//       data:  { status: "acknowledged" },
//     }),
//   );
//   if (!won) return NextResponse.json({ error: "Already handled" }, { status: 409 });
export async function claimOne(update: Promise<{ count: number }>): Promise<boolean> {
  const result = await update;
  return result.count === 1;
}

/**
 * Thrown inside an interactive $transaction when a CAS guard matches 0 rows —
 * the transition already happened (someone else won). Callers catch it outside
 * the tx and return 409.
 */
export class ClaimRace extends Error {
  constructor(message = "resource changed concurrently") {
    super(message);
    this.name = "ClaimRace";
  }
}

/** Standard 409 body for a lost optimistic-concurrency race. */
export const CONCURRENCY_CONFLICT = {
  error: "Conflict: this resource was modified by someone else. Reload and retry.",
} as const;

/** True for a Prisma P2002 unique-constraint violation (duck-typed so callers
 * don't need the Prisma error class). */
export function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === "P2002";
}
