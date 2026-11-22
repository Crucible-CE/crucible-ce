import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/rbac";
import { loadNeedsYou } from "@/lib/ops-room/needs-you";
import { loadActiveIncidents } from "@/lib/ops-room/incidents";
import { evaluateReadiness } from "@/lib/ops-room/readiness";
import { loadOnboardingView, loadSetupFacts } from "@/lib/onboarding/load";
import { getReadyCard } from "@/lib/onboarding/steps";
import { WelcomeModal } from "@/components/onboarding/welcome-modal";
import { GetReadyCard } from "@/components/ops-room/get-ready-card";
import { NeedsYouNow } from "@/components/ops-room/needs-you-now";
import { ActiveIncidents } from "@/components/ops-room/active-incidents";
import { ReadinessPanel } from "@/components/ops-room/readiness-panel";
import { LiveRefresh } from "@/components/ops-room/live-refresh";

// ---------------------------------------------------------------------------
// Ops Room, the home page. Personal first, then the org:
//   (Onboarding card while onboarding is incomplete)
//   1. Needs you now    pages to me, my roles + SLA clocks, my due tasks, mentions
//   2. Active incidents open incidents I can see (lock rules), "View all"
//   3. Readiness        paging / setup health, collapsed when all good
// Everything is derived server-side on each render (lib/ops-room/*); the page
// re-renders when a notification arrives for the member (LiveRefresh).
// ---------------------------------------------------------------------------

export default async function DashboardPage() {
  const session = await auth();
  const u = session?.user;
  if (!u?.id || !u.organizationId) redirect("/login");
  const user = { id: u.id, organizationId: u.organizationId, role: u.role ?? null };
  const now = new Date();

  const facts = await loadSetupFacts(user, now);
  const [needs, incidents, onboarding] = await Promise.all([
    loadNeedsYou(user, now),
    loadActiveIncidents(user, now),
    loadOnboardingView(user, facts, now),
  ]);
  const readiness = evaluateReadiness({ org: facts.org, user: facts.user, isAdmin: onboarding.isAdmin, now });
  const card = getReadyCard(onboarding.org, onboarding.user, onboarding.cardHidden);
  const serverNow = now.toISOString();

  return (
    <div className="space-y-6">
      <LiveRefresh userId={user.id} />
      {!onboarding.welcomeDismissed && (
        <WelcomeModal isAdmin={onboarding.isAdmin} orgName={u.organizationName ?? facts.org?.orgName ?? null} />
      )}

      <div className="space-y-1">
        <h1 className="headline">Ops Room</h1>
        <p className="max-w-2xl text-[13px] leading-relaxed text-[color:var(--color-muted-foreground)]">
          Your pages, your tasks, open incidents.
        </p>
      </div>

      {card && <GetReadyCard card={card} />}
      <NeedsYouNow needs={needs} serverNow={serverNow} />
      <ActiveIncidents data={incidents} canDeclare={hasPermission(u, "incidents.edit")} serverNow={serverNow} />
      <ReadinessPanel view={readiness} />
    </div>
  );
}
