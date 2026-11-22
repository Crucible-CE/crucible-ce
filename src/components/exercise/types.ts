// Client view of the projection fields every mode shares (baseProjection in
// src/modes/shared/project-base.ts). Dates arrive as ISO strings.

export interface ExerciseInfo {
  id: string;
  mode: "crisissim" | "document" | "strategic";
  title: string;
  status: "draft" | "lobby" | "live" | "paused" | "ended" | "abandoned";
  stateVersion: number;
  advancePolicy: "facilitator" | "all_teams" | "votes_in" | "timer";
  startedAt: string | null;
  pausedAt: string | null;
  pausedMsTotal: number;
  endedAt: string | null;
  endReason: string | null;
  timeboxMin: number | null;
  scenarioStartAt: string | null;
  isPractice: boolean;
}

export interface InjectHeader {
  id: string;
  seq: number;
  status: "pending" | "held" | "open" | "closed";
  source: string;
  title: string;
  scenarioTime: string | null;
  targetTeamIds: string[];
  openedAt: string | null;
  closesAt: string | null;
  closedAt: string | null;
}

export interface RosterEntry {
  id: string;
  displayName: string;
  title: string | null;
  teamId: string | null;
  roles: string[];
  isGuest: boolean;
  isDecisionMaker: boolean;
  online: boolean;
}

export interface FeedEntry {
  id: string;
  type: string;
  at: string;
  data: Record<string, unknown>;
}

export interface ClockEntry {
  key: string;
  label: string;
  status: string;
  triggeredAt: string | null;
  deadlineAt: string | null;
  metAt: string | null;
}

export interface PlanBrief {
  executiveBriefMd: string | null;
  scope: string;
  groundRules: string;
  assumptions: string;
  stopWord: string;
  noFaultStatement: string;
}

export interface ExerciseState {
  exercise: ExerciseInfo;
  now: string;
  teams: Array<{ id: string; name: string }>;
  me: {
    participantId: string;
    displayName: string;
    teamId: string | null;
    roles: string[];
    isDecisionMaker: boolean;
    isGuest: boolean;
  } | null;
  viewer: { isControl: boolean; isDriver: boolean };
  roster: RosterEntry[];
  feed?: FeedEntry[];
  currentInject?: InjectHeader | null;
  path?: { key: string; label: string };
  injects?: Array<InjectHeader & Record<string, unknown>>;
  plan?: PlanBrief | null;
  objectives?: Array<{ id: string; seq: number; text: string }>;
  clocks?: ClockEntry[];
  /** Planned number of injects, or null when unknown. */
  injectTotal?: number | null;
  [key: string]: unknown;
}

export const ROLE_LABELS: Record<string, string> = {
  lead_facilitator: "Lead facilitator",
  controller: "Controller",
  evaluator: "Evaluator",
  scribe: "Scribe",
  player: "Player",
  observer: "Observer",
};

export const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  lobby: "Lobby open",
  live: "Live",
  paused: "Paused",
  ended: "Ended",
  abandoned: "Abandoned",
};

export const POLICY_LABELS: Record<string, string> = {
  facilitator: "Facilitator advances",
  votes_in: "When all votes are in",
  all_teams: "When every team answers",
  timer: "When time runs out",
};

export const END_REASON_LABELS: Record<string, string> = {
  facilitator: "Ended by the facilitator",
  timebox: "Time box reached",
  budget: "Inject budget reached",
  template_exhausted: "All injects delivered",
  win_condition: "Win condition met",
  abandoned: "Abandoned",
};

export const CLOSE_TRIGGER_LABELS: Record<string, string> = {
  votes_in: "All votes in",
  all_teams: "Every team answered",
  timer: "Time ran out",
  facilitator: "Facilitator",
  endex: "ENDEX",
};

export const CLOCK_STATUS_LABELS: Record<string, string> = {
  pending: "Not started",
  running: "Running",
  met: "Met",
  missed: "Missed",
};
