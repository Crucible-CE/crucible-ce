// Render inputs for AAR exports, and the final PDF kept at finalize.
//
// A final version's PDF is rendered once, stored as a StoredFile (sha256 on
// the row) and served byte for byte afterwards: the PDF export, the evidence
// bundle and any later download are the same file.

import { db } from "@/lib/db";
import { ServiceError } from "@/lib/exercise/errors";
import { getExerciseSettings } from "@/lib/exercise/settings";
import { confidentialityMarking } from "@/lib/exercise/program/policy";
import { readStoredFile, saveUpload, deleteStoredFile } from "@/lib/exercise/files";
import { parseStoredEnvelope, type SignedAarDocument } from "./document";
import type { SignedEnvelope } from "./sign";
import type { AarRenderMeta } from "./labels";

/** Organization name, time zone and marking, plus the signature block for a final version. */
export async function renderMetaFor(envelope: SignedEnvelope<SignedAarDocument> | null): Promise<AarRenderMeta> {
  const instance = await getExerciseSettings();
  return {
    instanceName: instance?.name ?? "Crucible CE",
    timezone: instance?.timezone ?? "UTC",
    draft: !envelope,
    signature: envelope ? { keyId: envelope.keyId, signedAt: envelope.signedAt, contentHash: envelope.contentHash } : null,
    marking: await confidentialityMarking(),
  };
}

/**
 * The stored final PDF of a final version: render and store it the first
 * time, then return the stored bytes. Two callers racing keep one file.
 */
export async function ensureFinalPdf(aarId: string): Promise<{ bytes: Buffer; sha256: string; fileId: string }> {
  const aar = await db.afterActionReport.findUnique({ where: { id: aarId }, select: { status: true, canonical: true, finalPdfFileId: true, version: true } });
  if (!aar) throw new ServiceError(404, "Report not found.");
  if (aar.status !== "final") throw new ServiceError(409, "Only a final report has a stored PDF.");
  if (aar.finalPdfFileId) {
    const stored = await readStoredFile(aar.finalPdfFileId);
    if (stored) return { bytes: stored.bytes, sha256: stored.file.sha256, fileId: stored.file.id };
    // The file is gone from disk; fall through and store it again.
  }
  const envelope = parseStoredEnvelope(aar.canonical);
  if (!envelope) throw new ServiceError(500, "The signed report could not be read.");
  const { renderAarPdf } = await import("./pdf");
  const bytes = await renderAarPdf(envelope.document, await renderMetaFor(envelope));
  const file = await saveUpload(bytes, { mime: "application/pdf", originalName: `aar-v${aar.version}.pdf` });
  const claimed = await db.afterActionReport.updateMany({
    where: { id: aarId, status: "final", finalPdfFileId: aar.finalPdfFileId },
    data: { finalPdfFileId: file.id },
  });
  if (claimed.count === 1) return { bytes, sha256: file.sha256, fileId: file.id };
  // Someone else stored it first: keep theirs.
  await deleteStoredFile(file.id).catch(() => {});
  const winner = await db.afterActionReport.findUnique({ where: { id: aarId }, select: { finalPdfFileId: true } });
  const stored = winner?.finalPdfFileId ? await readStoredFile(winner.finalPdfFileId) : null;
  if (!stored) throw new ServiceError(500, "The final PDF could not be stored.");
  return { bytes: stored.bytes, sha256: stored.file.sha256, fileId: stored.file.id };
}
