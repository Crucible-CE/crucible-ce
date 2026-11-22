import { NextResponse } from "next/server";
import { findAccessibleIncident } from "@/lib/incident/access";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { appendLedger } from "@/lib/ledger/append";
import { parseJsonBody } from "@/lib/http/parse-body";
import { assertIncidentWritable } from "@/lib/incident/lock";

const patchSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  context: z.string().max(5000).optional(),
  decision: z.string().max(5000).optional(),
  rationale: z.string().max(5000).optional(),
  status: z.enum(["open", "decided", "deferred"]).optional(),
  dueAt: z.string().datetime().nullable().optional(),
});

// PATCH /api/incidents/[id]/decisions/[decisionId]
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; decisionId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const parsed = await parseJsonBody(req, patchSchema);
  if (!parsed.ok) return parsed.response;

  const { id, decisionId } = await params;
  const orgId = session.user.organizationId;
  if (!(await findAccessibleIncident(session.user, id, { id: true }))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const locked = await assertIncidentWritable(session.user, { id });
  if (locked) return locked;
  const userId = session.user.id;

  const existing = await db.incidentDecision.findFirst({
    where: { id: decisionId, incidentId: id, organizationId: orgId },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const decided = parsed.data.status === "decided";
  const updated = await db.$transaction(async (tx) => {
    const d = await tx.incidentDecision.update({
      where: { id: decisionId },
      data: {
        title: parsed.data.title,
        context: parsed.data.context,
        decision: parsed.data.decision,
        rationale: parsed.data.rationale,
        status: parsed.data.status,
        dueAt:
          parsed.data.dueAt === undefined
            ? undefined
            : parsed.data.dueAt
              ? new Date(parsed.data.dueAt)
              : null,
        decidedById: decided ? userId : undefined,
        decidedAt: decided ? new Date() : undefined,
      },
    });
    await appendLedger(tx, {
      incidentId: id,
      organizationId: orgId,
      eventType: "decision_made",
      actorUserId: userId,
      actorLabel: session.user.name ?? session.user.email ?? null,
      payload: { decisionId, status: d.status, kind: "updated" },
    });
    return d;
  });

  return NextResponse.json(updated);
}
