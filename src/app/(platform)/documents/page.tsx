import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/exercise/auth/session";
import { hasPermission } from "@/lib/exercise/auth/rbac";
import { PageHeader } from "@/components/shell/page-header";
import { DocumentsClient } from "@/components/documents/documents-client";

export const dynamic = "force-dynamic";

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { tab } = await searchParams;
  return (
    <>
      <PageHeader title="Documents" description="Playbooks, plans and SOPs that Playbook Exercises are built from." />
      <DocumentsClient canManage={hasPermission(user, "documents.manage")} initialScope={tab === "library" || tab === "local" ? tab : ""} />
    </>
  );
}
