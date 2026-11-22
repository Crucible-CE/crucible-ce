import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/exercise/auth/session";
import { hasPermission } from "@/lib/exercise/auth/rbac";
import { listModes } from "@/lib/exercise/modes/registry";
import { PageHeader } from "@/components/shell/page-header";
import { NewExercise } from "./new-exercise";

export const dynamic = "force-dynamic";

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export default async function NewExercisePage({ searchParams }: { searchParams: Promise<{ mode?: string | string[]; templateId?: string | string[] }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!hasPermission(user, "exercises.create")) redirect("/exercises");
  const available = listModes().map((m) => ({ key: m.key, label: m.label }));
  const sp = await searchParams;
  const mode = typeof sp.mode === "string" && available.some((m) => m.key === sp.mode) ? sp.mode : null;
  const templateId = typeof sp.templateId === "string" && ID_RE.test(sp.templateId) ? sp.templateId : null;
  return (
    <>
      <PageHeader title="New exercise" />
      <NewExercise availableModes={available} initialMode={mode} initialTemplateId={templateId} />
    </>
  );
}
