// Shared runtime types. Modes import only this file and @/lib/exercise/content.

import type { z } from "zod";

export const MODES = ["crisissim", "document", "strategic"] as const;
export type Mode = (typeof MODES)[number];

export type ExerciseStatus = "draft" | "lobby" | "live" | "paused" | "ended" | "abandoned";
export type InjectStatus = "pending" | "held" | "open" | "closed";
export type InjectSource = "template" | "contingency" | "module";
export type ResponseKind = "vote" | "answer" | "entry" | "deliverable";
export type AdvancePolicy = "facilitator" | "all_teams" | "votes_in" | "timer";
export type CloseTrigger = "votes_in" | "all_teams" | "timer" | "facilitator" | "endex";
export type EndReason = "facilitator" | "timebox" | "budget" | "template_exhausted" | "win_condition" | "abandoned";

export const EXERCISE_ROLES = [
  "lead_facilitator",
  "controller",
  "evaluator",
  "scribe",
  "player",
  "observer",
] as const;
export type ExerciseRole = (typeof EXERCISE_ROLES)[number];

/** Roles that see the control room: hidden scoring, evaluator notes, MSEL. */
export const CONTROL_ROLES: readonly ExerciseRole[] = ["lead_facilitator", "controller", "evaluator"];
/** Roles that may drive the exercise (advance, hold, release, close, ENDEX). */
export const DRIVER_ROLES: readonly ExerciseRole[] = ["lead_facilitator", "controller"];

export interface TeamRow {
  id: string;
  name: string;
  seq: number;
}

export interface ParticipantRow {
  id: string;
  userId: string | null;
  displayName: string;
  title: string | null;
  teamId: string | null;
  roles: ExerciseRole[];
  isDecisionMaker: boolean;
  isGuest: boolean;
  joinedAt: Date | null;
  leftAt: Date | null;
  removedAt: Date | null;
}

export interface InjectRow {
  id: string;
  seq: number;
  status: InjectStatus;
  source: InjectSource;
  title: string;
  scenarioTime: Date | null;
  targetTeamIds: string[];
  content: unknown;
  secret: unknown;
  templateInjectId: string | null;
  budgetMs: number | null;
  openedAt: Date | null;
  closesAt: Date | null;
  closedAt: Date | null;
  closeTrigger: string | null;
}

export interface ResponseRow {
  id: string;
  injectId: string;
  participantId: string;
  teamId: string | null;
  kind: ResponseKind;
  payload: unknown;
  status: string;
  createdAt: Date;
}

export interface GradeRow {
  id: string;
  responseId: string;
  source: "human";
  attempt: number;
  score: number | null;
  rating: string | null;
  rationale: string | null;
  createdAt: Date;
}

export interface ExerciseRow {
  id: string;
  mode: Mode;
  title: string;
  status: ExerciseStatus;
  stateVersion: number;
  config: unknown;
  secret: unknown;
  templateId: string | null;
  sourceDocumentId: string | null;
  currentInjectId: string | null;
  scenarioStartAt: Date | null;
  timeboxMin: number | null;
  injectBudget: number | null;
  advancePolicy: AdvancePolicy;
  startedAt: Date | null;
  pausedAt: Date | null;
  pausedMsTotal: number;
  endedAt: Date | null;
  endReason: string | null;
  isPractice: boolean;
}

export interface ScoreRow {
  path: string | null;
  cumulative: number;
  teamScores: Record<string, unknown>;
}

export interface TemplateInjectRow {
  id: string;
  nodeId: string;
  seq: number;
  title: string;
  scenarioOffsetMin: number;
  plannedDelayMin: number | null;
  targetTeams: string[];
  expectedActions: unknown;
  objectiveKeys: string[];
  content: unknown;
  secret: unknown;
}

export interface TemplateBranchRow {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  condition: unknown;
  priority: number;
}

export interface TemplateData {
  id: string;
  mode: Mode;
  config: unknown;
  branching: "linear" | "branched";
  injects: TemplateInjectRow[];
  branches: TemplateBranchRow[];
}

export interface SourceDocumentData {
  id: string;
  kind: string;
  title: string;
  text: string;
  sha256: string;
  sections: Array<{ id: string; heading: string; level: number; start: number; end: number }>;
}

/** Everything a mode may read about an exercise. Plain data, no db handles. */
export interface ExerciseSnapshot<C = unknown> {
  exercise: ExerciseRow;
  config: C;
  teams: TeamRow[];
  participants: ParticipantRow[];
  /** All injects, ordered by seq. */
  injects: InjectRow[];
  score: ScoreRow | null;
  template: TemplateData | null;
  document: SourceDocumentData | null;
}

export interface CloseSnapshot<C = unknown> extends ExerciseSnapshot<C> {
  inject: InjectRow;
  /** Responses to the closing inject, read inside the close transaction. */
  responses: ResponseRow[];
  trigger: CloseTrigger;
  now: Date;
}

export interface AbstainRow {
  participantId: string;
  teamId: string | null;
  payload: Record<string, unknown>;
}

export interface CloseOutcome {
  /** New score state, or null to leave it untouched. */
  score: ScoreRow | null;
  /** Vote rows to create for required voters who did not vote. */
  abstains: AbstainRow[];
  /** Payload fields to merge into existing responses (for example resolved quality). */
  responseUpdates: Array<{ responseId: string; payloadPatch: Record<string, unknown> }>;
  /** Appended to ExerciseEvent. */
  events: Array<{ type: string; data: Record<string, unknown> }>;
  /** Small public summary sent with the close event and kept on the inject_closed event. */
  summary: Record<string, unknown>;
  /** Set when the close itself should end the exercise (win condition). */
  endReason?: EndReason | null;
  /** Regulatory clock changes, applied by the runtime at the inject's scenario time. */
  clockUpdates?: Array<{ key: string; action: "trigger" | "met" }>;
}

