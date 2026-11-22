// GET /api/settings/cloud-export   administrators: download the Export for Cloud
// file (templates, source documents, user emails). Audited with counts only.
import { NextResponse } from "next/server";
import { audit } from "@/lib/exercise/audit";
import { requirePermission } from "@/lib/exercise/auth/session";
import { withErrors } from "@/lib/exercise/errors";
import { canReadTemplateSecrets } from "@/lib/exercise/access";
import { buildCloudExport } from "@/lib/exercise/cloud-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const a = await requirePermission("settings.manage");
  if (!a.ok) return a.response;
  return withErrors(async () => {
    const { file, skippedTemplates } = await buildCloudExport({ canRead: (id) => canReadTemplateSecrets(a.user.id, id) });
    audit({
      actorUserId: a.user.id,
      action: "settings.cloud_export",
      targetType: "Organization",
      targetId: a.user.organizationId,
      data: { templates: file.templates.length, documents: file.documents.length, users: file.users.length, skippedTemplates },
      req,
    });
    const day = file.exportedAt.slice(0, 10);
    return new NextResponse(`${JSON.stringify(file, null, 2)}\n`, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="crucible-export-for-cloud-${day}.json"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
