// GET /api/reports/program?from=YYYY-MM-DD&to=YYYY-MM-DD[&format=pdf]   facilitators and admins
import { NextResponse } from "next/server";
import { audit } from "@/lib/exercise/audit";
import { requirePermission } from "@/lib/exercise/auth/session";
import { fileResponse } from "@/lib/http/file-response";
import { withErrors } from "@/lib/exercise/errors";
import { buildProgramReport, reportWindow } from "@/lib/exercise/program/report";
import { renderProgramReportPdf } from "@/lib/exercise/program/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const a = await requirePermission("reports.view");
  if (!a.ok) return a.response;
  return withErrors(async () => {
    const params = new URL(req.url).searchParams;
    const report = await buildProgramReport(reportWindow(params));
    if (params.get("format") === "pdf") {
      audit({ actorUserId: a.user.id, action: "report.exported", targetType: "ProgramReport", data: { window: report.window }, req });
      const bytes = await renderProgramReportPdf(report);
      return fileResponse(bytes, {
        filename: `program-report-${report.window.from.slice(0, 10)}-to-${report.window.to.slice(0, 10)}.pdf`,
        contentType: "application/pdf",
        trustedContentType: true,
      });
    }
    return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
  });
}
