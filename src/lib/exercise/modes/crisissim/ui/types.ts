// Client-side types for the Crisis Sim projection (see project() in ../index.ts)
// and the view props from the mode UI contract (src/modes/ui.tsx). Dates arrive
// as ISO strings.

import type { Artifact, DeliverableKind, PathKey, Quality, QuestionType } from "../schema";

export type ResponseKind = "vote" | "answer" | "entry" | "deliverable";
export type ActResult = { ok: boolean; error?: string };

export interface ModeViewProps {
  exerciseId: string;
  state: unknown;
  isGuest: boolean;
  respond(injectId: string, kind: ResponseKind, data: unknown): Promise<ActResult>;
  act(action: string, body?: Record<string, unknown>): Promise<ActResult>;
  refresh(): void;
}

export interface CsQuestion {
  team: string;
  teamId: string | null;
  stem: string;
  options: Array<{ id: string; text: string }>;
  decisionOwner: string | null;
  discussionPrompt: string | null;
  type: QuestionType;
  /** Player view: the viewer is the team's decision maker. */
  iDecide?: boolean;
}

export type DecisionSource = "owner" | "majority" | "tie" | "none";
export interface CsTeamDecision {
  optionId: string | null;
  source: DecisionSource;
}

export interface CsVoteRow {
  participantId: string;
  teamId: string | null;
  optionId: string | null;
  comment: string | null;
  abstain: boolean;
  decider?: boolean;
  quality: Quality | null;
}

export interface CsInject {
  id: string;
  seq: number;
  status: "pending" | "held" | "open" | "closed";
  title: string;
  scenarioTime: string | null;
  targetTeamIds: string[];
  openedAt: string | null;
  closesAt: string | null;
  closedAt: string | null;
  /** False when the update does not target the viewer's team; its content is withheld. */
  forMyTeam?: boolean;
  playedOnPath: PathKey | null;
  narrativeMd: string;
  consequenceText: string | null;
  /** Resolved follow-up lines from the previous decisions (players: own team only). */
  outcomes: Array<{ team: string; text: string }>;
  artifacts: Artifact[];
  question: CsQuestion | null;
  questions?: CsQuestion[];
  deliverable: { team: string; teamId: string | null; kind: DeliverableKind; prompt: string } | null;
  myDeliverable: { text: string; submittedAt: string } | null;
  myVote: { optionId: string | null; comment: string | null; decider?: boolean } | null;
  progress: { voted: number; required: number };
  reveal?: {
    distribution?: Record<string, Record<string, number>>;
    best?: Record<string, string | null>;
    decisions?: Record<string, CsTeamDecision>;
  };
  control?: {
    quality: Record<string, Record<string, Record<PathKey, Quality>>>;
    clockEffects: Record<string, Record<string, Array<{ key: string; action: "trigger" | "met" }>>>;
    clockTriggers?: string[];
    rationales?: Record<string, Record<string, string>>;
    deliverableCriteria: string[];
    required: string[];
    votes: CsVoteRow[];
    decisions?: Record<string, CsTeamDecision>;
    waitingOn: string[];
    deliverables: Array<{
      responseId: string;
      teamId: string | null;
      text: string;
      submittedAt: string;
      grade: { source: string; score: number | null; rating: string | null; rationale: string | null } | null;
    }>;
    summary: { scoreBefore: number | null; scoreAfter: number | null; delta: number | null; teamAverages?: Record<string, number> } | null;
  };
}

export interface CsClock {
  key: string;
  label: string;
  status: "pending" | "running" | "met" | "missed";
  triggeredAt: string | null;
  deadlineAt: string | null;
  metAt: string | null;
  /** Debrief only. */
  outcome?: "met" | "missed" | "open" | "not_started";
}

export interface CsDebriefDecision {
  injectId: string;
  seq: number;
  title: string;
  scenarioTime: string | null;
  team: string;
  questionType: string;
  stem: string;
  decisionOwner: string | null;
  source: DecisionSource;
  decision: { optionId: string; text: string; rationale: string | null } | null;
  split: Array<{ optionId: string; text: string; votes: number }>;
  noVotes: number;
  best: { optionId: string; text: string; rationale: string | null } | null;
  clockChanges: Array<{ key: string; label: string; action: "trigger" | "met" }>;
  quality?: Quality | null;
}

export interface CsDebrief {
  initialPath: PathKey;
  finalPath: PathKey;
  arc: Array<{ injectId: string; seq: number; title: string; pathAtClose: PathKey; newPath: PathKey; scoreAfter?: number | null; delta?: number | null }>;
  keyDecisions: CsDebriefDecision[];
  moves: Array<{ injectId: string; seq: number; title: string; from: PathKey; to: PathKey; decisions: CsDebriefDecision[] }>;
  clocks: CsClock[];
  lastScenarioTime?: string | null;
  deliverables: Array<{
    injectId: string;
    seq: number;
    title: string;
    team: string;
    kind: DeliverableKind;
    prompt: string;
    text: string;
    grade?: { source: string; score: number | null; rating: string | null; rationale: string | null } | null;
    criteria?: string[];
  }>;
  noVoteCount: number;
  voteCount: number;
  thresholds?: { optimal: number; degrading: number };
  finalScore?: number;
  individual?: Array<{ participantId: string; displayName: string; teamId: string | null; votes: number; abstains: number; great: number; good: number; neutral: number; bad: number }>;
}

export interface CsState {
  exercise: {
    id: string;
    title: string;
    status: "draft" | "lobby" | "live" | "paused" | "ended" | "abandoned";
    scenarioStartAt: string | null;
    startedAt: string | null;
    isPractice: boolean;
  };
  now: string;
  /** IANA zone every timestamp is shown in. */
  timezone?: string;
  teams: Array<{ id: string; name: string }>;
  me: { participantId: string; displayName: string; teamId: string | null; roles: string[]; isGuest: boolean; isDecisionMaker?: boolean } | null;
  viewer: { isControl: boolean; isDriver: boolean };
  roster: Array<{ id: string; displayName: string; title: string | null; teamId: string | null; roles: string[]; online: boolean; isDecisionMaker?: boolean }>;
  path: { key: PathKey; label: string };
  score?: { cumulative: number; teamScores: Record<string, { cumulative?: number; last?: number }>; thresholds: { optimal: number; degrading: number } };
  config: { holdAfterClose: boolean; revealSplit: boolean; revealBest: boolean; targetDurationMin: number; individualMetrics?: boolean };
  clocks: CsClock[];
  injects: CsInject[];
  current: string | null;
  debrief: CsDebrief | null;
}

export function asState(state: unknown): CsState | null {
  const s = state as Partial<CsState> | null;
  if (!s || !s.exercise || !Array.isArray(s.injects) || !s.path) return null;
  return {
    clocks: [],
    debrief: null,
    timezone: "UTC",
    ...s,
  } as CsState;
}
