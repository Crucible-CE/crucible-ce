import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/exercise/auth/session";
import { hasPermission } from "@/lib/exercise/auth/rbac";
import { db } from "@/lib/db";
import { Studio } from "@/components/studio/studio";

export const dynamic = "force-dynamic";

export default async function StudioPage({ params }: { params: Promise<{ templateId: string }> }) {
  const user = await getSessionUser();
  if (!user || !hasPermission(user, "templates.manage")) redirect("/templates");
  const { templateId } = await params;
  const t = await db.exerciseTemplate.findUnique({ where: { id: templateId }, select: { id: true, mode: true } });
  if (!t) notFound();
  if (t.mode !== "strategic" && t.mode !== "document") redirect(`/templates/${t.id}`);
  return <Studio id={t.id} canLaunch={hasPermission(user, "exercises.create")} />;
}
