// GET /api/exercises/{id}/aar/export?format=pdf|docx|bundle[&aarId=]   control
// Final versions export the signed snapshot (and the evidence bundle). The
// final PDF is the file stored at finalize, served byte for byte.
// Drafts export PDF and DOCX marked "Draft"; no bundle until final.
import { audit } from "@/lib/exercise/audit";
import { db } from "@/lib/db";
import { ensureFinalPdf, renderMetaFor } from "@/lib/exercise/aar/render";
import { fileResponse } from "@/lib/http/file-response";
import { ServiceError, withErrors } from "@/lib/exercise/errors";
import { userAccess } from "@/lib/exercise/hotwash/access";
import { aarInExercise, slug } from "@/lib/exercise/aar/route-helpers";
import { buildSignedDocument, parseStoredEnvelope } from "@/lib/exercise/aar/document";
import { renderAarPdf } from "@/lib/exercise/aar/pdf";
import { renderAarDocx } from "@/lib/exercise/aar/docx";
import { buildEvidenceBundle } from "@/lib/exercise/aar/bundle";
import type { AarRenderMeta } from "@/lib/exercise/aar/labels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FORMATS = ["pdf", "docx", "bundle"] as const;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withErrors(async () => {
    const { id } = await params;
    const a = await userAccess(id, "control");
    const url = new URL(req.url);
    const format = url.searchParams.get("format") ?? "pdf";
    if (!(FORMATS as readonly string[]).includes(format)) throw new ServiceError(400, "Pick pdf, docx or bundle.");
    const aar = await aarInExercise(id, url.searchParams.get("aarId"));
    const [ex, full] = await Promise.all([
      db.exercise.findUnique({ where: { id }, select: { title: true } }),
      db.afterActionReport.findUnique({ where: { id: aar.id }, select: { status: true, canonical: true } }),
    ]);
    const base = `aar-${slug(ex?.title ?? "exercise")}-v${aar.version}${aar.status === "final" ? "" : "-draft"}`;

    audit({
      actorUserId: a.user.id,
      actorParticipantId: a.participant?.id ?? null,
      action: "aar.exported",
      targetType: "AfterActionReport",
      targetId: aar.id,
      data: { exerciseId: id, format, status: aar.status },
      req,
    });

    if (format === "bundle") {
      const { zip } = await buildEvidenceBundle(aar.id, { pdf: renderAarPdf, docx: renderAarDocx });
      return fileResponse(zip, { filename: `${base}-evidence.zip`, contentType: "application/zip", trustedContentType: true });
    }

    const doc = await buildSignedDocument(aar.id);
    const env = full?.status === "final" ? parseStoredEnvelope(full.canonical) : null;
    const meta: AarRenderMeta = await renderMetaFor(full?.status === "final" ? env : null);
    if (format === "docx") {
      const bytes = await renderAarDocx(doc, meta);
      return fileResponse(bytes, {
        filename: `${base}.docx`,
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        trustedContentType: true,
      });
    }
    const bytes = full?.status === "final" ? (await ensureFinalPdf(aar.id)).bytes : await renderAarPdf(doc, meta);
    return fileResponse(bytes, { filename: `${base}.pdf`, contentType: "application/pdf", trustedContentType: true });
  });
}
