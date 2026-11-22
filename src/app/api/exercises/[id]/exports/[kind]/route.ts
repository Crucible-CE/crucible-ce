// GET /api/exercises/{id}/exports/{kind}
//   situation-manual   every participant (and the owner, admins): PDF
//   ce-handbook        control only (lead facilitator, controller, evaluator, owner, admin): PDF
//   msel-csv           control only: CSV
import { NextResponse } from "next/server";
import { audit } from "@/lib/exercise/audit";
import { db } from "@/lib/db";
import { requestPrincipal, requireAccess } from "@/lib/exercise/access";
import { withErrors } from "@/lib/exercise/errors";
import { EXPORT_KINDS, buildHandbook, buildSituationManual, type ExportKind } from "@/lib/exercise/exports/data";
import { renderHandbook, renderSituationManual } from "@/lib/exercise/exports/pdf";
import { buildMsel, mselCsv } from "@/lib/exercise/msel";
import { fileResponse } from "@/lib/http/file-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function slug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "exercise";
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string; kind: string }> }) {
  return withErrors(async () => {
    const { id, kind } = await params;
    if (!(EXPORT_KINDS as readonly string[]).includes(kind)) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const k = kind as ExportKind;
    const principal = await requestPrincipal(req, { allowGuest: true });
    const { viewer } = await requireAccess(id, principal, k === "situation-manual" ? "any" : "control");
    const ex = await db.exercise.findUnique({ where: { id }, select: { title: true } });
    const name = slug(ex?.title ?? "exercise");

    let res: Response;
    if (k === "situation-manual") {
      const pdf = await renderSituationManual(await buildSituationManual(id, { control: viewer.isControl }));
      res = fileResponse(pdf, { filename: `${name}-situation-manual.pdf`, contentType: "application/pdf", trustedContentType: true });
    } else if (k === "ce-handbook") {
      const pdf = await renderHandbook(await buildHandbook(id));
      res = fileResponse(pdf, { filename: `${name}-controller-evaluator-handbook.pdf`, contentType: "application/pdf", trustedContentType: true });
    } else {
      const msel = await buildMsel(id);
      res = fileResponse(mselCsv(msel.rows, msel.timezone), { filename: `${name}-msel.csv`, contentType: "text/csv; charset=utf-8", trustedContentType: true });
    }
    audit({
      actorUserId: principal.kind === "user" ? principal.userId : null,
      actorParticipantId: principal.kind === "guest" ? principal.participantId : null,
      action: "exercise.exported",
      targetType: "Exercise",
      targetId: id,
      data: { kind: k },
      req,
    });
    return res;
  });
}
