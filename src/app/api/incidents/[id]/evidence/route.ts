import { NextResponse } from "next/server";
import { accessibleIncidentsWhere } from "@/lib/incident/access";
import { createHash } from "crypto";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { appendLedger } from "@/lib/ledger/append";
import { writeEvidence, deleteEvidence } from "@/lib/evidence/storage";
import { assertIncidentWritable } from "@/lib/incident/lock";
import { safeStoredMimeType } from "@/lib/http/file-response";
import { maxAttachmentBytes, readBoundedMultipart, UploadedFile, withUploadSlot } from "@/lib/http/upload";
import { stripNul } from "@/lib/http/limits";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/incidents/[id]/evidence — list evidence (metadata only).
export async function GET(_req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  const incident = await db.incident.findFirst({
    where: { id, ...accessibleIncidentsWhere(session.user) },
    select: { id: true },
  });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const evidence = await db.incidentEvidence.findMany({
    where: { incidentId: id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      filename: true,
      mimeType: true,
      sizeBytes: true,
      sha256: true,
      category: true,
      description: true,
      uploadedByName: true,
      createdAt: true,
      _count: { select: { accesses: true } },
    },
  });
  return NextResponse.json({ evidence }, { headers: { "Cache-Control": "no-store" } });
}

// POST /api/incidents/[id]/evidence — upload an evidence file (multipart).
// Persists the bytes, records metadata + a SHA-256 hash, and commits that hash
// to the tamper-evident ledger (evidence_added).
// Wrapped: at most MAX_CONCURRENT_UPLOADS uploads in flight per process (503 + Retry-After beyond).
export const POST = withUploadSlot(handleUpload);

async function handleUpload(req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  const orgId = session.user.organizationId;
  const incident = await db.incident.findFirst({
    where: { id, ...accessibleIncidentsWhere(session.user) },
    select: { id: true },
  });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const locked = await assertIncidentWritable(session.user, { id });
  if (locked) return locked;

  // Size-capped BEFORE the body is buffered (see lib/http/upload).
  const maxBytes = maxAttachmentBytes();
  const read = await readBoundedMultipart(req, maxBytes);
  if (!read.ok) return read.response;
  const form = read.form;

  const file = form.get("file");
  if (!(file instanceof UploadedFile) || file.size === 0) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.size > maxBytes) {
    return NextResponse.json({ error: "File exceeds the upload size limit" }, { status: 413 });
  }

  const descriptionRaw = form.get("description");
  const description =
    typeof descriptionRaw === "string" && descriptionRaw.trim()
      ? stripNul(descriptionRaw).trim().slice(0, 1000)
      : null;
  const categoryRaw = form.get("category");
  const category = typeof categoryRaw === "string" && categoryRaw.trim() ? stripNul(categoryRaw).trim().slice(0, 40) : null;

  const buf = file.bytes; // zero-copy view of the request body (see lib/http/upload)
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const uploadedByName = session.user.name ?? session.user.email ?? null;
  const filename = (stripNul(file.name) || "evidence").slice(0, 255);
  // Never trust the client type: derive it from the bytes (HTML/SVG/etc are
  // stored as application/octet-stream and only ever served as a download).
  const mimeType = safeStoredMimeType(buf, file.type);

  const ev = await db.incidentEvidence.create({
    data: {
      incidentId: id,
      organizationId: orgId,
      uploadedById: session.user.id,
      uploadedByName,
      filename,
      mimeType,
      sizeBytes: file.size,
      sha256,
      category,
      description,
    },
  });

  try {
    await writeEvidence(orgId, id, ev.id, buf);
  } catch (err) {
    console.error("[evidence] write failed:", err);
    await db.incidentEvidence.delete({ where: { id: ev.id } }).catch(() => {});
    return NextResponse.json({ error: "Couldn't store the file. Try again." }, { status: 500 });
  }

  // The hash MUST land on the ledger for chain of custody. If it doesn't, undo
  // the row + file so we never have evidence outside the tamper-evident chain.
  try {
    await db.$transaction(async (tx) => {
      await appendLedger(tx, {
        incidentId: id,
        organizationId: orgId,
        eventType: "evidence_added",
        actorUserId: session.user.id,
        actorLabel: uploadedByName,
        payload: { evidenceId: ev.id, filename, sha256, sizeBytes: file.size, mimeType },
      });
    });
  } catch (err) {
    console.error("[evidence] ledger append failed — rolling back:", err);
    await deleteEvidence(orgId, id, ev.id).catch(() => {});
    await db.incidentEvidence.delete({ where: { id: ev.id } }).catch(() => {});
    return NextResponse.json({ error: "Couldn't record the upload. Try again." }, { status: 500 });
  }

  return NextResponse.json(ev, { status: 201 });
}
