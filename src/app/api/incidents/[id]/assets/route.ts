import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { accessibleIncidentsWhere } from "@/lib/incident/access";
import { parseJsonBody } from "@/lib/http/parse-body";
import { assertIncidentWritable } from "@/lib/incident/lock";

const ASSET_TYPES = ["host", "account", "service", "data_store", "network", "application", "other"] as const;
const CRITICALITY = ["critical", "high", "medium", "low"] as const;
const ASSET_STATUS = ["affected", "investigating", "contained", "eradicated", "clean"] as const;
const DATA_CLASS = ["pii", "phi", "pci", "financial", "ip", "confidential", "none"] as const;
const CONTAINED_STATUSES = ["contained", "eradicated", "clean"];

// GET — affected assets (scope / blast-radius board).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session.user, "incidents.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const incident = await db.incident.findFirst({ where: { id, ...accessibleIncidentsWhere(session.user) }, select: { id: true } });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const assets = await db.incidentAsset.findMany({ where: { incidentId: id, deletedAt: null }, orderBy: [{ criticality: "asc" }, { createdAt: "asc" }] });
  return NextResponse.json({ assets }, { headers: { "Cache-Control": "no-store" } });
}

const assetSchema = z.object({
  name: z.string().min(1).max(200),
  assetType: z.enum(ASSET_TYPES).default("host"),
  identifier: z.string().max(300).optional(),
  criticality: z.enum(CRITICALITY).default("medium"),
  status: z.enum(ASSET_STATUS).default("affected"),
  dataClassification: z.enum(DATA_CLASS).optional(),
  owner: z.string().max(120).optional(),
  sourceIndicatorId: z.string().max(40).optional(),
  notes: z.string().max(1000).optional(),
});
// Single asset, or { items: [...] } for bulk capture (paste a host/IP list).
const postSchema = z.union([assetSchema, z.object({ items: z.array(assetSchema).min(1).max(200) })]);

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

  const items = "items" in parsed.data ? parsed.data.items : [parsed.data];
  const now = new Date();
  await db.incidentAsset.createMany({
    data: items.map((a) => ({
      organizationId: orgId,
      incidentId: id,
      createdById: session.user.id!,
      ...a,
      // Stamp containment time if it starts already contained.
      containedAt: CONTAINED_STATUSES.includes(a.status) ? now : null,
    })),
  });

  const assets = await db.incidentAsset.findMany({ where: { incidentId: id, deletedAt: null }, orderBy: [{ criticality: "asc" }, { createdAt: "asc" }] });
  return NextResponse.json({ created: items.length, assets });
}
