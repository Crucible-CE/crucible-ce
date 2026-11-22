import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { hasPermission } from "@/lib/auth/rbac";
import { OrgAdminNav } from "./org-admin-nav";

// Server-side gate for the whole org-admin panel. Individual pages' APIs
// enforce admin.access too; this keeps non-admins from ever seeing the
// panel chrome and nav.
export default async function OrgAdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!hasPermission(session.user, "admin.access")) redirect("/dashboard");

  return <OrgAdminNav>{children}</OrgAdminNav>;
}
