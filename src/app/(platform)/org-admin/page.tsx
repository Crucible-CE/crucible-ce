import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { OrgOverview } from "@/components/admin/org-overview";

// Org admin home. Gated by admin.access (org administrators + platform admins).
export default async function OrgAdminHome() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!hasPermission(session.user, "admin.access")) redirect("/dashboard");

  const org = session.user.organizationId
    ? await db.organization.findUnique({ where: { id: session.user.organizationId }, select: { name: true } })
    : null;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="headline">Org admin</h1>
        <p className="max-w-2xl text-[13px] leading-relaxed text-[color:var(--color-muted-foreground)]">
          {org?.name ?? "Members, notifications, escalation and audit."}
        </p>
      </div>

      <OrgOverview />
    </div>
  );
}
