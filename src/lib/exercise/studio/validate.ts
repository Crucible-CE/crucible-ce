// Full Studio check: per mode schema, graph rules and mode rules. Pure; the
// editor runs it on every change and the API runs it on save and publish.

import type { ZodError, ZodIssue } from "zod";
import { branchConditionSchema } from "@/lib/exercise/modes/shared/branching";
import { QUESTION_KEY_RE } from "@/lib/exercise/modes/document/validate";
import { MODE_CONDITIONS, outcomeOptions, CONDITION_LABELS } from "./conditions";
import { validateGraph, type StudioIssue } from "./graph";
import {
  GRAPH_SCHEMAS,
  INJECT_SCHEMAS,
  MAX_NODES,
  STUDIO_MODE_LABELS,
  TEMPLATE_SCHEMAS,
  studioBranchSchema,
  type DocumentGraph,
  type StrategicGraph,
  type StudioGraph,
  type StudioMode,
} from "./schema";

export interface RawGraph {
  template: unknown;
  injects: unknown[];
  branches: unknown[];
}

const LABELS: Record<string, string> = {
  title: "Title",
  summary: "Summary",
  teams: "Teams",
  targetDurationMin: "Target duration",
  scenarioAnchor: "Scenario start",
  weekday: "Start day",
  time: "Start time",
  regulatoryClocks: "Regulatory clocks",
  executiveBriefMd: "Executive brief",
  objectives: "Objectives",
  key: "Key",
  text: "Text",
  label: "Label",
  scenarioOffsetMin: "Scenario time",
  plannedDelayMin: "Planned minutes",
  narrativeMd: "Narrative",
  artifacts: "Artifacts",
  content: "Text",
  teamVariants: "Team variants",
  team: "Team",
  questions: "Questions",
  expectedActions: "Expected actions",
  clockUpdates: "Clock updates",
  capabilityKeys: "Capabilities",
  mitreTags: "MITRE tags",
  gradingNotes: "Grading notes",
  scenarioUpdate: "Scenario update",
  keyIssues: "Key issues",
  rationale: "What it tests",
  sourceExcerpt: "Source excerpt",
  docSectionRefs: "Sections",
  objectiveKeys: "Objectives",
  moduleMinutes: "Minutes per module",
  nodeId: "Node id",
  seq: "Order",
  from: "Sender",
  sentAt: "Sent at",
  kind: "Kind",
};

const PARENTS: Record<string, string> = {
  artifacts: "Artifact",
  teamVariants: "Team variant",
  questions: "Question",
  objectives: "Objective",
  regulatoryClocks: "Clock",
  keyIssues: "Key issue",
  expectedActions: "Expected action",
  teams: "Team name",
};

function labelFor(path: Array<string | number>): string {
  const last = [...path].reverse().find((p) => typeof p === "string") as string | undefined;
  const lastIdx = path.length - 1;
  // "teamVariants.2.narrativeMd" reads "Team variant narrative"; "teams.1" reads "Team name".
  if (typeof path[lastIdx] === "number") {
    const parent = path[lastIdx - 1];
    if (typeof parent === "string" && PARENTS[parent]) return PARENTS[parent];
  }
  const parentKey = path.slice(0, -1).reverse().find((p) => typeof p === "string") as string | undefined;
  const own = last ? (LABELS[last] ?? "A field") : "A field";
  if (parentKey && PARENTS[parentKey] && last !== parentKey) return `${PARENTS[parentKey]} ${own.toLowerCase()}`;
  return own;
}

function messageFor(i: ZodIssue): string {
  const label = labelFor(i.path);
  switch (i.code) {
    case "too_small":
      return i.type === "array" ? `${label} needs at least ${String(i.minimum)}.` : i.type === "string" ? `${label} is too short.` : `${label} is too small.`;
    case "too_big":
      return i.type === "array" ? `${label} has too many items.` : i.type === "string" ? `${label} is too long.` : `${label} is too large.`;
    case "invalid_type":
      return i.received === "undefined" || i.received === "null" ? `${label} is missing.` : `${label} is not valid.`;
    case "invalid_string":
      return `${label} has a format that is not allowed.`;
    case "custom":
      return i.message;
    default:
      return `${label} is not valid.`;
  }
}

/** Zod errors as Studio issues. */
export function zodIssues(err: ZodError, nodeId: string | null, branch?: number): StudioIssue[] {
  const seen = new Set<string>();
  const out: StudioIssue[] = [];
  for (const i of err.issues) {
    const message = messageFor(i);
    if (seen.has(message)) continue;
    seen.add(message);
    out.push({ severity: "error", code: "schema", message, nodeId, ...(branch !== undefined ? { branch } : {}) });
  }
  return out;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});

