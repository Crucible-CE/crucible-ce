import { redirect } from "next/navigation";
import { LayoutTemplate } from "lucide-react";
import { getSessionUser } from "@/lib/exercise/auth/session";
import { hasPermission } from "@/lib/exercise/auth/rbac";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/shell/page-header";
import { TemplatesClient } from "@/components/templates/templates-client";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!hasPermission(user, "templates.manage")) {
    return (
      <>
        <PageHeader title="Templates" />
        <EmptyState icon={LayoutTemplate} title="You don't have access" description="Readers do not manage templates." />
      </>
    );
  }
  return (
    <>
      <PageHeader title="Templates" description="The scenarios exercises run from. Start from the library, build one in Studio, or import a file." />
      <TemplatesClient />
    </>
  );
}
