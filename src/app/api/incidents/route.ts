import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { accessibleIncidentsWhere } from "@/lib/incident/access";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { parseJsonBody } from "@/lib/http/parse-body";
import { LIMITS, hasNul } from "@/lib/http/limits";
import { parsePageParams, toPage, idCursorWhere, PAGINATED_HEADERS } from "@/lib/http/paginate";
import { ensureIncidentParticipants } from "@/lib/incident/participants";

const createSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().min(1).max(LIMITS.DESCRIPTION),
  severity: z.enum(["critical", "high", "medium", "low"]).optional(),
  category: z.string().max(LIMITS.SHORT_LABEL).optional(),
  assignedToId: z.string().max(LIMITS.ID).optional(),
  affectedSystems: z.array(z.string().max(LIMITS.NAME)).max(LIMITS.ARRAY).optional(),
  mitreJson: z.array(z.string().max(LIMITS.SHORT_LABEL)).max(LIMITS.ARRAY).optional(),
});

// GET /api/incidents
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasPermission(session.user, "incidents.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  // Opt-in pagination: `?take=`/`?cursor=` → { items, nextCursor } envelope;
  // no params → legacy bare array (bounded at 100 as a safety cap).
  const page = parsePageParams(url, { defaultTake: 50, maxTake: 100 });

  const status = url.searchParams.get("status");
  const severity = url.searchParams.get("severity");
  // Postgres text rejects \u0000 — a NUL in a filter would surface as a 500.
  if ((status && (hasNul(status) || status.length > LIMITS.TAG)) || (severity && (hasNul(severity) || severity.length > LIMITS.TAG))) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  // Restricted incidents stay out of the org-wide list unless the viewer is a
  // participant, the IC, or an administrator; soft-deleted incidents never show.
  const where: Record<string, unknown> = {
    ...accessibleIncidentsWhere(session.user, { excludeTraining: true }),
    ...(page.paginated ? idCursorWhere(page.cursor) : {}),
  };
  if (status) where.status = status;
  if (severity) where.severity = severity;

  const incidents = await db.incident.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: page.paginated ? page.take + 1 : 100,
    include: {
      reportedBy: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
    },
  });

  if (!page.paginated) return NextResponse.json(incidents);

  const { items, nextCursor } = toPage(incidents, page.take, (r) => r.id);
  return NextResponse.json({ items, nextCursor }, { headers: PAGINATED_HEADERS });
}

// POST /api/incidents
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasPermission(session.user, "incidents.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = await parseJsonBody(req, createSchema);
  if (!parsed.ok) return parsed.response;

  const data = parsed.data;

  if (data.assignedToId) {
    const assignee = await db.user.findUnique({
      where: { id: data.assignedToId },
      select: { id: true, organizationId: true, isActive: true },
    });

    if (!assignee || !assignee.isActive) {
      return NextResponse.json({ error: "Assigned user not found" }, { status: 400 });
    }

    if (assignee.organizationId !== session.user.organizationId) {
      return NextResponse.json(
        { error: "Assignee must be in your organization." },
        { status: 403 }
      );
    }
  }

  const incident = await db.incident.create({
    data: {
      organizationId: session.user.organizationId,
      reportedById: session.user.id,
      title: data.title,
      description: data.description,
      severity: data.severity ?? "medium",
      category: data.category,
      assignedToId: data.assignedToId,
      affectedSystems: data.affectedSystems,
      mitreJson: data.mitreJson,
      timelineJson: [
        {
          timestamp: new Date().toISOString(),
          event: "Incident reported",
          userId: session.user.id,
        },
      ],
    },
  });

  // Founder lock rule: the reporter and assignee get no implicit access to a
  // locked incident — they are enrolled here as ordinary (removable)
  // participants, so a later lock keeps them in the room via the allowlist.
  await ensureIncidentParticipants({
    organizationId: session.user.organizationId,
    incidentId: incident.id,
    userIds: [session.user.id, data.assignedToId],
    addedBy: { id: session.user.id, name: session.user.name ?? null },
  }).catch((err) => console.error("[incident] participant enrolment failed:", err));

  return NextResponse.json(incident, { status: 201 });
}
