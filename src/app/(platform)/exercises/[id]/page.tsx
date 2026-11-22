import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/exercise/auth/session";
import { getExerciseSettings } from "@/lib/exercise/settings";
import { NotFoundError } from "@/lib/exercise/runtime/snapshot";
import { AccessError } from "@/lib/exercise/runtime/view";
import { requireAccess } from "@/lib/exercise/access";
import { EmptyState } from "@/components/ui/empty-state";
import { ExerciseRoom } from "@/components/exercise/exercise-room";

export const dynamic = "force-dynamic";

export default async function ExercisePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { id } = await params;
  try {
    await requireAccess(id, { kind: "user", userId: user.id, accountRole: user.role }, "any");
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    if (e instanceof AccessError) {
      return (
        <EmptyState
          title="You do not have access to this exercise."
          description="Ask a facilitator to add you."
          action={
            <Link href="/exercises" className="text-sm font-medium text-[color:var(--mist-indigo)] underline-offset-4 hover:underline">
              Back to exercises
            </Link>
          }
        />
      );
    }
    throw e;
  }
  const instance = await getExerciseSettings();
  return <ExerciseRoom exerciseId={id} timezone={instance?.timezone ?? "UTC"} />;
}
