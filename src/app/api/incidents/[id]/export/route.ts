import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { accessibleIncidentsWhere } from "@/lib/incident/access";
import { isSigningConfigured } from "@/lib/export/signing";
import { buildExport } from "@/lib/export/build";
import type { ExportMode } from "@/lib/export/gather";
import { z } from "zod";
import { parseJsonBody } from "@/lib/http/parse-body";
import { LIMITS } from "@/lib/http/limits";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const MODES: ExportMode[] = ["legal", "regulator", "internal"];
const exportSchema = z.object({ mode: z.string().max(LIMITS.TAG).optional() });

// GET /api/incidents/[id]/export — history of case-file exports (no secrets).
export async function GET(_req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.export")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  const incident = await db.incident.findFirst({
    where: { id, ...accessibleIncidentsWhere(session.user) },
    select: { id: true },
  });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const exports = await db.incidentExport.findMany({
    where: { incidentId: id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, mode: true, status: true, packageHash: true, ledgerHead: true,
      sizeBytes: true, requestedByName: true, error: true, createdAt: true, completedAt: true,
    },
  });
  return NextResponse.json({ signingConfigured: isSigningConfigured(), exports }, { headers: { "Cache-Control": "no-store" } });
}

// POST /api/incidents/[id]/export — generate a signed, encrypted case file.
// The one-time passphrase is returned in THIS response only and never stored.
export async function POST(req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.export")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!isSigningConfigured()) {
    return NextResponse.json({ error: "No signing key. Set EXPORT_SIGNING_PRIVATE_KEY to enable exports." }, { status: 503 });
  }

  const { id } = await context.params;
  const incident = await db.incident.findFirst({
    where: { id, ...accessibleIncidentsWhere(session.user) },
    select: { id: true, organizationId: true, isTraining: true },
  });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (incident.isTraining) return NextResponse.json({ error: "Training incidents are not exported." }, { status: 409 });

  // No body → default mode; a body goes through the shared parser (Content-Type,
  // size and NUL guards). An unknown mode string still falls back to "legal".
  const parsed = req.body ? await parseJsonBody(req, exportSchema) : { ok: true as const, data: {} as { mode?: string } };
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const mode = MODES.includes(body.mode as ExportMode) ? (body.mode as ExportMode) : "legal";

  const row = await db.incidentExport.create({
    data: {
      incidentId: id,
      organizationId: incident.organizationId,
      requestedById: session.user.id,
      requestedByName: session.user.name ?? session.user.email ?? "Administrator",
      mode,
      status: "running",
    },
  });

  try {
    const result = await buildExport(row.id);
    return NextResponse.json({
      id: row.id,
      mode,
      passphrase: result.passphrase,
      packageHash: result.packageHash,
      ledgerHead: result.ledgerHead,
      ledgerValid: result.ledgerValid,
      sizeBytes: result.sizeBytes,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Export failed", id: row.id },
      { status: 500 },
    );
  }
}
