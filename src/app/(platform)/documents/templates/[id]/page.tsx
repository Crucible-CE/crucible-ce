import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/exercise/auth/session";
import { hasPermission } from "@/lib/exercise/auth/rbac";
import { canReadTemplateSecrets } from "@/lib/exercise/access";
import { DocumentTemplateEditor } from "@/components/documents/document-template-editor";

export const dynamic = "force-dynamic";

export default async function DocumentTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!hasPermission(user, "templates.manage")) redirect("/documents");
  const { id } = await params;
  const t = await db.exerciseTemplate.findUnique({ where: { id }, select: { id: true, mode: true } });
  if (!t) notFound();
  if (t.mode !== "document") redirect(`/templates/${id}`);
  // A player in a run of this template must not read ahead.
  if (!(await canReadTemplateSecrets(user.id, id))) notFound();
  return <DocumentTemplateEditor id={id} canLaunch={hasPermission(user, "exercises.create")} />;
}
