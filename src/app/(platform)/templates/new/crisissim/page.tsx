import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/exercise/auth/session";
import { hasPermission } from "@/lib/exercise/auth/rbac";
import { ensureExerciseLibrary } from "@/lib/exercise/library";
import { PageHeader } from "@/components/shell/page-header";
import { NewCrisisSim } from "@/components/templates/new-crisissim";

export const dynamic = "force-dynamic";

export default async function NewCrisisSimPage() {
  const user = await getSessionUser();
  if (!user || !hasPermission(user, "templates.manage")) redirect("/");
  await ensureExerciseLibrary();
  const rows = await db.exerciseTemplate.findMany({
    where: { mode: "crisissim", scope: "library", status: "published" },
    orderBy: { title: "asc" },
    select: { id: true, title: true, summary: true, config: true, _count: { select: { injects: true } } },
  });
  const library = rows.map((t) => ({
    id: t.id,
    title: t.title,
    summary: t.summary,
    injectCount: t._count.injects,
    practice: (t.config as { practice?: unknown } | null)?.practice === true,
  }));
  return (
    <>
      <PageHeader title="New Crisis Sim" description="Start blank or copy a scenario from the library." />
      <NewCrisisSim library={library} />
    </>
  );
}
