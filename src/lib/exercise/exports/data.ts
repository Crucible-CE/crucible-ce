// Data for the exercise documents (HSEEP style):
//
//   Situation Manual (SitMan), for every participant. Purpose, scope,
//   objectives, capabilities, ground rules, assumptions, no-fault statement,
//   stop word, schedule, teams, the executive brief, and contacts (names and
//   roles, no account emails). Document TTX adds module titles and discussion
//   questions: every module for control, only released modules (open or
//   closed) for everyone else, so none before STARTEX. Crisis Sim and
//   Strategic TTX get the brief only: no inject titles, narratives, questions
//   or expected actions, whatever the exercise status.
//
//   Controller and Evaluator handbook (C/E handbook), control only.
//   Everything in the SitMan plus sponsor and hazard, the MSEL with planned
//   times, inject narratives per path or team, questions and options,
//   expected actions, the intended option per team per path (Crisis Sim),
//   and an EEG page per objective.
//
// The builders return plain data so tests can check what each audience gets
// without rendering a PDF. The route checks who may ask for which.

import { db } from "@/lib/db";
import { RATINGS, RATING_LABELS } from "@/lib/exercise/ratings";
import { PATH_KEYS, PATH_LABELS, QUALITY_SCORES, type Quality } from "@/lib/exercise/modes/crisissim/schema";
import { MODES, type Mode } from "@/lib/exercise/runtime/types";
import { getExerciseSettings } from "@/lib/exercise/settings";
import { buildMsel, expectedActionLines, questionsOf, techniqueLabel, type MselRow } from "../msel";
import { readPlan } from "../schemas";
import { formatInZone } from "../time";
import { ServiceError } from "../errors";

