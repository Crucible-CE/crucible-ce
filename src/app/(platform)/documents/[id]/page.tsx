import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/exercise/auth/session";
import { hasPermission } from "@/lib/exercise/auth/rbac";
import { DocumentView } from "@/components/documents/document-view";

export const dynamic = "force-dynamic";

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const exists = await db.sourceDocument.findUnique({ where: { id }, select: { id: true } });
  if (!exists) notFound();
  return <DocumentView id={id} canManage={hasPermission(user, "documents.manage")} canBuild={hasPermission(user, "templates.manage")} />;
}
