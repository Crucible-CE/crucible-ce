// Loads both onboarding tracks for the signed-in member (Organization setup
// only for administrators) plus the persisted bits (welcome modal, hidden
// card, skipped optional steps). Shares setup facts with the Ops Room
// readiness panel when the caller already loaded them.

import { hasPermission } from "@/lib/auth/rbac";
import { loadOrgSetupFacts, loadUserSetupFacts, type OrgSetupFacts, type UserSetupFacts } from "@/lib/ops-room/setup-facts";
import { CARD_HIDDEN_KEY, WELCOME_DISMISSED_KEY, loadStates, skippedSteps } from "./state";
import { deriveOrgTrack, deriveUserTrack, type TrackView } from "./steps";
import { loadPracticeFacts } from "./practice-facts";

export interface OnboardingView {
  isAdmin: boolean;
  org: TrackView | null;
  user: TrackView;
  welcomeDismissed: boolean;
  cardHidden: boolean;
}

export interface SessionUser {
  id: string;
  organizationId: string;
  role?: string | null;
}

export async function loadSetupFacts(user: SessionUser, now: Date = new Date()): Promise<{ org: OrgSetupFacts | null; user: UserSetupFacts }> {
  const isAdmin = hasPermission({ id: user.id, role: user.role ?? undefined }, "admin.access");
  const [org, me, practice] = await Promise.all([
    isAdmin ? loadOrgSetupFacts(user.organizationId, user.id, now) : Promise.resolve(null),
    loadUserSetupFacts(user.id),
    loadPracticeFacts(user),
  ]);
  return { org, user: { ...me, practice } };
}

export async function loadOnboardingView(
  user: SessionUser,
  facts?: { org: OrgSetupFacts | null; user: UserSetupFacts },
  now: Date = new Date(),
): Promise<OnboardingView> {
  const [f, userStates, orgStates] = await Promise.all([
    facts ? Promise.resolve(facts) : loadSetupFacts(user, now),
    loadStates("user", user.id),
    loadStates("org", user.organizationId),
  ]);
  return {
    isAdmin: f.org !== null,
    org: f.org ? deriveOrgTrack(f.org, skippedSteps(orgStates), now) : null,
    user: deriveUserTrack(f.user, skippedSteps(userStates)),
    welcomeDismissed: userStates.has(WELCOME_DISMISSED_KEY),
    cardHidden: userStates.has(CARD_HIDDEN_KEY),
  };
}