/** Every issue for a draft graph, and the parsed graph when it is valid. */
export function validateStudio(mode: StudioMode, raw: RawGraph): { issues: StudioIssue[]; graph: StudioGraph | null } {
  const issues: StudioIssue[] = [];
  const t = TEMPLATE_SCHEMAS[mode].safeParse(raw.template);
  if (!t.success) issues.push(...zodIssues(t.error, null));

  if (raw.injects.length > MAX_NODES[mode]) {
    issues.push({ severity: "error", code: "too_many", message: `Use ${MAX_NODES[mode]} injects or fewer.`, nodeId: null });
  }
  for (const r of raw.injects) {
    const nodeId = typeof obj(r).nodeId === "string" ? (obj(r).nodeId as string) : null;
    const p = INJECT_SCHEMAS[mode].safeParse(r);
    if (!p.success) issues.push(...zodIssues(p.error, nodeId));
  }
  for (const [i, b] of raw.branches.entries()) {
    const p = studioBranchSchema.safeParse(b);
    if (!p.success && branchConditionSchema.safeParse(obj(b).condition).success) {
      issues.push({ severity: "error", code: "schema", message: "A branch is not valid. Remove it and draw it again.", nodeId: null, branch: i });
    }
  }

  const branching = obj(raw.template).branching === "branched" ? "branched" : "linear";
  issues.push(
    ...validateGraph({
      branching,
      injects: raw.injects.map((r, i) => {
        const o = obj(r);
        return {
          nodeId: String(o.nodeId ?? ""),
          seq: typeof o.seq === "number" ? o.seq : i + 1,
          title: String(o.title ?? ""),
          position: obj(o.position) as { end?: boolean },
        };
      }),
      branches: raw.branches.map((b) => {
        const o = obj(b);
        return {
          fromNodeId: String(o.fromNodeId ?? ""),
          toNodeId: String(o.toNodeId ?? ""),
          condition: o.condition,
          priority: typeof o.priority === "number" ? o.priority : 0,
        };
      }),
    }),
  );

  const full = GRAPH_SCHEMAS[mode].safeParse(raw);
  const graph = full.success ? full.data : null;
  if (t.success) {
    issues.push(...(mode === "strategic" ? strategicChecks(raw, t.data as StrategicGraph["template"]) : documentChecks(raw, t.data as DocumentGraph["template"])));
    issues.push(...branchModeChecks(mode, raw, (t.data.config as { teams: string[] }).teams, branching));
  }
  return { issues: dedupe(issues), graph };
}

function dupes(list: string[]): string[] {
  const seen = new Set<string>();
  const out = new Set<string>();
  for (const v of list) {
    const k = v.trim().toLowerCase();
    if (seen.has(k)) out.add(v);
    seen.add(k);
  }
  return [...out];
}

function strategicChecks(raw: RawGraph, template: StrategicGraph["template"]): StudioIssue[] {
  const issues: StudioIssue[] = [];
  const add = (severity: StudioIssue["severity"], code: string, message: string, nodeId: string | null) => issues.push({ severity, code, message, nodeId });
  const teams = template.config.teams;
  for (const d of dupes(teams)) add("error", "duplicate_team", `Two teams are named ${d}. Team names must be different.`, null);
  for (const d of dupes(template.objectives.map((o) => o.key))) add("error", "duplicate_objective", `Objective key ${d} is used twice.`, null);
  for (const d of dupes(template.config.regulatoryClocks.map((c) => c.key))) add("error", "duplicate_clock", `Clock ${d} is listed twice.`, null);
  const teamSet = new Set(teams);
  const objectives = new Set(template.objectives.map((o) => o.key));
  const clocks = new Set(template.config.regulatoryClocks.map((c) => c.key));

  for (const r of raw.injects) {
    const p = INJECT_SCHEMAS.strategic.safeParse(r);
    if (!p.success) continue;
    const inj = p.data;
    const id = inj.nodeId;
    const variants = inj.content.teamVariants;
    if (variants.length === 0) add("warning", "no_variants", "Add at least one team variant.", id);
    const seen = new Set<string>();
    for (const v of variants) {
      if (!teamSet.has(v.team)) add("error", "unknown_team", `${v.team} is not a team in this template.`, id);
      if (seen.has(v.team)) add("error", "duplicate_variant", `${v.team} has two variants.`, id);
      seen.add(v.team);
      const keys = v.questions.map((q) => q.key);
      if (new Set(keys).size !== keys.length) add("error", "duplicate_question", `Two questions for ${v.team} share a key.`, id);
    }
    const active = variants.filter((v) => v.status === "active");
    if (variants.length > 0 && active.length === 0) add("warning", "no_active", "Make at least one team active.", id);
    for (const v of active) {
      if (v.questions.length === 0) add("warning", "no_questions", `${v.team} has no questions.`, id);
      const ea = inj.secret.expectedActions[v.team]?.filter((a) => a.trim()) ?? [];
      if (ea.length === 0) add("warning", "no_expected_actions", `${v.team} has no expected actions.`, id);
    }
    const activeNames = new Set(active.map((v) => v.team));
    for (const [team, list] of Object.entries(inj.secret.expectedActions)) {
      if (list.length && !activeNames.has(team)) add("warning", "stale_expected_actions", `${team} has expected actions but is not active.`, id);
    }
    if (inj.objectiveKeys.some((k) => !objectives.has(k))) add("error", "unknown_objective", "Links an objective that does not exist.", id);
    if (inj.secret.clockUpdates.some((c) => !clocks.has(c.key))) add("error", "unknown_clock", "Updates a clock that is not in the template.", id);
    const artifactIds = inj.content.artifacts.map((a) => a.id);
    if (new Set(artifactIds).size !== artifactIds.length) add("error", "duplicate_artifact", "Two artifacts share an id.", id);
  }
  return issues;
}

