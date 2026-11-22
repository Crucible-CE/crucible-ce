// Client state for the Crisis Sim template editor. The editor state is the
// PATCH body plus client-only keys. Pure helpers, no React.

import {
  PATH_KEYS,
  PATH_LABELS,
  QUALITY_LEVELS,
  expectedActionsSchema,
  templateConfigSchema,
  templateInjectContentSchema,
  templateInjectSecretSchema,
  templateObjectivesSchema,
  type Artifact,
  type ExpectedActions,
  type PathKey,
  type Quality,
  type QuestionPublic,
  type TemplateConfig,
  type TemplateInjectContent,
  type TemplateInjectSecret,
  type TemplateObjective,
} from "@/lib/exercise/modes/crisissim/schema";
import { cleanTechniqueIds } from "@/lib/exercise/content/mitre";
import { injectTeams, validateTemplate, type ValidationIssue } from "@/lib/exercise/modes/crisissim/validate";
export type TemplateStatus = "draft" | "published" | "archived";

export interface ApiTemplate {
  template: {
    id: string;
    mode: string;
    title: string;
    summary: string | null;
    status: TemplateStatus;
    version: number;
    config: unknown;
    objectives: unknown;
  };
  injects: Array<{
    id: string;
    title: string;
    scenarioOffsetMin: number;
    plannedDelayMin: number | null;
    targetTeams: string[];
    objectiveKeys: string[];
    expectedActions?: unknown;
    content: unknown;
    secret: unknown;
  }>;
  issues: ValidationIssue[];
}

/** A question and its scoring, kept while its team is not targeted so re-selecting restores it. */
export interface StashedQuestion {
  question: QuestionPublic;
  quality: TemplateInjectSecret["quality"][string];
  followUps: TemplateInjectSecret["followUps"][string];
  clockEffects: TemplateInjectSecret["clockEffects"][string];
  rationales: TemplateInjectSecret["rationales"][string];
}

export interface EditorInject {
  /** Client key for lists. */
  key: string;
  id?: string;
  title: string;
  scenarioOffsetMin: number;
  plannedDelayMin: number | null;
  targetTeams: string[];
  objectiveKeys: string[];
  /** [{team, actions}] observable actions for the MSEL and evaluators. */
  expectedActions: ExpectedActions;
  content: TemplateInjectContent;
  secret: TemplateInjectSecret;
  stash?: Record<string, StashedQuestion>;
}

export interface EditorState {
  title: string;
  summary: string;
  config: TemplateConfig;
  objectives: TemplateObjective[];
  injects: EditorInject[];
}

export type Variant = TemplateInjectContent["variants"][PathKey];
export type ClockEffect = TemplateInjectSecret["clockEffects"][string][string][number];

export const OPTION_IDS = ["a", "b", "c", "d"] as const;

let keySeq = 0;
export function newKey(prefix = "k"): string {
  keySeq += 1;
  return `${prefix}${Date.now().toString(36)}${keySeq}`;
}

export function clone<T>(v: T): T {
  return structuredClone(v);
}

/** Copy, apply a mutation to the copy, return it. */
export function produce<T>(v: T, fn: (draft: T) => void): T {
  const next = clone(v);
  fn(next);
  return next;
}

// ---------------------------------------------------------------------------
// Lenient normalizers. Stored content can be invalid; keep what is there.
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
function obj(v: unknown): Obj {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown, d = ""): string {
  return typeof v === "string" ? v : d;
}
function optStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function int(v: unknown, d: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : d;
}
function strs(v: unknown): string[] {
  return arr(v).filter((x): x is string => typeof x === "string");
}
function quality(v: unknown): Quality {
  return (QUALITY_LEVELS as readonly string[]).includes(v as string) ? (v as Quality) : "neutral";
}

export function normalizeConfig(raw: unknown): TemplateConfig {
  const c = obj(raw);
  const th = obj(c.pathThresholds);
  const teams = strs(c.teams);
  return {
    ...(c as Partial<TemplateConfig>),
    schemaVersion: 1,
    teams: teams.length ? teams : ["Executive"],
    pathThresholds: { optimal: int(th.optimal, 4), degrading: int(th.degrading, -3) },
    targetDurationMin: int(c.targetDurationMin, 60),
    executiveBriefMd: optStr(c.executiveBriefMd),
    capabilityKeys: strs(c.capabilityKeys),
    regulatoryClocks: arr(c.regulatoryClocks).map((x) => {
      const r = obj(x);
      return {
        key: str(r.key),
        label: str(r.label),
        ...(typeof r.durationHours === "number" ? { durationHours: r.durationHours } : {}),
        ...(typeof r.businessDays === "number" ? { businessDays: r.businessDays } : {}),
      };
    }),
  };
}

