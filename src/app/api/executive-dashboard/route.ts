// GET /api/executive-dashboard[?format=pdf]   contributors, exercise directors and administrators
import { NextResponse } from "next/server";
import { audit } from "@/lib/exercise/audit";
import { ceRoleFor } from "@/lib/exercise/auth/rbac";
import { requirePermission } from "@/lib/exercise/auth/session";
import { fileResponse } from "@/lib/http/file-response";
import { withErrors } from "@/lib/exercise/errors";
import { buildExecutiveDashboard } from "@/lib/exercise/program/executive";
import { renderExecutivePdf } from "@/lib/exercise/program/executive-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const a = await requirePermission("reports.view");
  if (!a.ok) return a.response;
  return withErrors(async () => {
    const data = await buildExecutiveDashboard({ id: a.user.id, organizationId: a.user.organizationId, role: ceRoleFor(a.user.role) });
    if (new URL(req.url).searchParams.get("format") === "pdf") {
      audit({ actorUserId: a.user.id, action: "report.executive_exported", targetType: "ExecutiveDashboard", data: { window: data.window }, req });
      const bytes = await renderExecutivePdf(data);
      return fileResponse(bytes, {
        filename: `executive-dashboard-${data.generatedAt.slice(0, 10)}.pdf`,
        contentType: "application/pdf",
        trustedContentType: true,
      });
    }
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  });
}
