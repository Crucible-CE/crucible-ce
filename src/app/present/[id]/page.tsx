// Presenter view for a projector: /present/{exerciseId}. Control room only.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/exercise/auth/session";
import { NotFoundError } from "@/lib/exercise/runtime/snapshot";
import { AccessError } from "@/lib/exercise/runtime/view";
import { requireAccess } from "@/lib/exercise/access";
import { Presenter } from "@/components/documents/presenter";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Presenter", robots: { index: false, follow: false, nocache: true } };

export default async function PresentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const ex = await db.exercise.findUnique({ where: { id }, select: { mode: true } });
  if (!ex) notFound();
  try {
    await requireAccess(id, { kind: "user", userId: user.id, accountRole: user.role }, "control");
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    if (e instanceof AccessError) {
      return (
        <main className="flex min-h-screen flex-col items-center justify-center gap-3 text-center">
          <p className="text-lg font-semibold">Only the control team can open the presenter view.</p>
          <Link href={`/exercises/${id}`} className="text-sm text-[color:var(--mist-indigo)] hover:underline">
            Back to the exercise
          </Link>
        </main>
      );
    }
    throw e;
  }
  if (ex.mode !== "document") redirect(`/exercises/${id}`);
  return <Presenter exerciseId={id} />;
}