export function normalizeObjectives(raw: unknown): TemplateObjective[] {
  return arr(raw).map((x) => {
    const o = obj(x);
    return { key: str(o.key), text: str(o.text), capabilityKeys: strs(o.capabilityKeys) };
  });
}

function normalizeArtifact(raw: unknown, i: number): Artifact {
  const a = obj(raw);
  return {
    id: str(a.id, `x${i + 1}`),
    kind: (str(a.kind, "email") as Artifact["kind"]) || "email",
    title: str(a.title),
    content: str(a.content),
    ...(typeof a.from === "string" ? { from: a.from } : {}),
    ...(typeof a.sentAt === "string" ? { sentAt: a.sentAt } : {}),
  };
}

function normalizeVariant(raw: unknown): Variant {
  const v = obj(raw);
  return {
    narrativeMd: str(v.narrativeMd),
    consequenceText: optStr(v.consequenceText),
    artifacts: arr(v.artifacts).map(normalizeArtifact),
  };
}

function normalizeQuestion(raw: unknown): QuestionPublic {
  const q = obj(raw);
  return {
    team: str(q.team),
    stem: str(q.stem),
    options: arr(q.options).map((o, i) => ({ id: str(obj(o).id, OPTION_IDS[i] ?? String(i)), text: str(obj(o).text) })),
    decisionOwner: optStr(q.decisionOwner),
    discussionPrompt: optStr(q.discussionPrompt),
    type: q.type === "materiality" ? "materiality" : q.type === "ransom" ? "ransom" : "standard",
    capabilityKeys: strs(q.capabilityKeys),
  };
}

export function normalizeContent(raw: unknown): TemplateInjectContent {
  const c = obj(raw);
  const v = obj(c.variants);
  const d = c.deliverable ? obj(c.deliverable) : null;
  return {
    schemaVersion: 1,
    variants: {
      optimal: normalizeVariant(v.optimal),
      degrading: normalizeVariant(v.degrading),
      critical: normalizeVariant(v.critical),
    },
    questions: arr(c.questions).map(normalizeQuestion),
    ...(d
      ? {
          deliverable: {
            team: str(d.team),
            kind: (str(d.kind, "other") as NonNullable<TemplateInjectContent["deliverable"]>["kind"]) || "other",
            prompt: str(d.prompt),
          },
        }
      : {}),
  };
}

export function normalizeSecret(raw: unknown): TemplateInjectSecret {
  const s = obj(raw);
  const q: TemplateInjectSecret["quality"] = {};
  for (const [team, byOpt] of Object.entries(obj(s.quality))) {
    q[team] = {};
    for (const [opt, qp] of Object.entries(obj(byOpt))) {
      const p = obj(qp);
      q[team][opt] = { optimal: quality(p.optimal), degrading: quality(p.degrading), critical: quality(p.critical) };
    }
  }
  const f: TemplateInjectSecret["followUps"] = {};
  for (const [team, byOpt] of Object.entries(obj(s.followUps))) {
    f[team] = {};
    for (const [opt, text] of Object.entries(obj(byOpt))) if (typeof text === "string") f[team][opt] = text;
  }
  const ce: TemplateInjectSecret["clockEffects"] = {};
  for (const [team, byOpt] of Object.entries(obj(s.clockEffects))) {
    ce[team] = {};
    for (const [opt, effects] of Object.entries(obj(byOpt))) {
      ce[team][opt] = arr(effects).map((e) => ({ key: str(obj(e).key), action: obj(e).action === "met" ? "met" : "trigger" }));
    }
  }
  const r: TemplateInjectSecret["rationales"] = {};
  for (const [team, byOpt] of Object.entries(obj(s.rationales))) {
    r[team] = {};
    for (const [opt, text] of Object.entries(obj(byOpt))) if (typeof text === "string") r[team][opt] = text;
  }
  const byPath = obj(s.clockTriggersByPath);
  const clockTriggersByPath: TemplateInjectSecret["clockTriggersByPath"] = {};
  for (const p of PATH_KEYS) if (Array.isArray(byPath[p])) clockTriggersByPath[p] = strs(byPath[p]);
  return {
    schemaVersion: 1,
    quality: q,
    followUps: f,
    clockEffects: ce,
    deliverableCriteria: strs(s.deliverableCriteria),
    rationales: r,
    clockTriggers: strs(s.clockTriggers),
    clockTriggersByPath,
    attackTechniques: cleanTechniqueIds(s.attackTechniques),
  };
}

