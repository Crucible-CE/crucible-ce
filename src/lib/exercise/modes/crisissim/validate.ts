// Semantic checks for a Crisis Sim template, beyond what the zod schemas
// enforce. Used by the generation pipeline (per inject, with one retry), the
// editor (warnings on save), and publish (must be clean). Pure.

import {
  OPTION_TRIGGER_CLOCKS,
  PATH_KEYS,
  QUALITY_SCORES,
  type ExpectedActions,
  type PathKey,
  type Quality,
  type TemplateConfig,
  type TemplateInjectContent,
  type TemplateInjectSecret,
} from "./schema";

export interface TemplateInjectDraft {
  title: string;
  scenarioOffsetMin: number;
  plannedDelayMin: number | null;
  targetTeams: string[];
  objectiveKeys: string[];
  /** [{team, actions}]. Optional so older callers and imports stay valid. */
  expectedActions?: ExpectedActions;
  content: TemplateInjectContent;
  secret: TemplateInjectSecret;
}

/** The best option is flagged when it is longer than this many times the average option. */
export const BEST_LENGTH_FACTOR = 1.5;

/** Ids of the highest rated options on a path. */
export function bestOptionIds(
  options: Array<{ id: string }>,
  quality: Record<string, Partial<Record<PathKey, Quality>>>,
  path: PathKey,
): string[] {
  let best = -Infinity;
  let ids: string[] = [];
  for (const o of options) {
    const s = QUALITY_SCORES[quality[o.id]?.[path] ?? "neutral"];
    if (s > best) {
      best = s;
      ids = [o.id];
    } else if (s === best) ids.push(o.id);
  }
  return ids;
}

/**
 * Soft check used by generation (one retry with the note) and the seed tests,
 * not by publish: a best option much longer than the others gives it away.
 */
export function optionBalanceIssues(inj: Pick<TemplateInjectDraft, "content" | "secret">): string[] {
  const out: string[] = [];
  for (const q of inj.content.questions) {
    const lengths = q.options.map((o) => o.text.trim().length);
    const avg = lengths.reduce((a, b) => a + b, 0) / Math.max(1, lengths.length);
    const quality = inj.secret.quality[q.team] ?? {};
    const flagged = new Set<string>();
    for (const p of PATH_KEYS) {
      for (const id of bestOptionIds(q.options, quality, p)) {
        const o = q.options.find((x) => x.id === id);
        if (o && o.text.trim().length > BEST_LENGTH_FACTOR * avg) flagged.add(id);
      }
    }
    for (const id of flagged) {
      out.push(`${q.team} option ${id} is a best option and much longer than the others. Keep all four options within 30 percent of each other in length.`);
    }
  }
  return out;
}

export interface ValidationIssue {
  /** Zero-based inject index, or null for template-level issues. */
  inject: number | null;
  message: string;
}

export interface InjectCheckContext {
  teams: string[];
  clockKeys: string[];
  objectiveKeys?: string[];
}

/** Teams an inject asks questions of: its target teams, or every team. */
export function injectTeams(inj: { targetTeams: string[] }, teams: string[]): string[] {
  return inj.targetTeams.length > 0 ? inj.targetTeams : teams;
}

