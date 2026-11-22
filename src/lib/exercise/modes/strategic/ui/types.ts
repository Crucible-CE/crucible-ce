// Client view of the Strategic TTX projection (../index.ts project()). Dates
// arrive as ISO strings. Control-only fields are optional.

import type { AnswerRating } from "../schema";

export type { ModeViewProps } from "@/lib/exercise/modes/ui";

export interface StArtifact {
  id: string;
  kind: "email" | "social_post" | "news" | "ransom_note" | "regulator_letter" | "chat" | "voicemail" | "document" | "log_excerpt";
  title: string;
  content: string;
  from?: string;
  sentAt?: string;
}

export interface StQuestion {
  key: string;
  text: string;
  framework?: string;
}

export interface StVariant {
  team: string;
  teamId: string | null;
  status: "active" | "standby";
  narrativeMd: string;
  questions: StQuestion[];
}

export interface StGrade {
  id: string;
  responseId: string;
  source: "human";
  attempt: number;
  score: number | null;
  rating: AnswerRating | string | null;
  rationale: string | null;
  createdAt: string;
}

export interface StControlAnswer {
  responseId: string;
  teamId: string | null;
  team: string | null;
  text: string;
  byQuestion: Record<string, string> | null;
  by: string | null;
  updatedAt: string;
  grades: StGrade[];
  effective: { source: string; score: number | null; rating: string | null; rationale: string | null } | null;
}

export interface StInject {
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
  phase: "opening" | "main" | "resolution";
  contingency: boolean;
  narrativeMd: string;
  artifacts: StArtifact[];
  myVariant: StVariant | null;
  variants?: StVariant[];
  myAnswer: { text: string; byQuestion: Record<string, string> | null; updatedAt: string; by: string | null } | null;
  canAnswer: boolean;
  progress: { answered: number; required: number };
  control?: {
    expectedActions: Record<string, string[]>;
    gradingNotes: string | null;
    mitreTags: string[];
    capabilityKeys: string[];
    activeTeamIds: string[];
    answers: StControlAnswer[];
    waitingOn: string[];
  };
}

export interface StState {
  exercise: {
    id: string;
    mode: string;
    title: string;
    status: "draft" | "lobby" | "live" | "paused" | "ended" | "abandoned";
    stateVersion: number;
    advancePolicy: string;
    scenarioStartAt: string | null;
    endReason: string | null;
  };
  now: string;
  teams: Array<{ id: string; name: string }>;
  me: { participantId: string; displayName: string; teamId: string | null; roles: string[]; isDecisionMaker: boolean; isGuest: boolean } | null;
  viewer: { isControl: boolean; isDriver: boolean };
  config: {
    source: string;
    winCondition: string;
    injectMinutes: number | null;
    scenarioTitle: string;
    domain: string;
    crisisType: string | null;
  };
  injects: StInject[];
  current: string | null;
  submitters: string[];
  injectTotal: number | null;
}

/** Detailed grade from GET /api/strategic/{id}/grades (control). */
export interface StGradeDetail {
  id: string;
  responseId: string;
  injectId: string;
  teamId: string | null;
  source: "human";
  attempt: number;
  score: number | null;
  rating: string | null;
  rationale: string | null;
  createdAt: string;
}

export function asState(raw: unknown): StState | null {
  const s = raw as Partial<StState> | null;
  if (!s || !s.exercise || !Array.isArray(s.injects) || !s.config) return null;
  return { submitters: [], injectTotal: null, ...s } as StState;
}
