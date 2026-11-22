import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { accessibleIncidentsWhere } from "@/lib/incident/access";
import { appendLedger } from "@/lib/ledger/append";
import { parseJsonBody } from "@/lib/http/parse-body";
import { assertIncidentWritable } from "@/lib/incident/lock";
import { toCsv } from "@/lib/http/csv";
import { fileResponse } from "@/lib/http/file-response";

const TYPES = ["ip", "domain", "url", "file_hash", "email", "account", "host", "other"] as const;

// GET — command-level key indicators. ?export=csv streams a shareable CSV.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session.user, "incidents.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const incident = await db.incident.findFirst({ where: { id, ...accessibleIncidentsWhere(session.user) }, select: { id: true } });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const indicators = await db.incidentIndicator.findMany({ where: { incidentId: id, deletedAt: null }, orderBy: { createdAt: "asc" } });

  if (new URL(req.url).searchParams.get("export") === "csv") {
    // Formula-injection-safe (indicator values are attacker-influenced).
    const csv = toCsv([
      ["type", "value", "status", "source", "shared", "note", "added"],
      ...indicators.map((i) => [i.indicatorType, i.value, i.status, i.source ?? "", String(i.sharedExternally), i.note ?? "", i.createdAt.toISOString()]),
    ]);
    return fileResponse(csv, { filename: `indicators-${id.slice(0, 8)}.csv`, contentType: "text/csv; charset=utf-8", trustedContentType: true });
  }

  return NextResponse.json({ indicators }, { headers: { "Cache-Control": "no-store" } });
}

const postSchema = z.object({
  indicatorType: z.enum(TYPES),
  value: z.string().min(1).max(500),
  status: z.enum(["active", "blocked", "false_positive"]).default("active"),
  source: z.string().max(120).optional(),
  note: z.string().max(500).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session.user, "incidents.edit")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const orgId = session.user.organizationId;
  const incident = await db.incident.findFirst({ where: { id, ...accessibleIncidentsWhere(session.user) }, select: { id: true, restricted: true } });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const locked = await assertIncidentWritable(session.user, incident);
  if (locked) return locked;

  const parsed = await parseJsonBody(req, postSchema);
  if (!parsed.ok) return parsed.response;

  const indicator = await db.$transaction(async (tx) => {
    const ind = await tx.incidentIndicator.create({ data: { organizationId: orgId, incidentId: id, ...parsed.data, createdById: session.user.id } });
    await appendLedger(tx, { incidentId: id, organizationId: orgId, eventType: "indicator_added", actorUserId: session.user.id, actorLabel: session.user.name ?? null, payload: { type: parsed.data.indicatorType, value: parsed.data.value } });
    return ind;
  });
  return NextResponse.json({ indicator });
}
