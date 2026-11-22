// closure gate. Read-only preflight run before an incident is closed:
// surfaces soft blockers (missing postmortem) so closing drops a warning
// instead of silently leaving loose ends.
// Soft-block by design — a responder may close with an explicit override; the
// override is recorded on the ledger by the caller.

import { db } from "@/lib/db";

export interface ClosureBlocker {
  code: "missing_postmortem";
  message: string;
  count?: number;
}

export interface ClosureGateResult {
  blockers: ClosureBlocker[];
  requiresOverride: boolean;
}

/**
 * Read-only. Set FEATURE_CLOSURE_REQUIRE_FINAL_POSTMORTEM=true to require a FINAL postmortem
 * (default: existence of any postmortem row is enough).
 */
export async function evaluateClosureGate(incidentId: string): Promise<ClosureGateResult> {
  const postmortem = await db.incidentPostmortem.findUnique({ where: { incidentId }, select: { status: true } });

  const blockers: ClosureBlocker[] = [];
  const requireFinal = process.env.FEATURE_CLOSURE_REQUIRE_FINAL_POSTMORTEM === "true";
  const postmortemOk = postmortem && (!requireFinal || postmortem.status === "final");
  if (!postmortemOk) {
    blockers.push({
      code: "missing_postmortem",
      message: postmortem
        ? "The postmortem isn't finalized."
        : "No postmortem yet.",
    });
  }

  return { blockers, requiresOverride: blockers.length > 0 };
}