export function normalizeExpectedActions(raw: unknown): ExpectedActions {
  return arr(raw)
    .map((x) => {
      const o = obj(x);
      return { team: str(o.team), actions: strs(o.actions) };
    })
    .filter((x) => x.team);
}

export function fromApi(data: ApiTemplate): EditorState {
  return {
    title: data.template.title,
    summary: data.template.summary ?? "",
    config: normalizeConfig(data.template.config),
    objectives: normalizeObjectives(data.template.objectives),
    injects: data.injects.map((i) => ({
      key: i.id,
      id: i.id,
      title: i.title,
      scenarioOffsetMin: i.scenarioOffsetMin,
      plannedDelayMin: i.plannedDelayMin,
      targetTeams: [...i.targetTeams],
      objectiveKeys: [...i.objectiveKeys],
      expectedActions: normalizeExpectedActions(i.expectedActions),
      content: normalizeContent(i.content),
      secret: normalizeSecret(i.secret),
    })),
  };
}

/** The PATCH body. */
export function toBody(s: EditorState) {
  return {
    title: s.title,
    summary: s.summary.trim() ? s.summary : null,
    config: s.config,
    objectives: s.objectives,
    injects: s.injects.map((i) => ({
      ...(i.id ? { id: i.id } : {}),
      title: i.title,
      scenarioOffsetMin: i.scenarioOffsetMin,
      plannedDelayMin: i.plannedDelayMin,
      targetTeams: i.targetTeams,
      objectiveKeys: i.objectiveKeys,
      expectedActions: i.expectedActions
        .map((e) => ({ team: e.team, actions: e.actions.map((a) => a.trim()).filter(Boolean) }))
        .filter((e) => e.actions.length > 0),
      content: i.content,
      secret: i.secret,
    })),
  };
}

