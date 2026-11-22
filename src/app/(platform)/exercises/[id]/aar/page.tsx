import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/exercise/auth/session";
import { NotFoundError } from "@/lib/exercise/runtime/snapshot";
import { AccessError } from "@/lib/exercise/runtime/view";
import { requireAccess } from "@/lib/exercise/access";
import { readableAarVersion } from "@/lib/exercise/aar/register";
import { getAarView } from "@/lib/exercise/aar/service";
import { orderSigners } from "@/lib/exercise/aar/document";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialogProvider } from "@/components/ui/confirm-dialog";
import { AarWorkspace } from "@/components/aar/editor/aar-workspace";
import { AarReadOnly } from "@/components/aar/editor/aar-read-only";

export const dynamic = "force-dynamic";

export default async function AarPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ version?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { id } = await params;
  try {
    await requireAccess(id, { kind: "user", userId: user.id, accountRole: user.role }, "control");
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    if (!(e instanceof AccessError)) throw e;
    // Outside the control team: the report read only, when this user may read one.
    const raw = (await searchParams).version;
    const version = await readableAarVersion(user, id, raw && /^\d{1,4}$/.test(raw) ? Number(raw) : null);
    const view = version !== null ? await getAarView(id, version) : null;
    if (view?.aar) {
      const signers = await db.aarSignature.findMany({ where: { aarId: view.aar.id }, select: { role: true, name: true } });
      const { version: v, status, sections, origins, finalizedAt } = view.aar;
      return <AarReadOnly exercise={view.exercise} aar={{ version: v, status, sections, origins, finalizedAt }} signers={orderSigners(signers)} />;
    }
    return (
      <EmptyState
        title="The after-action report is for the control team."
        description="Ask the facilitator for access."
        action={
          <Link href={`/exercises/${id}`} className="text-sm font-medium text-[color:var(--mist-indigo)] underline-offset-4 hover:underline">
            Back to the exercise
          </Link>
        }
      />
    );
  }
  return (
    <ConfirmDialogProvider>
      <AarWorkspace exerciseId={id} />
    </ConfirmDialogProvider>
  );
}
