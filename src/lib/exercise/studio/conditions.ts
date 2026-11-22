// Branch condition helpers for the Studio editor. Every condition the editor
// produces is parsed with branchConditionSchema from src/modes/shared/branching,
// so what is saved is exactly what the runtime evaluates. Pure.

import { branchConditionSchema, type BranchCondition } from "@/lib/exercise/modes/shared/branching";
import { ANSWER_RATINGS, ANSWER_RATING_LABELS } from "@/lib/exercise/modes/strategic/schema";
import { ENTRY_TYPES, ENTRY_TYPE_LABELS, GRADE_RATINGS, GRADE_RATING_LABELS } from "@/lib/exercise/modes/document/schema";
import type { StudioMode } from "./schema";

export type ConditionType = BranchCondition["type"];

export const CONDITION_TYPES: readonly ConditionType[] = [
  "default",
  "always",
  "team_outcome",
  "score_below",
  "score_at_least",
  "entries_at_least",
  "majority",
  "path",
];

export const CONDITION_LABELS: Record<ConditionType, string> = {
  default: "Otherwise",
  always: "Always",
  team_outcome: "Team outcome",
  score_below: "Average score below",
  score_at_least: "Average score at least",
  entries_at_least: "Entry count at least",
  majority: "Team vote majority",
  path: "Scenario path",
};

export const CONDITION_HINTS: Record<ConditionType, string> = {
  default: "Used when no other branch from this node matches.",
  always: "Always taken when reached in priority order.",
  team_outcome: "Uses the team's effective grade on this inject.",
  score_below: "Average grade on this inject, from 0 to 4.",
  score_at_least: "Average grade on this inject, from 0 to 4.",
  entries_at_least: "Counts entries of one type posted on this inject.",
  majority: "The option most of a team voted for.",
  path: "The scenario path after this inject closes.",
};

/** Condition types the runtime can match for a mode. Others are kept but flagged. */
export const MODE_CONDITIONS: Record<StudioMode, readonly ConditionType[]> = {
  strategic: ["default", "always", "team_outcome", "score_below", "score_at_least"],
  document: ["default", "always", "team_outcome", "score_below", "score_at_least", "entries_at_least"],
};

export const PATH_OPTIONS = [
  { value: "optimal", label: "On track" },
  { value: "degrading", label: "Under strain" },
  { value: "critical", label: "Escalating" },
];

export function outcomeOptions(mode: StudioMode): Array<{ value: string; label: string }> {
  if (mode === "strategic") return ANSWER_RATINGS.map((r) => ({ value: r, label: ANSWER_RATING_LABELS[r] }));
  return GRADE_RATINGS.map((r) => ({ value: r, label: GRADE_RATING_LABELS[r] }));
}

export const ENTRY_TYPE_OPTIONS = ENTRY_TYPES.map((t) => ({ value: t, label: ENTRY_TYPE_LABELS[t] }));

/** Editable fields for any condition type. */
export interface ConditionFields {
  team: string;
  outcome: string;
  value: string;
  entryType: string;
  count: string;
  optionId: string;
  path: string;
}

export function emptyFields(mode: StudioMode, teams: string[]): ConditionFields {
  return {
    team: teams[0] ?? "",
    outcome: outcomeOptions(mode)[outcomeOptions(mode).length - 1]?.value ?? "",
    value: "2",
    entryType: "gap",
    count: "1",
    optionId: "A",
    path: "critical",
  };
}

/** Fields for an existing condition, filling the rest with defaults. */
export function fieldsOf(cond: unknown, mode: StudioMode, teams: string[]): ConditionFields {
  const f = emptyFields(mode, teams);
  const p = branchConditionSchema.safeParse(cond);
  if (!p.success) return f;
  const c = p.data;
  switch (c.type) {
    case "team_outcome":
      return { ...f, team: c.team, outcome: c.outcome };
    case "score_below":
    case "score_at_least":
      return { ...f, value: String(c.value) };
    case "entries_at_least":
      return { ...f, entryType: c.entryType, count: String(c.count) };
    case "majority":
      return { ...f, team: c.team, optionId: c.optionId };
    case "path":
      return { ...f, path: c.path };
    default:
      return f;
  }
}

export type BuildResult = { ok: true; condition: BranchCondition } | { ok: false; error: string };

/** Build a condition from editor fields. The result always parses with branchConditionSchema. */
export function buildCondition(type: ConditionType, f: ConditionFields): BuildResult {
  let raw: unknown;
  switch (type) {
    case "always":
    case "default":
      raw = { type };
      break;
    case "team_outcome":
      if (!f.team.trim()) return { ok: false, error: "Pick a team." };
      if (!f.outcome.trim()) return { ok: false, error: "Pick an outcome." };
      raw = { type, team: f.team.trim(), outcome: f.outcome.trim() };
      break;
    case "score_below":
    case "score_at_least": {
      const n = Number(f.value);
      if (f.value.trim() === "" || !Number.isFinite(n) || n < 0 || n > 4) return { ok: false, error: "Enter a score from 0 to 4." };
      raw = { type, value: Math.round(n * 10) / 10 };
      break;
    }
    case "entries_at_least": {
      const n = Number(f.count);
      if (!Number.isInteger(n) || n < 1 || n > 100) return { ok: false, error: "Enter a whole number from 1 to 100." };
      if (!f.entryType.trim()) return { ok: false, error: "Pick an entry type." };
      raw = { type, entryType: f.entryType.trim(), count: n };
      break;
    }
    case "majority":
      if (!f.team.trim()) return { ok: false, error: "Pick a team." };
      if (!f.optionId.trim()) return { ok: false, error: "Enter an option id." };
      raw = { type, team: f.team.trim(), optionId: f.optionId.trim().slice(0, 4) };
      break;
    case "path":
      if (!f.path.trim()) return { ok: false, error: "Pick a path." };
      raw = { type, path: f.path.trim() };
      break;
  }
  const parsed = branchConditionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "The condition is not valid." };
  return { ok: true, condition: parsed.data };
}

/** A short label for an edge, for example "Legal: Not effective". */
export function describeCondition(cond: unknown, mode: StudioMode): string {
  const p = branchConditionSchema.safeParse(cond);
  if (!p.success) return "Invalid condition";
  const c = p.data;
  switch (c.type) {
    case "always":
      return "Always";
    case "default":
      return "Otherwise";
    case "team_outcome": {
      const label = outcomeOptions(mode).find((o) => o.value === c.outcome)?.label ?? c.outcome;
      return `${c.team}: ${label}`;
    }
    case "score_below":
      return `Score below ${c.value}`;
    case "score_at_least":
      return `Score ${c.value} or more`;
    case "entries_at_least": {
      const label = ENTRY_TYPE_OPTIONS.find((o) => o.value === c.entryType)?.label ?? c.entryType;
      return `${c.count}+ ${label.toLowerCase()} entries`;
    }
    case "majority":
      return `${c.team} picks ${c.optionId}`;
    case "path":
      return `Path ${PATH_OPTIONS.find((o) => o.value === c.path)?.label ?? c.path}`;
  }
}

export function conditionType(cond: unknown): ConditionType | null {
  const p = branchConditionSchema.safeParse(cond);
  return p.success ? p.data.type : null;
}
