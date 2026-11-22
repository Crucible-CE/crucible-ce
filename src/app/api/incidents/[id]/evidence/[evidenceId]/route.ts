import { NextResponse } from "next/server";
import { findAccessibleIncident } from "@/lib/incident/access";
import { createHash } from "crypto";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { readEvidence } from "@/lib/evidence/storage";
import { fileResponse } from "@/lib/http/file-response";

interface RouteContext {
  params: Promise<{ id: string; evidenceId: string }>;
}

// GET /api/incidents/[id]/evidence/[evidenceId] — download an evidence file.
// Re-hashes the bytes on read and compares to the stored SHA-256, surfacing a
// custody header so a verifier can confirm the file is unaltered.
export async function GET(req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id, evidenceId } = await context.params;
  const orgId = session.user.organizationId;
  if (!(await findAccessibleIncident(session.user, id, { id: true }))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ev = await db.incidentEvidence.findFirst({
    where: { id: evidenceId, incidentId: id, organizationId: orgId },
  });
  if (!ev) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let bytes: Buffer;
  try {
    bytes = await readEvidence(orgId, id, ev.id);
  } catch {
    return NextResponse.json({ error: "File missing from storage" }, { status: 410 });
  }

  const actual = createHash("sha256").update(bytes).digest("hex");
  const intact = actual === ev.sha256;
  const inline = new URL(req.url).searchParams.get("inline") === "1";

  // Chain-of-custody: record the access.
  try {
    await db.incidentEvidenceAccess.create({
      data: {
        evidenceId: ev.id,
        userId: session.user.id,
        userName: session.user.name ?? null,
        action: inline ? "view" : "download",
      },
    });
  } catch {
    // non-fatal
  }

  // Inline only for passive allowlisted types; anything else (incl. a legacy
  // row stored as text/html) is forced to an octet-stream attachment, with
  // nosniff + a sandbox CSP (lib/http/file-response).
  return fileResponse(bytes, {
    filename: ev.filename,
    contentType: ev.mimeType,
    inline,
    headers: {
      "X-Evidence-Sha256": ev.sha256,
      "X-Evidence-Integrity": intact ? "verified" : "MISMATCH",
    },
  });
}
