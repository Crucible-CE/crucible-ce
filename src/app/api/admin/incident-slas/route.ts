import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAdminContext } from "@/lib/auth/admin-guard";
import { getOrgSlaMatrix, DEFAULT_SLA, SLA_SEVERITIES, SLA_MILESTONES } from "@/lib/incident/sla";
import { logAudit } from "@/lib/audit/log";
import { parseJsonBody } from "@/lib/http/parse-body";

// Org-admin internal response SLA matrix (severity x milestone -> minutes).
export async function GET() {
  const ctx = await getAdminContext();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const matrix = await getOrgSlaMatrix(ctx.organizationId);
  return NextResponse.json({ matrix, defaults: DEFAULT_SLA, severities: SLA_SEVERITIES, milestones: SLA_MILESTONES }, { headers: { "Cache-Control": "no-store" } });
}

const putSchema = z.object({
  entries: z.array(z.object({
    severity: z.enum(SLA_SEVERITIES),
    milestone: z.enum(SLA_MILESTONES),
    targetMinutes: z.number().int().min(0).max(525600),
  })).max(64),
});

export async function PUT(req: Request) {
  const ctx = await getAdminContext();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = await parseJsonBody(req, putSchema);
  if (!parsed.ok) return parsed.response;

  for (const e of parsed.data.entries) {
    await db.orgIncidentSla.upsert({
      where: { organizationId_severity_milestone: { organizationId: ctx.organizationId, severity: e.severity, milestone: e.milestone } },
      create: { organizationId: ctx.organizationId, severity: e.severity, milestone: e.milestone, targetMinutes: e.targetMinutes, updatedById: ctx.userId },
      update: { targetMinutes: e.targetMinutes, updatedById: ctx.userId },
    });
  }
  await logAudit({ actorUserId: ctx.userId, actorEmail: ctx.email, actorName: ctx.name, organizationId: ctx.organizationId, action: "incident_sla.updated", targetType: "OrgIncidentSla", targetId: ctx.organizationId, metadata: { count: parsed.data.entries.length } });

  const matrix = await getOrgSlaMatrix(ctx.organizationId);
  return NextResponse.json({ matrix });
}