/** Problems with one inject, as plain sentences. Empty when it is fine. */
export function checkInject(inj: TemplateInjectDraft, ctx: InjectCheckContext): string[] {
  const out: string[] = [];
  const teamSet = new Set(ctx.teams);
  const clockSet = new Set(ctx.clockKeys);

  for (const t of inj.targetTeams) {
    if (!teamSet.has(t)) out.push(`Target team ${t} is not in the scenario.`);
  }
  if (ctx.objectiveKeys) {
    const objSet = new Set(ctx.objectiveKeys);
    for (const k of inj.objectiveKeys) if (!objSet.has(k)) out.push(`Objective ${k} does not exist.`);
  }

  const expected = injectTeams(inj, ctx.teams);
  const seen = new Set<string>();
  for (const q of inj.content.questions) {
    if (seen.has(q.team)) out.push(`${q.team} has more than one question.`);
    seen.add(q.team);
    if (!expected.includes(q.team)) out.push(`${q.team} has a question but is not a target team.`);

    const ids = q.options.map((o) => o.id);
    if (new Set(ids).size !== ids.length) out.push(`${q.team} has duplicate option ids.`);
    const quality = inj.secret.quality[q.team] ?? {};
    for (const o of q.options) {
      const qp = quality[o.id];
      for (const p of PATH_KEYS) {
        if (!qp?.[p]) out.push(`${q.team} option ${o.id} has no quality for the ${p} path.`);
      }
    }
    for (const p of PATH_KEYS) {
      const anyGood = q.options.some((o) => {
        const level = quality[o.id]?.[p];
        return level === "great" || level === "good";
      });
      if (!anyGood) out.push(`${q.team} has no great or good option on the ${p} path.`);
    }
    for (const optId of Object.keys(quality)) {
      if (!ids.includes(optId)) out.push(`${q.team} has quality for a missing option ${optId}.`);
    }
    for (const optId of Object.keys(inj.secret.followUps[q.team] ?? {})) {
      if (!ids.includes(optId)) out.push(`${q.team} has a follow-up for a missing option ${optId}.`);
    }
    for (const [optId, effects] of Object.entries(inj.secret.clockEffects[q.team] ?? {})) {
      if (!ids.includes(optId)) out.push(`${q.team} has a clock effect for a missing option ${optId}.`);
      for (const e of effects) {
        if (!clockSet.has(e.key)) out.push(`${q.team} option ${optId} uses clock ${e.key}, which is not selected.`);
        else if (e.action === "trigger" && !OPTION_TRIGGER_CLOCKS.includes(e.key)) {
          out.push(`${q.team} option ${optId} starts clock ${e.key}. Start it from the inject instead.`);
        }
      }
    }
    for (const optId of Object.keys(inj.secret.rationales?.[q.team] ?? {})) {
      if (!ids.includes(optId)) out.push(`${q.team} has a rationale for a missing option ${optId}.`);
    }
  }
  const triggers = [...(inj.secret.clockTriggers ?? []), ...PATH_KEYS.flatMap((p) => inj.secret.clockTriggersByPath?.[p] ?? [])];
  for (const key of new Set(triggers)) {
    if (!clockSet.has(key)) out.push(`The inject starts clock ${key}, which is not selected.`);
  }
  for (const ea of inj.expectedActions ?? []) {
    if (!teamSet.has(ea.team)) out.push(`Expected actions are set for ${ea.team}, which is not in the scenario.`);
  }
  for (const t of expected) {
    if (!seen.has(t)) out.push(`${t} has no question.`);
  }
  for (const team of Object.keys(inj.secret.quality)) {
    if (!seen.has(team)) out.push(`Quality is set for ${team}, which has no question.`);
  }

  if (inj.content.deliverable) {
    if (!teamSet.has(inj.content.deliverable.team)) out.push(`The written task team ${inj.content.deliverable.team} is not in the scenario.`);
    if (inj.secret.deliverableCriteria.length === 0) out.push("The written task has no grading criteria.");
  }
  if (inj.plannedDelayMin !== null && (inj.plannedDelayMin < 1 || inj.plannedDelayMin > 120)) {
    out.push("Planned minutes must be between 1 and 120.");
  }
  return out;
}

/** Every issue in a template. Empty means it can be published. */
export function validateTemplate(t: {
  config: TemplateConfig;
  injects: TemplateInjectDraft[];
  objectives?: Array<{ key: string }>;
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const clockKeys = t.config.regulatoryClocks.map((c) => c.key);
  const ctx: InjectCheckContext = {
    teams: t.config.teams,
    clockKeys,
    objectiveKeys: t.objectives?.map((o) => o.key),
  };

  if (t.injects.length === 0) issues.push({ inject: null, message: "Add at least one inject." });
  if (new Set(t.config.teams).size !== t.config.teams.length) issues.push({ inject: null, message: "Team names must be unique." });
  if (t.config.pathThresholds.optimal <= t.config.pathThresholds.degrading) {
    issues.push({ inject: null, message: "The contained threshold must be above the escalating threshold." });
  }

  t.injects.forEach((inj, i) => {
    for (const m of checkInject(inj, ctx)) issues.push({ inject: i, message: m });
    if (i > 0 && inj.scenarioOffsetMin <= t.injects[i - 1].scenarioOffsetMin) {
      issues.push({ inject: i, message: "Scenario time must be later than the previous inject." });
    }
  });

  if (clockKeys.includes("sec_8k")) {
    const hasMateriality = t.injects.some((inj) =>
      inj.content.questions.some(
        (q) =>
          q.type === "materiality" &&
          Object.values(inj.secret.clockEffects[q.team] ?? {}).some((effs) => effs.some((e) => e.key === "sec_8k" && e.action === "trigger")),
      ),
    );
    if (!hasMateriality) {
      issues.push({ inject: null, message: "The SEC 8-K clock needs a materiality question with an option that starts it." });
    }
  }
  return issues;
}

/** One line per issue, for error messages. */
export function formatIssues(issues: ValidationIssue[], max = 5): string {
  const lines = issues.slice(0, max).map((i) => (i.inject === null ? i.message : `Inject ${i.inject + 1}: ${i.message}`));
  if (issues.length > max) lines.push(`${issues.length - max} more.`);
  return lines.join(" ");
}