export async function fetchTemplate(id: string): Promise<{ data: ApiTemplate | null; error: string | null }> {
  try {
    const res = await fetch(`/api/templates/${id}`, { cache: "no-store" });
    const body = (await res.json().catch(() => null)) as (ApiTemplate & { error?: string }) | null;
    if (!res.ok || !body?.template) return { data: null, error: body?.error ?? "The template did not load. Try again." };
    return { data: body, error: null };
  } catch {
    return { data: null, error: "The template did not load. Check your connection and try again." };
  }
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

export function placeholderQuestion(team: string): { question: QuestionPublic; quality: StashedQuestion["quality"] } {
  const q: StashedQuestion["quality"] = {};
  OPTION_IDS.forEach((id, i) => {
    const level: Quality = i === 0 ? "good" : "neutral";
    q[id] = { optimal: level, degrading: level, critical: level };
  });
  return {
    question: {
      team,
      stem: "What does the team do next?",
      options: OPTION_IDS.map((id) => ({ id, text: `Option ${id.toUpperCase()}` })),
      decisionOwner: "",
      discussionPrompt: "",
      type: "standard",
      capabilityKeys: [],
    },
    quality: q,
  };
}

function placeholderVariant(path: PathKey): Variant {
  return {
    narrativeMd: `Write what the teams learn at this point when the scenario is ${PATH_LABELS[path].toLowerCase()}.`,
    consequenceText: "",
    artifacts: [],
  };
}

export function newInject(state: EditorState): EditorInject {
  const last = state.injects[state.injects.length - 1];
  const secret: TemplateInjectSecret = {
    schemaVersion: 1,
    quality: {},
    followUps: {},
    clockEffects: {},
    deliverableCriteria: [],
    rationales: {},
    clockTriggers: [],
    clockTriggersByPath: {},
    attackTechniques: [],
  };
  const questions: QuestionPublic[] = [];
  for (const team of state.config.teams) {
    const p = placeholderQuestion(team);
    questions.push(p.question);
    secret.quality[team] = p.quality;
  }
  return {
    key: newKey("new"),
    title: `Inject ${state.injects.length + 1}`,
    scenarioOffsetMin: last ? last.scenarioOffsetMin + 30 : 0,
    plannedDelayMin: null,
    targetTeams: [],
    objectiveKeys: [],
    expectedActions: [],
    content: {
      schemaVersion: 1,
      variants: { optimal: placeholderVariant("optimal"), degrading: placeholderVariant("degrading"), critical: placeholderVariant("critical") },
      questions,
    },
    secret,
  };
}

// ---------------------------------------------------------------------------
// Team-wide edits
// ---------------------------------------------------------------------------

function renameKey<T>(rec: Record<string, T>, from: string, to: string) {
  if (!(from in rec)) return;
  rec[to] = rec[from];
  delete rec[from];
}

/** Rename a team everywhere it appears. The caller checks the new name is free. */
export function renameTeam(state: EditorState, from: string, to: string): EditorState {
  return produce(state, (s) => {
    s.config.teams = s.config.teams.map((t) => (t === from ? to : t));
    for (const inj of s.injects) {
      inj.targetTeams = inj.targetTeams.map((t) => (t === from ? to : t));
      for (const q of inj.content.questions) if (q.team === from) q.team = to;
      renameKey(inj.secret.quality, from, to);
      renameKey(inj.secret.followUps, from, to);
      renameKey(inj.secret.clockEffects, from, to);
      renameKey(inj.secret.rationales, from, to);
      for (const e of inj.expectedActions) if (e.team === from) e.team = to;
      if (inj.content.deliverable?.team === from) inj.content.deliverable.team = to;
      if (inj.stash && from in inj.stash) {
        renameKey(inj.stash, from, to);
        inj.stash[to].question.team = to;
      }
    }
  });
}

/** Keep exactly one question per team the inject asks. Removed questions go to the stash. */
export function syncQuestions(inj: EditorInject, teams: string[]): void {
  const expected = injectTeams(inj, teams);
  const stash = inj.stash ?? {};
  const kept: QuestionPublic[] = [];
  for (const q of inj.content.questions) {
    if (expected.includes(q.team)) {
      kept.push(q);
      continue;
    }
    if (teams.includes(q.team)) {
      stash[q.team] = {
        question: q,
        quality: inj.secret.quality[q.team] ?? {},
        followUps: inj.secret.followUps[q.team] ?? {},
        clockEffects: inj.secret.clockEffects[q.team] ?? {},
        rationales: inj.secret.rationales[q.team] ?? {},
      };
    }
    delete inj.secret.quality[q.team];
    delete inj.secret.followUps[q.team];
    delete inj.secret.clockEffects[q.team];
    delete inj.secret.rationales[q.team];
  }
  for (const team of expected) {
    if (kept.some((q) => q.team === team)) continue;
    const saved = stash[team];
    if (saved) {
      kept.push(saved.question);
      inj.secret.quality[team] = saved.quality;
      if (Object.keys(saved.followUps).length) inj.secret.followUps[team] = saved.followUps;
      if (Object.keys(saved.clockEffects).length) inj.secret.clockEffects[team] = saved.clockEffects;
      if (Object.keys(saved.rationales ?? {}).length) inj.secret.rationales[team] = saved.rationales;
      delete stash[team];
    } else {
      const p = placeholderQuestion(team);
      kept.push(p.question);
      inj.secret.quality[team] = p.quality;
    }
  }
  // Keep the scenario team order.
  kept.sort((a, b) => teams.indexOf(a.team) - teams.indexOf(b.team));
  inj.content.questions = kept;
  for (const team of Object.keys(stash)) if (!teams.includes(team)) delete stash[team];
  inj.stash = stash;
}

export function addTeam(state: EditorState, name: string): EditorState {
  return produce(state, (s) => {
    s.config.teams.push(name);
    for (const inj of s.injects) syncQuestions(inj, s.config.teams);
  });
}

export function removeTeam(state: EditorState, team: string): EditorState {
  return produce(state, (s) => {
    s.config.teams = s.config.teams.filter((t) => t !== team);
    for (const inj of s.injects) {
      inj.targetTeams = inj.targetTeams.filter((t) => t !== team);
      inj.expectedActions = inj.expectedActions.filter((e) => e.team !== team);
      if (inj.content.deliverable?.team === team) inj.content.deliverable.team = s.config.teams[0] ?? "";
      if (inj.stash) delete inj.stash[team];
      syncQuestions(inj, s.config.teams);
    }
  });
}

export function nextTeamName(teams: string[]): string {
  let n = teams.length + 1;
  while (teams.includes(`Team ${n}`)) n += 1;
  return `Team ${n}`;
}

/** Drop clock effects and triggers that use a clock no longer selected. */
export function pruneClockEffects(state: EditorState): void {
  const keys = new Set(state.config.regulatoryClocks.map((c) => c.key));
  for (const inj of state.injects) {
    inj.secret.clockTriggers = inj.secret.clockTriggers.filter((k) => keys.has(k));
    for (const p of PATH_KEYS) {
      const list = inj.secret.clockTriggersByPath[p];
      if (list) inj.secret.clockTriggersByPath[p] = list.filter((k) => keys.has(k));
    }
    for (const byOpt of Object.values(inj.secret.clockEffects)) {
      for (const [opt, effects] of Object.entries(byOpt)) {
        const kept = effects.filter((e) => keys.has(e.key));
        if (kept.length) byOpt[opt] = kept;
        else delete byOpt[opt];
      }
    }
  }
}

export function nextObjectiveKey(objectives: TemplateObjective[]): string {
  const max = Math.max(0, ...objectives.map((o) => Number(/^o(\d+)$/.exec(o.key)?.[1] ?? 0)));
  return `o${max + 1}`;
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export function formatOffset(min: number): string {
  if (!Number.isFinite(min) || min < 0) return "T+0m";
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  const parts = [d ? `${d}d` : "", h ? `${h}h` : "", m || (!d && !h) ? `${m}m` : ""].filter(Boolean);
  return `T+${parts.join(" ")}`;
}

// ---------------------------------------------------------------------------
// Live checks: schema problems as plain sentences, then validateTemplate.
// ---------------------------------------------------------------------------

interface ZodLikeIssue {
  code: string;
  path: (string | number)[];
  minimum?: number | bigint;
  maximum?: number | bigint;
  type?: string;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function sentence(where: string, issue: ZodLikeIssue): string {
  const w = cap(where);
  const min = issue.minimum !== undefined ? Number(issue.minimum) : undefined;
  const max = issue.maximum !== undefined ? Number(issue.maximum) : undefined;
  if (issue.code === "too_small") {
    if (issue.type === "string") return min && min > 1 ? `${w} needs at least ${min} characters.` : `${w} is empty.`;
    if (issue.type === "array") return `${w} needs at least ${min} ${min === 1 ? "entry" : "entries"}.`;
    return `${w} must be at least ${min}.`;
  }
  if (issue.code === "too_big") {
    if (issue.type === "string") return `${w} is longer than ${max} characters.`;
    if (issue.type === "array") return `${w} has more than ${max} entries.`;
    return `${w} must be at most ${max}.`;
  }
  if (issue.code === "invalid_type") return `${w} is missing.`;
  return `${w} is not valid.`;
}

function pathLabel(p: unknown): string {
  return typeof p === "string" && p in PATH_LABELS ? `the ${PATH_LABELS[p as PathKey]} path` : "a path";
}

function contentWhere(path: (string | number)[], content: TemplateInjectContent): string {
  const [a, b, c, d, e] = path;
  if (a === "variants") {
    const where = pathLabel(b);
    if (c === "narrativeMd") return `the narrative on ${where}`;
    if (c === "consequenceText") return `the consequence on ${where}`;
    if (c === "artifacts" && typeof d === "number") {
      const field = e === "content" ? " text" : e === "title" ? " title" : e === "from" ? " sender" : "";
      return `artifact ${d + 1}${field} on ${where}`;
    }
    if (c === "artifacts") return `the artifacts on ${where}`;
    return where;
  }
  if (a === "questions" && typeof b === "number") {
    const q = content.questions[b];
    const team = q?.team || `question ${b + 1}`;
    if (c === "stem") return `the question for ${team}`;
    if (c === "options" && typeof d === "number") return `option ${q?.options[d]?.id ?? d + 1} for ${team}`;
    if (c === "options") return `the options for ${team}`;
    if (c === "decisionOwner") return `the decision owner for ${team}`;
    if (c === "discussionPrompt") return `the discussion prompt for ${team}`;
    if (c === "capabilityKeys") return `the capabilities for ${team}`;
    if (c === "team") return `the team name on question ${b + 1}`;
    return `the question for ${team}`;
  }
  if (a === "questions") return "the questions";
  if (a === "deliverable") return b === "prompt" ? "the written task prompt" : b === "team" ? "the written task team" : "the written task";
  return "the inject content";
}

function secretWhere(path: (string | number)[]): string {
  const [a, b, c] = path;
  if (a === "followUps") return `the follow-up for ${String(b)} option ${String(c)}`;
  if (a === "deliverableCriteria" && typeof b === "number") return `grading criterion ${b + 1}`;
  if (a === "deliverableCriteria") return "the grading criteria";
  if (a === "clockEffects") return `the clock effects for ${String(b)}`;
  if (a === "rationales") return `the rationale for ${String(b)} option ${String(c)}`;
  if (a === "clockTriggers" || a === "clockTriggersByPath") return "the clocks this inject starts";
  return "the scoring";
}

function configWhere(path: (string | number)[]): string {
  const [a, b] = path;
  if (a === "teams" && typeof b === "number") return `team ${b + 1}`;
  if (a === "teams") return "the teams";
  if (a === "targetDurationMin") return "the target duration";
  if (a === "pathThresholds") return "the thresholds";
  if (a === "executiveBriefMd") return "the executive brief";
  if (a === "regulatoryClocks") return "the regulatory clocks";
  if (a === "capabilityKeys") return "the scenario capabilities";
  if (a === "scenarioAnchor") return "the scenario start day and time";
  return "the scenario settings";
}

export function liveIssues(s: EditorState): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const push = (inject: number | null, message: string) => {
    if (!out.some((x) => x.inject === inject && x.message === message)) out.push({ inject, message });
  };

  if (s.title.trim().length < 3) push(null, "The title needs at least 3 characters.");
  if (s.summary.length > 800) push(null, "The summary is longer than 800 characters.");
  const config = templateConfigSchema.safeParse(s.config);
  if (!config.success) for (const i of config.error.issues) push(null, sentence(configWhere(i.path), i as ZodLikeIssue));
  const objectives = templateObjectivesSchema.safeParse(s.objectives);
  if (!objectives.success) {
    for (const i of objectives.error.issues) {
      const o = typeof i.path[0] === "number" ? s.objectives[i.path[0]] : undefined;
      push(null, sentence(o ? `objective ${o.key}` : "the objectives", i as ZodLikeIssue));
    }
  }
  if (new Set(s.objectives.map((o) => o.key)).size !== s.objectives.length) push(null, "Objective keys must be unique.");
  if (s.injects.length > 30) push(null, "A template can have at most 30 injects.");

  s.injects.forEach((inj, idx) => {
    if (!inj.title.trim()) push(idx, "The inject needs a title.");
    if (!Number.isInteger(inj.scenarioOffsetMin) || inj.scenarioOffsetMin < 0) push(idx, "Scenario time must be zero or more minutes.");
    const content = templateInjectContentSchema.safeParse(inj.content);
    if (!content.success) for (const i of content.error.issues) push(idx, sentence(contentWhere(i.path, inj.content), i as ZodLikeIssue));
    const secret = templateInjectSecretSchema.safeParse(inj.secret);
    if (!secret.success) for (const i of secret.error.issues) push(idx, sentence(secretWhere(i.path), i as ZodLikeIssue));
  });

  s.injects.forEach((inj, idx) => {
    const ea = expectedActionsSchema.safeParse(
      inj.expectedActions.map((e) => ({ team: e.team, actions: e.actions.map((a) => a.trim()).filter(Boolean) })),
    );
    if (!ea.success) push(idx, "An expected action is longer than 300 characters.");
  });
  for (const i of validateTemplate({ config: s.config, injects: s.injects, objectives: s.objectives })) push(i.inject, i.message);
  return out;
}

export { PATH_KEYS, PATH_LABELS, QUALITY_LEVELS };
