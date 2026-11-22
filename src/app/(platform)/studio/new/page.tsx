import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/exercise/auth/session";
import { hasPermission } from "@/lib/exercise/auth/rbac";
import { PageHeader } from "@/components/shell/page-header";
import { NewStudioTemplate } from "@/components/studio/new-template";
import { STUDIO_MODE_LABELS, isStudioMode } from "@/lib/exercise/studio/schema";

export const dynamic = "force-dynamic";

export default async function NewStudioTemplatePage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const user = await getSessionUser();
  if (!user || !hasPermission(user, "templates.manage")) redirect("/templates");
  const { mode } = await searchParams;
  if (!mode || !isStudioMode(mode)) redirect("/templates/new");
  return (
    <>
      <PageHeader title={`New ${STUDIO_MODE_LABELS[mode]} template`} description="The Studio opens after you create it." />
      <NewStudioTemplate mode={mode} />
    </>
  );
}