export interface JobSpec {
  kind: string;
  key: string;
  payload: Record<string, unknown>;
  runAfter?: Date;
}

export interface InjectDraft {
  title: string;
  source: InjectSource;
  scenarioTime: Date | null;
  targetTeamIds: string[];
  content: unknown;
  secret: unknown;
  templateInjectId: string | null;
  budgetMs: number | null;
  /** True when the inject should wait for controller release. */
  hold?: boolean;
}

export interface PlanInput<C = unknown> {
  snapshot: ExerciseSnapshot<C>;
  seq: number;
  /**
   * Summary of the most recent close, if any. The runtime adds `avgScore`
   * (0 to 4, effective grades) and `outcomes` (team name to rating) when
   * grades exist, so branch conditions can use them.
   */
  lastClose: { injectId: string; summary: Record<string, unknown> } | null;
  /** The last few closed injects with responses and effective grades, oldest first. */
  history: Array<{
    injectId: string;
    seq: number;
    title: string;
    content: unknown;
    responses: Array<{ teamId: string | null; teamName: string | null; kind: ResponseKind; payload: unknown; rating: string | null; score: number | null }>;
  }>;
}

export interface ResponseInput<C = unknown> {
  snapshot: ExerciseSnapshot<C>;
  inject: InjectRow;
  participant: ParticipantRow;
  kind: ResponseKind;
  raw: unknown;
  /** Responses already stored for this inject by this participant or team. */
  existing: ResponseRow[];
}

export interface ValidatedResponse {
  kind: ResponseKind;
  teamId: string | null;
  payload: Record<string, unknown>;
  /** Replace an existing response with this id instead of inserting. */
  replaceId?: string | null;
}

export class ResponseError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ResponseError";
  }
}

export interface RequiredResponders {
  /** "participant": every id must respond. "team": every team id must have one answer. */
  by: "participant" | "team" | "none";
  ids: string[];
}

export interface Viewer {
  participant: ParticipantRow | null;
  /** Control room access (lead facilitator, controller, evaluator). */
  isControl: boolean;
  /** May drive the exercise. */
  isDriver: boolean;
}

/** One exercise event as a viewer may see it. view.ts filters and redacts per viewer. */
export interface FeedItem {
  id: string;
  type: string;
  at: Date;
  data: Record<string, unknown>;
}

export interface ExerciseView<C = unknown> extends ExerciseSnapshot<C> {
  /** Responses for the current inject plus the viewer's own history. Filtered by the route. */
  responses: ResponseRow[];
  grades: GradeRow[];
  /** Close summaries from inject_closed events, keyed by inject id. */
  closeSummaries: Record<string, Record<string, unknown>>;
  /**
   * Exercise events for this viewer, oldest first. Players get a filtered,
   * redacted list (never scores). Optional so hand-built views in unit tests
   * stay valid; projectFor always sets it.
   */
  feed?: FeedItem[];
  /** Regulatory clocks for this exercise. Optional for hand-built test views. */
  clocks?: ClockRow[];
  /** Player-safe exercise plan fields. Optional for hand-built test views. */
  plan?: PublicPlan | null;
  /** Exercise objectives (text only). Optional for hand-built test views. */
  objectives?: Array<{ id: string; seq: number; text: string }>;
  /** Instance IANA time zone for every displayed timestamp. Optional for hand-built test views (UTC). */
  timezone?: string;
  now: Date;
}

/** Exercise plan fields every participant may read (the player brief). */
export interface PublicPlan {
  executiveBriefMd: string | null;
  scope: string;
  groundRules: string;
  assumptions: string;
  stopWord: string;
  noFaultStatement: string;
}

export interface ClockRow {
  key: string;
  label: string;
  status: string;
  triggeredAt: Date | null;
  deadlineAt: Date | null;
  metAt: Date | null;
}

export interface ModeCaps {
  teams: boolean;
  teamVariants: boolean;
  advance: AdvancePolicy[];
  /** Injects may wait for controller release. */
  controllerHold: boolean;
}

export interface ExerciseMode<C = unknown> {
  key: Mode;
  label: string;
  version: number;
  caps: ModeCaps;
  configSchema: z.ZodType<C, z.ZodTypeDef, unknown>;
  injectContentSchema: z.ZodType<unknown>;
  injectSecretSchema: z.ZodType<unknown>;
  /** Default advance policy for new exercises. */
  defaultAdvancePolicy: AdvancePolicy;
  /** Initial score state at start, or null for modes without one. */
  initialScore(snapshot: ExerciseSnapshot<C>): ScoreRow | null;
  /** No transaction. Returns null when there is nothing left to deliver. */
  planInject(input: PlanInput<C>): Promise<InjectDraft | null>;
  /** Runs inside the response transaction. Throw ResponseError to reject. */
  validateResponse(input: ResponseInput<C>): ValidatedResponse;
  requiredResponders(snapshot: ExerciseSnapshot<C>, inject: InjectRow): RequiredResponders;
  /** Pure and synchronous. */
  scoreClose(snapshot: CloseSnapshot<C>): CloseOutcome;
  jobsAfterClose(snapshot: CloseSnapshot<C>, outcome: CloseOutcome): JobSpec[];
  /** Pure. Checked after each close and by the cron sweep. */
  checkEnd(snapshot: ExerciseSnapshot<C>, now: Date): EndReason | null;
  /** The only way exercise state reaches a client. */
  project(view: ExerciseView<C>, viewer: Viewer): Record<string, unknown>;
}

