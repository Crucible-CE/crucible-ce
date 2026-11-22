import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/exercise/auth/session";
import { getExerciseSettings } from "@/lib/exercise/settings";
import { NotFoundError } from "@/lib/exercise/runtime/snapshot";
import { AccessError } from "@/lib/exercise/runtime/view";
import { requireAccess } from "@/lib/exercise/access";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialogProvider } from "@/components/ui/confirm-dialog";
import { HotwashBoard } from "@/components/hotwash/hotwash-board";

export const dynamic = "force-dynamic";

export default async function HotwashPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { id } = await params;
  try {
    await requireAccess(id, { kind: "user", userId: user.id, accountRole: user.role }, "control");
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    if (e instanceof AccessError) {
      return (
        <EmptyState
          title="The hotwash is for the control team."
          description="Ask the facilitator for access."
          action={
            <Link href={`/exercises/${id}`} className="text-sm font-medium text-[color:var(--mist-indigo)] underline-offset-4 hover:underline">
              Back to the exercise
            </Link>
          }
        />
      );
    }
    throw e;
  }
  const instance = await getExerciseSettings();
  return (
    <ConfirmDialogProvider>
      <HotwashBoard exerciseId={id} timezone={instance?.timezone ?? "UTC"} />
    </ConfirmDialogProvider>
  );
}
