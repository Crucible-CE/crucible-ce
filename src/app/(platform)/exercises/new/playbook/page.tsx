import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/exercise/auth/session";
import { hasPermission } from "@/lib/exercise/auth/rbac";
import { findMode } from "@/lib/exercise/modes/registry";
import { PageHeader } from "@/components/shell/page-header";
import { PlaybookFlow } from "@/components/documents/playbook-flow";

export const dynamic = "force-dynamic";

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export default async function NewPlaybookExercisePage({ searchParams }: { searchParams: Promise<{ template?: string | string[] }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!hasPermission(user, "exercises.create")) redirect("/exercises");
  if (!findMode("document")) redirect("/exercises/new");
  const sp = await searchParams;
  const templateId = typeof sp.template === "string" && ID_RE.test(sp.template) ? sp.template : null;
  const canAuthor = hasPermission(user, "templates.manage");
  return (
    <>
      <PageHeader title="Playbook Exercise" description="Write discussion modules from a playbook or plan." />
      <PlaybookFlow canAuthor={canAuthor} canUpload={hasPermission(user, "documents.manage")} initialTemplateId={canAuthor ? templateId : null} />
    </>
  );
}
