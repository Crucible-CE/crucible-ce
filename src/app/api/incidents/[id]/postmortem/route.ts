import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { findAccessibleIncident } from "@/lib/incident/access";
import { parseJsonBody } from "@/lib/http/parse-body";
import { boundedJson } from "@/lib/http/limits";
import { assertIncidentWritable } from "@/lib/incident/lock";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function minutesBetween(a: Date | null, b: Date | null): number | null {
  if (!a || !b) return null;
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
}

// GET /api/incidents/[id]/postmortem — the postmortem (or null), plus computed
// metric suggestions + a timeline seed derived from the incident's timestamps so
// the editor can prefill before the user adjusts.
export async function GET(_req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await context.params;
  const incident = await findAccessibleIncident(session.user, id, {
    id: true,
    title: true,
    severity: true,
    createdAt: true,
    declaredAt: true,
    containedAt: true,
    resolvedAt: true,
  });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const postmortem = await db.incidentPostmortem.findUnique({ where: { incidentId: id } });

  const startAt = postmortem?.incidentStartAt ?? null;
  const suggestedMetrics = {
    mttdMinutes: minutesBetween(startAt, incident.createdAt),
    containmentMinutes: minutesBetween(incident.declaredAt ?? incident.createdAt, incident.containedAt),
    mttrMinutes: minutesBetween(incident.createdAt, incident.resolvedAt),
    dwellMinutes: minutesBetween(startAt, incident.containedAt),
  };

  const timelineSeed = [
    { at: incident.createdAt.toISOString(), label: "Incident reported / detected", kind: "detection" },
    incident.declaredAt && { at: incident.declaredAt.toISOString(), label: "Declared", kind: "milestone" },
    incident.containedAt && { at: incident.containedAt.toISOString(), label: "Contained", kind: "milestone" },
    incident.resolvedAt && { at: incident.resolvedAt.toISOString(), label: "Resolved / recovered", kind: "recovery" },
  ].filter(Boolean);

  return NextResponse.json(
    { postmortem, suggestedMetrics, timelineSeed, incidentSeverity: incident.severity },
    { headers: { "Cache-Control": "no-store" } }
  );
}

const jsonVal = boundedJson(z.any());
const putSchema = z.object({
  status: z.enum(["draft", "in_review", "final"]).optional(),
  summary: z.string().max(10000).optional().nullable(),
  incidentStartAt: z.string().datetime().optional().nullable(),
  metricsJson: jsonVal.optional(),
  impactJson: jsonVal.optional(),
  timelineJson: jsonVal.optional(),
  contributingFactorsJson: jsonVal.optional(),
  wentWellJson: jsonVal.optional(),
  wentPoorlyJson: jsonVal.optional(),
  actionItemsJson: jsonVal.optional(),
  lessonsLearned: z.string().max(10000).optional().nullable(),
});

// PUT /api/incidents/[id]/postmortem — create or update the postmortem.
export async function PUT(req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await context.params;
  const orgId = session.user.organizationId;
  if (!(await findAccessibleIncident(session.user, id, { id: true }))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const locked = await assertIncidentWritable(session.user, { id });
  if (locked) return locked;

  const parsed = await parseJsonBody(req, putSchema);
  if (!parsed.ok) return parsed.response;
  const d = parsed.data;

  const writable = {
    ...(d.status !== undefined ? { status: d.status } : {}),
    ...(d.summary !== undefined ? { summary: d.summary || null } : {}),
    ...(d.incidentStartAt !== undefined ? { incidentStartAt: d.incidentStartAt ? new Date(d.incidentStartAt) : null } : {}),
    ...(d.metricsJson !== undefined ? { metricsJson: d.metricsJson as Prisma.InputJsonValue } : {}),
    ...(d.impactJson !== undefined ? { impactJson: d.impactJson as Prisma.InputJsonValue } : {}),
    ...(d.timelineJson !== undefined ? { timelineJson: d.timelineJson as Prisma.InputJsonValue } : {}),
    ...(d.contributingFactorsJson !== undefined ? { contributingFactorsJson: d.contributingFactorsJson as Prisma.InputJsonValue } : {}),
    ...(d.wentWellJson !== undefined ? { wentWellJson: d.wentWellJson as Prisma.InputJsonValue } : {}),
    ...(d.wentPoorlyJson !== undefined ? { wentPoorlyJson: d.wentPoorlyJson as Prisma.InputJsonValue } : {}),
    ...(d.actionItemsJson !== undefined ? { actionItemsJson: d.actionItemsJson as Prisma.InputJsonValue } : {}),
    ...(d.lessonsLearned !== undefined ? { lessonsLearned: d.lessonsLearned || null } : {}),
    ...(d.status === "final" ? { finalizedAt: new Date() } : {}),
  };

  const postmortem = await db.incidentPostmortem.upsert({
    where: { incidentId: id },
    create: {
      organizationId: orgId,
      incidentId: id,
      createdById: session.user.id,
      createdByName: session.user.name ?? null,
      ...writable,
    },
    update: writable,
  });

  return NextResponse.json(postmortem);
}
