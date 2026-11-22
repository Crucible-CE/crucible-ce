// GET /api/play/{id}/exports/situation-manual: the Situation Manual PDF for
// anyone in the exercise, guests included. Guests reach only /api/play/*, so
// the player view links here. Same builder as /api/exercises/{id}/exports.
import { audit } from "@/lib/exercise/audit";
import { db } from "@/lib/db";
import { requestPrincipal, requireAccess } from "@/lib/exercise/access";
import { withErrors } from "@/lib/exercise/errors";
import { buildSituationManual } from "@/lib/exercise/exports/data";
import { renderSituationManual } from "@/lib/exercise/exports/pdf";
import { fileResponse } from "@/lib/http/file-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function slug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "exercise";
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withErrors(async () => {
    const { id } = await params;
    const principal = await requestPrincipal(req, { allowGuest: true });
    const { viewer } = await requireAccess(id, principal, "any");
    const ex = await db.exercise.findUnique({ where: { id }, select: { title: true } });
    const pdf = await renderSituationManual(await buildSituationManual(id, { control: viewer.isControl }));
    audit({
      actorUserId: principal.kind === "user" ? principal.userId : null,
      actorParticipantId: principal.kind === "guest" ? principal.participantId : null,
      action: "exercise.exported",
      targetType: "Exercise",
      targetId: id,
      data: { kind: "situation-manual" },
      req,
    });
    return fileResponse(pdf, {
      filename: `${slug(ex?.title ?? "exercise")}-situation-manual.pdf`,
      contentType: "application/pdf",
      trustedContentType: true,
    });
  });
}
