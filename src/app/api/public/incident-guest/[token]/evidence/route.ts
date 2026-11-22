import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { appendLedger } from "@/lib/ledger/append";
import { writeEvidence, deleteEvidence } from "@/lib/evidence/storage";
import { GUEST_HEADERS, guestGate } from "@/lib/incident/guest";
import { safeStoredMimeType } from "@/lib/http/file-response";
import { maxAttachmentBytes, readBoundedMultipart, UploadedFile, withUploadSlot } from "@/lib/http/upload";
import { stripNul } from "@/lib/http/limits";

interface RouteContext {
  params: Promise<{ token: string }>;
}

// GET /api/public/incident-guest/[token]/evidence: the incident's evidence
// list (metadata only; guests cannot download files).
export async function GET(req: Request, context: RouteContext) {
  const { token } = await context.params;
  const gate = await guestGate(req, token, "read");
  if (!gate.ok) return gate.response;
  const evidence = await db.incidentEvidence.findMany({
    where: { incidentId: gate.ctx.incidentId },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: { id: true, filename: true, sizeBytes: true, sha256: true, category: true, uploadedByName: true, createdAt: true },
  });
  return NextResponse.json({ evidence }, { headers: GUEST_HEADERS });
}

// POST /api/public/incident-guest/[token]/evidence: a guest uploads evidence,
// when the invite allows it. Same chain of custody as a responder upload:
// SHA-256 on the row and on the ledger, rolled back if the ledger write fails.
export const POST = withUploadSlot(handleUpload);

async function handleUpload(req: Request, context: RouteContext) {
  const { token } = await context.params;
  const gate = await guestGate(req, token, "upload");
  if (!gate.ok) return gate.response;
  const { ctx } = gate;
  if (!ctx.canUpload) return NextResponse.json({ error: "This link does not allow uploads." }, { status: 403, headers: GUEST_HEADERS });

  const maxBytes = maxAttachmentBytes();
  const read = await readBoundedMultipart(req, maxBytes);
  if (!read.ok) return read.response;
  const file = read.form.get("file");
  if (!(file instanceof UploadedFile) || file.size === 0) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (file.size > maxBytes) return NextResponse.json({ error: "File exceeds the upload size limit" }, { status: 413 });
  const descriptionRaw = read.form.get("description");
  const description = typeof descriptionRaw === "string" && descriptionRaw.trim() ? stripNul(descriptionRaw).trim().slice(0, 1000) : null;

  const buf = file.bytes;
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const filename = (stripNul(file.name) || "evidence").slice(0, 255);
  const mimeType = safeStoredMimeType(buf, file.type);

  const ev = await db.incidentEvidence.create({
    data: {
      incidentId: ctx.incidentId,
      organizationId: ctx.organizationId,
      uploadedById: ctx.principalId,
      uploadedByName: ctx.displayName,
      filename,
      mimeType,
      sizeBytes: file.size,
      sha256,
      category: "guest",
      description,
    },
    select: { id: true, filename: true, sizeBytes: true, sha256: true, category: true, uploadedByName: true, createdAt: true },
  });

  try {
    await writeEvidence(ctx.organizationId, ctx.incidentId, ev.id, buf);
  } catch (err) {
    console.error("[guest evidence] write failed:", err);
    await db.incidentEvidence.delete({ where: { id: ev.id } }).catch(() => {});
    return NextResponse.json({ error: "Couldn't store the file. Try again." }, { status: 500 });
  }

  try {
    await db.$transaction(async (tx) => {
      await appendLedger(tx, {
        incidentId: ctx.incidentId,
        organizationId: ctx.organizationId,
        eventType: "evidence_added",
        actorUserId: null,
        actorLabel: ctx.displayName,
        payload: { evidenceId: ev.id, filename, sha256, sizeBytes: file.size, mimeType, guestInviteId: ctx.inviteId },
      });
    });
  } catch (err) {
    console.error("[guest evidence] ledger append failed, rolling back:", err);
    await deleteEvidence(ctx.organizationId, ctx.incidentId, ev.id).catch(() => {});
    await db.incidentEvidence.delete({ where: { id: ev.id } }).catch(() => {});
    return NextResponse.json({ error: "Couldn't record the upload. Try again." }, { status: 500 });
  }

  return NextResponse.json(ev, { status: 201, headers: GUEST_HEADERS });
}
