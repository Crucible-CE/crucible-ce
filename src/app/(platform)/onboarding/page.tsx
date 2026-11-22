import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { loadOnboardingView } from "@/lib/onboarding/load";
import { OnboardingTracks } from "@/components/onboarding/onboarding-tracks";

// "Onboarding": the full onboarding checklist. Organization setup (admins) and
// Your setup (everyone), derived from real data on every render.
export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const session = await auth();
  const u = session?.user;
  if (!u?.id || !u.organizationId) redirect("/login");
  const { tab } = await searchParams;
  const view = await loadOnboardingView({ id: u.id, organizationId: u.organizationId, role: u.role ?? null });
  const initialTab = tab === "you" ? "you" : tab === "org" ? "org" : view.isAdmin ? "org" : "you";

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="headline">Onboarding</h1>
        <p className="max-w-2xl text-[13px] leading-relaxed text-[color:var(--color-muted-foreground)]">
          Setup steps. Each one checks off when it is done.
        </p>
      </div>
      <OnboardingTracks org={view.org} user={view.user} initialTab={initialTab} cardHidden={view.cardHidden} />
    </div>
  );
}
