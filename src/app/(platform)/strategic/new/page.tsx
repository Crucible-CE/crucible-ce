import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/exercise/auth/session";
import { hasPermission } from "@/lib/exercise/auth/rbac";
import { PageHeader } from "@/components/shell/page-header";
import { StrategicWizard } from "./wizard";

export const dynamic = "force-dynamic";

export default async function NewStrategicPage({ searchParams }: { searchParams: Promise<{ templateId?: string | string[] }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!hasPermission(user, "exercises.create")) redirect("/exercises");
  const raw = (await searchParams).templateId;
  const templateId = typeof raw === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(raw) ? raw : null;

  return (
    <>
      <PageHeader title="New Strategic TTX" description="Several teams respond to the same incident from their own seat." />
      <StrategicWizard initialTemplateId={templateId} canBuild={hasPermission(user, "templates.manage")} />
    </>
  );
}