export const EXPORT_KINDS = ["situation-manual", "ce-handbook", "msel-csv"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export const MODE_TEXT: Record<Mode, string> = { crisissim: "Crisis Sim", document: "Playbook Exercise", strategic: "Strategic TTX" };

const CONTACT_ROLES = ["lead_facilitator", "controller", "evaluator"] as const;
const ROLE_TEXT: Record<string, string> = {
  lead_facilitator: "Lead facilitator",
  controller: "Controller",
  evaluator: "Evaluator",
  scribe: "Scribe",
  player: "Player",
  observer: "Observer",
};

const DEFAULT_GROUND_RULES = [
  "This is a safe space. Speak freely.",
  "Respond as you would in a real event, with the plans and people you have today.",
  "Decisions here do not set policy.",
  "The scenario is plausible. Do not fight it.",
  "Stop play with the stop word if a real event needs you.",
].join("\n");

export interface ExportPerson {
  name: string;
  title: string | null;
  organization: string | null;
  email: string | null;
  roles: string[];
}

export interface SitManData {
  kind: "situation-manual";
  instanceName: string;
  timezone: string;
  generatedAt: string;
  exercise: {
    id: string;
    title: string;
    mode: Mode;
    modeLabel: string;
    status: string;
    isPractice: boolean;
    startex: string | null;
    durationMin: number | null;
    scenarioStart: string | null;
  };
  purpose: string;
  scope: string;
  objectives: Array<{ seq: number; text: string; capabilities: string[] }>;
  capabilities: Array<{ framework: string; key: string; name: string }>;
  groundRules: string;
  assumptions: string;
  noFault: string;
  stopWord: string;
  teams: Array<{ name: string; members: Array<{ name: string; title: string | null }> }>;
  /** Plain text of the template's executive brief. */
  scenario: string | null;
  /** Document TTX only: module titles and discussion questions. */
  modules: Array<{ seq: number; title: string; questions: string[] }> | null;
  contacts: ExportPerson[];
}

export interface InjectDetail {
  seq: number;
  title: string;
  when: string;
  scenarioTime: string | null;
  teams: string[];
  objectives: string[];
  narratives: Array<{ label: string; text: string }>;
  questions: Array<{ team: string; text: string; owner: string | null; options: Array<{ id: string; text: string }> }>;
  /** Crisis Sim: the best rated option per team per path. */
  intended: Array<{ team: string; path: string; option: string; why: string | null }>;
  expectedActions: string[];
  deliverable: string | null;
  controllerNotes: string | null;
  /** "T1486 Data Encrypted for Impact" per ATT&CK tag. */
  techniques: string[];
}

export interface HandbookData extends Omit<SitManData, "kind" | "modules"> {
  kind: "ce-handbook";
  sponsor: string;
  hazard: string;
  modules: SitManData["modules"];
  msel: Array<{ seq: number; when: string; scenarioTime: string | null; title: string; teams: string[]; objectives: string[]; status: string; techniques: string[] }>;
  injects: InjectDetail[];
  eeg: Array<{ seq: number; text: string; capabilities: string[]; injects: string[]; criticalTasks: string[] }>;
  ratingLegend: Array<{ rating: string; label: string }>;
}

// ---------------------------------------------------------------------------
// Tolerant readers for inject JSON (any mode, any schema version)
// ---------------------------------------------------------------------------

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Markdown to plain text: keep the words. */
export function plain(md: string): string {
  return md
    .replace(/\r\n?/g, "\n")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\(([^)]*)\)/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "- ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Narrative text blocks in inject content, labelled. */
export function narrativesOf(content: unknown): Array<{ label: string; text: string }> {
  const c = rec(content);
  const out: Array<{ label: string; text: string }> = [];
  const variants = rec(c.variants);
  for (const path of PATH_KEYS) {
    const v = rec(variants[path]);
    const n = str(v.narrativeMd);
    if (!n) continue;
    const consequence = str(v.consequenceText);
    out.push({ label: `${PATH_LABELS[path]} path`, text: plain(consequence ? `${n}\n\nConsequence: ${consequence}` : n) });
  }
  const main = str(c.narrativeMd) ?? str(c.narrative);
  if (main) {
    const path = str(c.path);
    out.push({ label: path && path in PATH_LABELS ? `${PATH_LABELS[path as keyof typeof PATH_LABELS]} path` : "Narrative", text: plain(main) });
  }
  for (const tv of arr(c.teamVariants)) {
    const t = rec(tv);
    const n = str(t.narrativeMd) ?? str(t.narrative);
    if (!n) continue;
    const status = str(t.status) === "standby" ? " (standby)" : "";
    out.push({ label: `${str(t.team) ?? "Team"}${status}`, text: plain(n) });
  }
  const update = str(c.scenarioUpdate);
  if (update) out.push({ label: "Scenario update", text: plain(update) });
  const issues = arr(c.keyIssues).map(str).filter((x): x is string => Boolean(x));
  if (issues.length) out.push({ label: "Key issues", text: issues.map((i) => `- ${i}`).join("\n") });
  for (const a of arr(c.artifacts).slice(0, 6)) {
    const art = rec(a);
    const title = str(art.title);
    const body = str(art.content);
    if (title && body) out.push({ label: `Artifact: ${title}`, text: plain(body).slice(0, 2000) });
  }
  return out;
}

/** Questions in inject content, including Strategic team variant questions. */
export function allQuestionsOf(content: unknown): InjectDetail["questions"] {
  const out: InjectDetail["questions"] = questionsOf(content).map((q) => ({ team: q.team, text: q.question, owner: q.owner, options: q.options }));
  for (const tv of arr(rec(content).teamVariants)) {
    const t = rec(tv);
    for (const q of arr(t.questions)) {
      const text = str(rec(q).text);
      if (text) out.push({ team: str(t.team) ?? "All teams", text, owner: null, options: [] });
    }
  }
  return out;
}

/** Crisis Sim: per team and path, the option(s) with the best quality. */
export function intendedOptions(content: unknown, secret: unknown): InjectDetail["intended"] {
  const quality = rec(rec(secret).quality);
  const rationales = rec(rec(secret).rationales);
  const questions = questionsOf(content);
  const out: InjectDetail["intended"] = [];
  for (const [team, byOption] of Object.entries(quality)) {
    const options = rec(byOption);
    const q = questions.find((x) => x.team === team);
    for (const path of PATH_KEYS) {
      let best = -Infinity;
      let ids: string[] = [];
      for (const [optionId, byPath] of Object.entries(options)) {
        const level = str(rec(byPath)[path]) as Quality | null;
        if (!level || !(level in QUALITY_SCORES)) continue;
        const score = QUALITY_SCORES[level];
        if (score > best) {
          best = score;
          ids = [optionId];
        } else if (score === best) ids.push(optionId);
      }
      if (ids.length === 0) continue;
      const text = ids.map((id) => q?.options.find((o) => o.id === id)?.text ?? `Option ${id}`).join(" or ");
      const why = ids.map((id) => str(rec(rationales[team])[id])).find(Boolean) ?? null;
      out.push({ team, path: PATH_LABELS[path], option: text, why });
    }
  }
  return out;
}

function deliverableOf(content: unknown): string | null {
  const d = rec(rec(content).deliverable);
  const prompt = str(d.prompt);
  return prompt ? `${str(d.team) ?? "All teams"}: ${prompt}` : null;
}

function dedupe(lines: string[]): string[] {
  return [...new Set(lines.map((l) => l.trim()).filter(Boolean))];
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

async function loadBase(exerciseId: string) {
  const ex = await db.exercise.findUnique({
    where: { id: exerciseId },
    select: {
      id: true,
      title: true,
      mode: true,
      status: true,
      isPractice: true,
      plan: true,
      templateId: true,
      sourceDocumentId: true,
      startedAt: true,
      timeboxMin: true,
      scenarioStartAt: true,
      template: { select: { summary: true, config: true } },
      objectives: { orderBy: { seq: "asc" }, select: { id: true, seq: true, text: true, capabilityIds: true } },
      teams: { orderBy: { seq: "asc" }, select: { id: true, name: true } },
      participants: {
        where: { removedAt: null },
        orderBy: { createdAt: "asc" },
        select: { displayName: true, title: true, organization: true, teamId: true, roles: true, isGuest: true, user: { select: { email: true } } },
      },
    },
  });
  if (!ex) throw new ServiceError(404, "Exercise not found.");
  const instance = await getExerciseSettings();
  const capIds = [...new Set(ex.objectives.flatMap((o) => o.capabilityIds))];
  const caps = capIds.length
    ? await db.capability.findMany({ where: { id: { in: capIds } }, select: { id: true, framework: true, key: true, name: true }, orderBy: [{ framework: "asc" }, { seq: "asc" }] })
    : [];
  return { ex, instance, caps };
}

type Base = Awaited<ReturnType<typeof loadBase>>;

/** A contact. Without details: name and roles only. */
function person(p: Base["ex"]["participants"][number], withDetails: boolean): ExportPerson {
  return {
    name: p.displayName,
    title: withDetails ? p.title : null,
    organization: withDetails ? p.organization : null,
    email: withDetails && !p.isGuest ? (p.user?.email ?? null) : null,
    roles: p.roles.map((r) => ROLE_TEXT[r] ?? r),
  };
}

/**
 * Document TTX modules. `releasedOnly`: modules delivered in this exercise
 * (open or closed), for viewers outside the control team.
 */
async function documentModules(ex: Base["ex"], releasedOnly = false): Promise<SitManData["modules"]> {
  if (ex.mode !== "document") return null;
  const rows = releasedOnly
    ? await db.inject.findMany({ where: { exerciseId: ex.id, status: { in: ["open", "closed"] } }, orderBy: { seq: "asc" }, select: { seq: true, title: true, content: true } })
    : ex.templateId
    ? await db.templateInject.findMany({ where: { templateId: ex.templateId }, orderBy: { seq: "asc" }, select: { seq: true, title: true, content: true } })
    : await db.inject.findMany({ where: { exerciseId: ex.id }, orderBy: { seq: "asc" }, select: { seq: true, title: true, content: true } });
  return rows.map((r, i) => ({
    seq: i + 1,
    title: r.title,
    questions: arr(rec(r.content).questions)
      .map((q) => str(rec(q).text))
      .filter((x): x is string => Boolean(x)),
  }));
}

function sitManFrom(b: Base, modules: SitManData["modules"], contactRoles: readonly string[], withContactDetails: boolean): SitManData {
  const { ex, instance, caps } = b;
  const tz = instance?.timezone ?? "UTC";
  const plan = readPlan(ex.plan);
  const mode = ((MODES as readonly string[]).includes(ex.mode) ? ex.mode : "crisissim") as Mode;
  const capName = new Map(caps.map((c) => [c.id, `${c.name} (${c.key})`]));
  const brief = str(rec(ex.template?.config).executiveBriefMd);
  const summary = str(ex.template?.summary);
  return {
    kind: "situation-manual",
    instanceName: instance?.name ?? "Crucible CE",
    timezone: tz,
    generatedAt: new Date().toISOString(),
    exercise: {
      id: ex.id,
      title: ex.title,
      mode,
      modeLabel: MODE_TEXT[mode],
      status: ex.status,
      isPractice: ex.isPractice,
      startex: ex.startedAt ? formatInZone(ex.startedAt, tz) : null,
      durationMin: ex.timeboxMin,
      scenarioStart: ex.scenarioStartAt ? formatInZone(ex.scenarioStartAt, tz) : null,
    },
    purpose: summary ?? "Test plans, decisions and coordination against the scenario and objectives in this manual.",
    scope: plan.scope,
    objectives: ex.objectives.map((o) => ({ seq: o.seq, text: o.text, capabilities: o.capabilityIds.map((id) => capName.get(id)).filter((x): x is string => Boolean(x)) })),
    capabilities: caps.map((c) => ({ framework: c.framework, key: c.key, name: c.name })),
    groundRules: plan.groundRules || DEFAULT_GROUND_RULES,
    assumptions: plan.assumptions,
    noFault: plan.noFaultStatement,
    stopWord: plan.stopWord,
    teams: ex.teams.map((t) => ({
      name: t.name,
      members: ex.participants.filter((p) => p.teamId === t.id).map((p) => ({ name: p.displayName, title: p.title })),
    })),
    scenario: brief ? plain(brief) : null,
    modules,
    contacts: ex.participants.filter((p) => p.roles.some((r) => contactRoles.includes(r))).map((p) => person(p, withContactDetails)),
  };
}

/**
 * Situation Manual data. Safe for every participant. `control` (the
 * viewer is on the control team) lists every Document TTX module; anyone
 * else sees only released modules.
 */
export async function buildSituationManual(exerciseId: string, opts: { control?: boolean } = {}): Promise<SitManData> {
  const b = await loadBase(exerciseId);
  return sitManFrom(b, await documentModules(b.ex, !opts.control), ["lead_facilitator", "controller"], false);
}

function whenOf(r: MselRow, tz: string): string {
  if (r.scheduledAt) return formatInZone(new Date(r.scheduledAt), tz);
  if (r.scheduledOffsetMin !== null) return `STARTEX + ${r.scheduledOffsetMin} min`;
  return r.deliveredAt ? formatInZone(new Date(r.deliveredAt), tz) : "Unplanned";
}

/** Controller and Evaluator handbook data. Control only. */
export async function buildHandbook(exerciseId: string): Promise<HandbookData> {
  const b = await loadBase(exerciseId);
  const { ex } = b;
  const tz = b.instance?.timezone ?? "UTC";
  const sitman = sitManFrom(b, await documentModules(ex), CONTACT_ROLES, true);
  const plan = readPlan(ex.plan);
  const msel = await buildMsel(exerciseId);

  const injectIds = msel.rows.map((r) => r.injectId).filter((x): x is string => Boolean(x));
  const tIds = msel.rows.map((r) => r.templateInjectId).filter((x): x is string => Boolean(x));
  const [delivered, templateRows] = await Promise.all([
    injectIds.length ? db.inject.findMany({ where: { id: { in: injectIds } }, select: { id: true, content: true, secret: true } }) : [],
    tIds.length ? db.templateInject.findMany({ where: { id: { in: tIds } }, select: { id: true, content: true, secret: true } }) : [],
  ]);
  const dById = new Map(delivered.map((d) => [d.id, d]));
  const tById = new Map(templateRows.map((t) => [t.id, t]));

  const injects: InjectDetail[] = msel.rows.map((r) => {
    // The template row has every path and team; a contingency inject has only itself.
    const src = (r.templateInjectId ? tById.get(r.templateInjectId) : undefined) ?? (r.injectId ? dById.get(r.injectId) : undefined);
    const content = src?.content ?? {};
    const secret = src?.secret ?? {};
    const secretActions = expectedActionLines(rec(secret).expectedActions);
    return {
      seq: r.seq,
      title: r.title,
      when: whenOf(r, tz),
      scenarioTime: r.scenarioTime ? formatInZone(new Date(r.scenarioTime), tz) : null,
      teams: r.targetTeams,
      objectives: r.objectives.map((o) => `${o.seq}. ${o.text}`),
      narratives: narrativesOf(content),
      questions: allQuestionsOf(content),
      intended: ex.mode === "crisissim" ? intendedOptions(content, secret) : [],
      expectedActions: dedupe([...r.expectedActions, ...secretActions]),
      deliverable: deliverableOf(content),
      controllerNotes: r.controllerNotes,
      techniques: r.techniques.map(techniqueLabel),
    };
  });

  const eeg = ex.objectives.map((o) => {
    const linked = msel.rows.filter((r) => r.objectives.some((x) => x.id === o.id));
    const tasks = dedupe(linked.flatMap((r) => injects.find((i) => i.seq === r.seq)?.expectedActions ?? [])).slice(0, 25);
    return {
      seq: o.seq,
      text: o.text,
      capabilities: sitman.objectives.find((x) => x.seq === o.seq)?.capabilities ?? [],
      injects: linked.map((r) => `${r.seq}. ${r.title}`),
      criticalTasks: tasks,
    };
  });

  const { kind: _kind, ...rest } = sitman;
  void _kind;
  return {
    ...rest,
    kind: "ce-handbook",
    sponsor: plan.sponsor,
    hazard: plan.hazard,
    msel: msel.rows.map((r) => ({
      seq: r.seq,
      when: whenOf(r, tz),
      scenarioTime: r.scenarioTime ? formatInZone(new Date(r.scenarioTime), tz) : null,
      title: r.title,
      teams: r.targetTeams,
      objectives: r.objectives.map((o) => String(o.seq)),
      status: r.status,
      techniques: r.techniques,
    })),
    injects,
    eeg,
    ratingLegend: RATINGS.map((r) => ({ rating: r, label: RATING_LABELS[r] })),
  };
}
