import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/exercise/auth/session";
import { hasPermission } from "@/lib/exercise/auth/rbac";
import { PageHeader } from "@/components/shell/page-header";
import { BuildForm } from "@/components/documents/build-form";
import { readSections } from "@/lib/exercise/documents/documents";

export const dynamic = "force-dynamic";

export default async function BuildExercisePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { id } = await params;
  if (!hasPermission(user, "templates.manage")) redirect(`/documents/${id}`);
  const doc = await db.sourceDocument.findUnique({ where: { id }, select: { id: true, title: true, sections: true } });
  if (!doc) notFound();
  return (
    <>
      <PageHeader title="Build exercise" description={`From ${doc.title}.`} />
      <BuildForm documentId={doc.id} documentTitle={doc.title} sectionCount={readSections(doc.sections).length} />
    </>
  );
}
