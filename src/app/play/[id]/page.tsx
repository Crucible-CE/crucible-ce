import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { resolvePrincipal } from "@/lib/exercise/auth/guest";
import { getExerciseSettings } from "@/lib/exercise/settings";
import { NotFoundError } from "@/lib/exercise/runtime/snapshot";
import { AccessError } from "@/lib/exercise/runtime/view";
import { requireAccess, toRuntimePrincipal } from "@/lib/exercise/access";
import { PlayRoom } from "@/components/exercise/exercise-room";

export default async function PlayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const principal = await resolvePrincipal({ headers: await headers() });
  if (!principal) redirect("/join");
  try {
    await requireAccess(id, toRuntimePrincipal(principal), "any");
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    if (e instanceof AccessError) {
      return (
        <div className="mx-auto max-w-md py-20 text-center">
          <h1 className="text-lg font-semibold">You do not have access to this exercise.</h1>
          <p className="mt-2 text-[13px] text-[color:var(--color-muted-foreground)]">Join with the code from the facilitator.</p>
          <Link href="/join" className="mt-4 inline-block text-sm font-medium text-[color:var(--mist-indigo)] underline-offset-4 hover:underline">
            Enter a code
          </Link>
        </div>
      );
    }
    throw e;
  }
  const instance = await getExerciseSettings();
  return <PlayRoom exerciseId={id} timezone={instance?.timezone ?? "UTC"} isGuest={principal.kind === "guest"} />;
}
