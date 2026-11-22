import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { accessibleIncidentsWhere } from "@/lib/incident/access";
import { readExportPackage } from "@/lib/export/storage";
import { decryptPackage } from "@/lib/export/build";
import { fileResponse } from "@/lib/http/file-response";

interface RouteContext {
  params: Promise<{ id: string; exportId: string }>;
}

// GET /api/incidents/[id]/export/[exportId]/download
//   default            -> the encrypted .cxz package
//   ?format=zip + header x-export-passphrase -> decrypted .zip (convenience)
export async function GET(req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.export")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id, exportId } = await context.params;
  const incident = await db.incident.findFirst({
    where: { id, ...accessibleIncidentsWhere(session.user) },
    select: { id: true, organizationId: true },
  });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const row = await db.incidentExport.findFirst({
    where: { id: exportId, incidentId: id },
    select: { id: true, status: true, organizationId: true },
  });
  if (!row || row.status !== "ready") {
    return NextResponse.json({ error: "Export not available" }, { status: 404 });
  }

  let cxz: Buffer;
  try {
    cxz = await readExportPackage(row.organizationId, id, row.id);
  } catch {
    return NextResponse.json({ error: "Package missing from storage" }, { status: 410 });
  }

  const url = new URL(req.url);
  const stamp = new Date().toISOString().slice(0, 10);

  if (url.searchParams.get("format") === "zip") {
    const passphrase = req.headers.get("x-export-passphrase");
    if (!passphrase) {
      return NextResponse.json({ error: "Enter the passphrase." }, { status: 400 });
    }
    try {
      const zip = decryptPackage(cxz, passphrase);
      return fileResponse(zip, {
        filename: `casefile-${id.slice(0, 8)}-${stamp}.zip`,
        contentType: "application/zip",
        trustedContentType: true,
      });
    } catch {
      return NextResponse.json({ error: "Wrong passphrase or damaged package." }, { status: 400 });
    }
  }

  return fileResponse(cxz, { filename: `casefile-${id.slice(0, 8)}-${stamp}.cxz`, contentType: "application/octet-stream" });
}
