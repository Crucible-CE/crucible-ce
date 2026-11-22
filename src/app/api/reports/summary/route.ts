// GET /api/reports/summary?from=&to=   one-page executive summary PDF (facilitators and admins)
import { audit } from "@/lib/exercise/audit";
import { requirePermission } from "@/lib/exercise/auth/session";
import { fileResponse } from "@/lib/http/file-response";
import { withErrors } from "@/lib/exercise/errors";
import { buildProgramReport, reportWindow } from "@/lib/exercise/program/report";
import { renderExecSummaryPdf } from "@/lib/exercise/program/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const a = await requirePermission("reports.view");
  if (!a.ok) return a.response;
  return withErrors(async () => {
    const report = await buildProgramReport(reportWindow(new URL(req.url).searchParams));
    audit({ actorUserId: a.user.id, action: "report.summary_exported", targetType: "ProgramReport", data: { window: report.window }, req });
    const bytes = await renderExecSummaryPdf(report);
    return fileResponse(bytes, {
      filename: `exercise-summary-${report.generatedAt.slice(0, 10)}.pdf`,
      contentType: "application/pdf",
      trustedContentType: true,
    });
  });
}
