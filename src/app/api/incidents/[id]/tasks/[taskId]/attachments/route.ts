import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { appendLedger } from "@/lib/ledger/append";
import { writeEvidence, deleteEvidence } from "@/lib/evidence/storage";
import { findAccessibleIncident } from "@/lib/incident/access";
import { assertIncidentWritable } from "@/lib/incident/lock";
import { safeStoredMimeType } from "@/lib/http/file-response";
import { maxAttachmentBytes, readBoundedMultipart, UploadedFile, withUploadSlot } from "@/lib/http/upload";
import { stripNul } from "@/lib/http/limits";

interface RouteContext {
  params: Promise<{ id: string; taskId: string }>;
}

async function loadTask(orgId: string, incidentId: string, taskId: string) {
  return db.incidentTask.findFirst({ where: { id: taskId, incidentId, organizationId: orgId }, select: { id: true, title: true } });
}

// GET — list attachments (metadata only).
export async function GET(_req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id, taskId } = await context.params;
  if (!(await findAccessibleIncident(session.user, id, { id: true }))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await loadTask(session.user.organizationId, id, taskId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const attachments = await db.incidentTaskAttachment.findMany({
    where: { taskId },
    orderBy: { createdAt: "desc" },
    select: { id: true, filename: true, mimeType: true, sizeBytes: true, sha256: true, uploadedByName: true, createdAt: true },
  });
  return NextResponse.json({ attachments }, { headers: { "Cache-Control": "no-store" } });
}

// POST — upload information to the ticket. Evidence-grade: SHA-256 + ledger; the
// row + file are rolled back if the ledger append fails.
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
  const { id, taskId } = await context.params;
  const orgId = session.user.organizationId;
  if (!(await findAccessibleIncident(session.user, id, { id: true }))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const locked = await assertIncidentWritable(session.user, { id });
  if (locked) return locked;
  const task = await loadTask(orgId, id, taskId);
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Size-capped BEFORE the body is buffered (see lib/http/upload).
  const maxBytes = maxAttachmentBytes();
  const read = await readBoundedMultipart(req, maxBytes);
  if (!read.ok) return read.response;
  const file = read.form.get("file");
  if (!(file instanceof UploadedFile) || file.size === 0) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.size > maxBytes) {
    return NextResponse.json({ error: "File exceeds the upload size limit" }, { status: 413 });
  }

  const buf = file.bytes; // zero-copy view of the request body (see lib/http/upload)
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const filename = (stripNul(file.name) || "attachment").slice(0, 255);
  // Never trust the client type: derive it from the bytes.
  const mimeType = safeStoredMimeType(buf, file.type);
  const uploadedByName = session.user.name ?? session.user.email ?? null;

  const att = await db.incidentTaskAttachment.create({
    data: { organizationId: orgId, incidentId: id, taskId, uploadedById: session.user.id, uploadedByName, filename, mimeType, sizeBytes: file.size, sha256 },
  });

  try {
    await writeEvidence(orgId, id, att.id, buf);
  } catch (err) {
    console.error("[task attachment] write failed:", err);
    await db.incidentTaskAttachment.delete({ where: { id: att.id } }).catch(() => {});
    return NextResponse.json({ error: "Couldn't store the file. Try again." }, { status: 500 });
  }

  try {
    await db.$transaction(async (tx) => {
      await appendLedger(tx, {
        incidentId: id,
        organizationId: orgId,
        eventType: "task_attachment_added",
        actorUserId: session.user.id,
        actorLabel: uploadedByName,
        payload: { taskId, attachmentId: att.id, filename, sha256, sizeBytes: file.size, title: task.title },
      });
    });
  } catch (err) {
    console.error("[task attachment] ledger append failed — rolling back:", err);
    await deleteEvidence(orgId, id, att.id).catch(() => {});
    await db.incidentTaskAttachment.delete({ where: { id: att.id } }).catch(() => {});
    return NextResponse.json({ error: "Couldn't record the upload. Try again." }, { status: 500 });
  }

  return NextResponse.json(att, { status: 201 });
}
