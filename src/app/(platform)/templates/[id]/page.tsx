import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/exercise/auth/session";
import { hasPermission } from "@/lib/exercise/auth/rbac";
import { db } from "@/lib/db";
import { TemplateEditor } from "@/components/templates/editor/template-editor";
import { templateHref } from "@/components/templates/labels";

export const dynamic = "force-dynamic";

export default async function TemplateEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || !hasPermission(user, "templates.manage")) redirect("/templates");
  const { id } = await params;

  const t = await db.exerciseTemplate.findUnique({ where: { id }, select: { id: true, mode: true, branching: true, status: true } });
  if (!t) notFound();

  // Strategic TTX and branched Document TTX templates need the graph, which
  // only the Studio shows. Same rule as the templates list (templateHref).
  if (t.mode !== "crisissim") redirect(templateHref(t));

  return <TemplateEditor id={t.id} />;
}
