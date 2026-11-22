// Client view of the Document TTX projection (../project.ts). Dates arrive as
// ISO strings. Control-only fields are optional.

import type { EntryType, GradeRating } from "../schema";

export interface DocGrade {
  id: string;
  source: "human";
  attempt: number;
  score: number | null;
  rating: GradeRating | null;
  rationale: string | null;
  at: string;
}

export interface DocEntry {
  id: string;
  type: EntryType;
  text: string;
  questionKey: string | null;
  severity: "low" | "medium" | "high" | null;
  docSectionRef: string | null;
  speakerRole: string | null;
  status: "submitted" | "confirmed" | "denied" | string;
  by: string;
  mine: boolean;
  createdAt: string;
  graded?: boolean;
  grade?: DocGrade | null;
}

export interface DocQuestion {
  key: string;
  text: string;
  category: string;
  docSectionRefs: string[];
  answered: boolean;
}

export interface DocModule {
  id: string;
  seq: number;
  status: "pending" | "held" | "open" | "closed";
  title: string;
  scenarioTime: string | null;
  openedAt: string | null;
  closesAt: string | null;
  closedAt: string | null;
  scenarioUpdate: string;
  keyIssues: string[];
  docSectionRefs: string[];
  questions: DocQuestion[];
  entries: DocEntry[];
  control?: {
    rationale: string | null;
    sourceExcerpt: string | null;
    expectedActions: string[];
    unanswered: string[];
    capabilityKeys: Record<string, string[]>;
    objectiveKeys: Record<string, string[]>;
  };
}

export interface DocDebriefModule {
  injectId: string;
  seq: number;
  title: string;
  byType: Record<EntryType, number>;
  answered: string[];
  unanswered: string[];
  gaps: Array<{ id: string; text: string; severity: string | null; docSectionRef: string | null }>;
  questions?: Array<{
    key: string;
    text: string;
    entries: number;
    graded: number;
    avgScore: number | null;
    ratings: Record<GradeRating, number>;
  }>;
}

export interface DocState {
  exercise: {
    id: string;
    title: string;
    status: "draft" | "lobby" | "live" | "paused" | "ended" | "abandoned";
    scenarioStartAt: string | null;
    startedAt: string | null;
    advancePolicy: string;
  };
  now: string;
  me: { participantId: string; displayName: string; roles: string[]; isGuest: boolean } | null;
  viewer: { isControl: boolean; isDriver: boolean };
  config: { scribeMode: boolean; moduleMinutes: number | null };
  canPost: boolean;
  canModerate: boolean;
  canGrade: boolean;
  document: { id: string; title: string; kind: string; sections: Array<{ id: string; heading: string; level: number }> } | null;
  modulesTotal: number | null;
  injects: DocModule[];
  current: string | null;
  debrief: { modules: DocDebriefModule[] };
}

export function asDocState(state: unknown): DocState | null {
  const s = state as Partial<DocState> | null;
  if (!s || !s.exercise || !Array.isArray(s.injects)) return null;
  return {
    canPost: false,
    canModerate: false,
    canGrade: false,
    document: null,
    modulesTotal: null,
    current: null,
    config: { scribeMode: false, moduleMinutes: null },
    debrief: { modules: [] },
    ...s,
  } as DocState;
}