function documentChecks(raw: RawGraph, template: DocumentGraph["template"]): StudioIssue[] {
  const issues: StudioIssue[] = [];
  const add = (severity: StudioIssue["severity"], code: string, message: string, nodeId: string | null) => issues.push({ severity, code, message, nodeId });
  for (const d of dupes(template.config.teams)) add("error", "duplicate_team", `Two teams are named ${d}. Team names must be different.`, null);
  for (const d of dupes(template.objectives.map((o) => o.key))) add("error", "duplicate_objective", `Objective key ${d} is used twice.`, null);
  const objectives = new Set(template.objectives.map((o) => o.key));
  const keys = new Map<string, string>();
  for (const r of raw.injects) {
    const p = INJECT_SCHEMAS.document.safeParse(r);
    if (!p.success) continue;
    const m = p.data;
    for (const q of m.content.questions) {
      if (!QUESTION_KEY_RE.test(q.key)) add("error", "question_key", `Question key ${q.key} has characters that are not allowed.`, m.nodeId);
      const prior = keys.get(q.key);
      if (prior !== undefined) add("error", "duplicate_question", `Question key ${q.key} is used in two modules.`, m.nodeId);
      else keys.set(q.key, m.nodeId);
      if (q.objectiveKeys.some((k) => !objectives.has(k))) add("warning", "unknown_objective", "A question links an objective that does not exist.", m.nodeId);
    }
  }
  return issues;
}

function branchModeChecks(mode: StudioMode, raw: RawGraph, teams: string[], branching: "linear" | "branched"): StudioIssue[] {
  if (branching !== "branched") return [];
  const issues: StudioIssue[] = [];
  const teamSet = new Set(teams);
  const outcomes = new Set(outcomeOptions(mode).map((o) => o.value));
  for (const [i, b] of raw.branches.entries()) {
    const from = typeof obj(b).fromNodeId === "string" ? (obj(b).fromNodeId as string) : null;
    const c = branchConditionSchema.safeParse(obj(b).condition);
    if (!c.success) continue;
    const cond = c.data;
    if (!MODE_CONDITIONS[mode].includes(cond.type)) {
      issues.push({ severity: "warning", code: "unused_condition", message: `${CONDITION_LABELS[cond.type]} never matches in ${STUDIO_MODE_LABELS[mode]}.`, nodeId: from, branch: i });
    }
    if (cond.type === "team_outcome" || cond.type === "majority") {
      if (teams.length === 0) {
        issues.push({ severity: "warning", code: "no_teams", message: "A branch checks a team, but the template has no teams.", nodeId: from, branch: i });
      } else if (!teamSet.has(cond.team)) {
        issues.push({ severity: "error", code: "unknown_team", message: `A branch names ${cond.team}, which is not a team in this template.`, nodeId: from, branch: i });
      }
    }
    if (cond.type === "team_outcome" && !outcomes.has(cond.outcome)) {
      issues.push({ severity: "warning", code: "unknown_outcome", message: "A branch checks an outcome that grading never sets.", nodeId: from, branch: i });
    }
  }
  return issues;
}

function dedupe(issues: StudioIssue[]): StudioIssue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const k = `${i.severity}|${i.nodeId}|${i.branch ?? ""}|${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
