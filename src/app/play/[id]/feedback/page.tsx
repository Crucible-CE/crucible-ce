import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { resolvePrincipal } from "@/lib/exercise/auth/guest";
import { NotFoundError } from "@/lib/exercise/runtime/snapshot";
import { AccessError } from "@/lib/exercise/runtime/view";
import { requireAccess, toRuntimePrincipal } from "@/lib/exercise/access";
import { FeedbackForm } from "@/components/hotwash/feedback-form";

export default async function FeedbackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const principal = await resolvePrincipal({ headers: await headers() });
  if (!principal) redirect("/join");
  try {
    await requireAccess(id, toRuntimePrincipal(principal), "participant");
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    if (e instanceof AccessError) {
      return (
        <div className="mx-auto max-w-md py-20 text-center">
          <h1 className="text-lg font-semibold">Feedback is for people who took part.</h1>
          <p className="mt-2 text-[13px] text-[color:var(--color-muted-foreground)]">Ask the facilitator to add you to the exercise.</p>
          <Link href={`/play/${id}`} className="mt-4 inline-block text-sm font-medium text-[color:var(--mist-indigo)] underline-offset-4 hover:underline">
            Back to the exercise
          </Link>
        </div>
      );
    }
    throw e;
  }
  return <FeedbackForm exerciseId={id} />;
}
