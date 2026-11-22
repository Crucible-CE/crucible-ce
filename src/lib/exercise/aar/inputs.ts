// Everything the after-action report is built from, read once into a plain
// object. Rows keep their ids so findings can cite evidence (sourceId).
//
//   const inputs = await gatherAarInputs(exerciseId);

import { db, type DbClient } from "@/lib/db";
import { getExerciseSettings } from "@/lib/exercise/settings";
import { MODE_LABELS } from "@/lib/exercise/modes/registry";
import { readPlan } from "@/lib/exercise/schemas";
import { getControl } from "@/lib/exercise/content/frameworks";
import { getTechniqueFullName } from "@/lib/exercise/content/mitre";
import { attackTagsOf } from "@/lib/exercise/msel";
import type { Evidence } from "./schema";
import { ROLE_LABELS, roleLabelFor } from "./names";

export type EvidenceKind = Evidence["kind"];

export interface AarCapability {
  id: string;
  key: string;
  name: string;
  framework: string;
}

export interface AarObjective {
  id: string;
  seq: number;
  text: string;
  capabilities: AarCapability[];
  injectIds: string[];
}

export interface AarInject {
  id: string;
  seq: number;
  title: string;
  scenarioTime: string | null;
  openedAt: string | null;
  closedAt: string | null;
  closeTrigger: string | null;
  /** Short public summary of what the inject presented. */
  summary: string;
  expectedActions: string[];
  objectiveIds: string[];
  docSectionRefs: string[];
}

export interface AarDecision {
  /** ExerciseEvent id (Crisis Sim) or Response id (answers, entries). */
  sourceId: string;
  sourceKind: EvidenceKind;
  injectId: string;
  seq: number;
  scenarioTime: string | null;
  team: string | null;
  owner: string | null;
  question: string | null;
  decision: string | null;
  split: Record<string, number>;
  kind: "decision" | "materiality" | "answer" | "entry";
  /** Latest evaluator grade. */
  rating: string | null;
  ratingSource: "human" | null;
  ratingRationale: string | null;
  at: string;
  /** Free text written by participants (answers, entries). */
  participantText: boolean;
}

export interface AarResponseItem {
  sourceId: string;
  sourceKind: EvidenceKind;
  kind: string;
  injectId: string;
  team: string | null;
  role: string | null;
  text: string;
  rating: string | null;
  ratingSource: "human" | null;
  /** Evaluator score, 0 to 4, and rationale of the latest grade. */
  ratingScore?: number | null;
  ratingRationale?: string | null;
  at: string;
}

export interface AarObservation {
  id: string;
  kind: string;
  text: string;
  injectId: string | null;
  objectiveId: string | null;
  capabilityKey: string | null;
  authorRole: string | null;
  at: string;
}

export interface AarRating {
  id: string;
  objectiveId: string;
  capabilityKey: string | null;
  /** P/S/M/U, or N for "Not evaluated" (evaluator only, rationale is the reason). */
  rating: "P" | "S" | "M" | "U" | "N";
  source: "evaluator";
  rationale: string | null;
  createdAt: string;
}

export interface AarHotwashItem {
  id: string;
  kind: string;
  objectiveId: string | null;
  text: string;
}

export interface AarFeedback {
  count: number;
  /** Participants asked for feedback (joined or confirmed present, not removed). */
  eligible: number;
  averages: Record<string, number>;
  comments: Array<{ id: string; text: string }>;
  /** Participant-written. */
  strengths: Array<{ id: string; text: string }>;
  improvements: Array<{ id: string; text: string }>;
}

export interface AarClock {
  id: string;
  key: string;
  label: string;
  status: "pending" | "running" | "met" | "missed" | "not_applicable";
  triggeredAt: string | null;
  deadlineAt: string | null;
  metAt: string | null;
}

export interface AarRosterEntry {
  participantId: string;
  name: string;
  aliases: string[];
  title: string | null;
  organization: string | null;
  team: string | null;
  roles: string[];
  guest: boolean;
  joinedAt: string | null;
  leftAt: string | null;
  removed: boolean;
  /** Facilitator-confirmed attendance, or null when not confirmed. */
  attendance: "attended" | "partial" | "absent" | null;
  noDevice: boolean;
}

export interface AarInputs {
  exercise: {
    id: string;
    title: string;
    mode: string;
    modeLabel: string;
    status: string;
    isPractice: boolean;
    sponsor: string;
    scope: string;
    hazard: string;
    /** Plan assumptions and artificialities. Artificialities are never areas for improvement. */
    assumptions: string;
    missionAreas: string[];
    plansExercised: Array<{ title: string; version: string; date: string; owner: string; sha256: string | null }>;
    /** Requirements the plan names, resolved to known controls. */
    requirements: Array<{ framework: string; controlId: string; title: string }>;
    scenarioSummary: string;
    startedAt: string | null;
    endedAt: string | null;
    durationMin: number | null;
    timezone: string;
    scenarioStartAt: string | null;
    endReason: string | null;
  };
  objectives: AarObjective[];
  injects: AarInject[];
  decisions: AarDecision[];
  responses: AarResponseItem[];
  observations: AarObservation[];
  ratings: AarRating[];
  hotwash: AarHotwashItem[];
  feedback: AarFeedback;
  clocks: AarClock[];
  roster: AarRosterEntry[];
  requiredRoles: Array<{ role: string; present: boolean }>;
  sourceDocument: { id: string; title: string; kind: string; sha256: string; sections: Array<{ id: string; heading: string }> } | null;
  frameworks: string[];
  /** Controls exercised: plan requirements, plus rubric control refs of delivered questions (enabled frameworks). */
  testedControls: Array<{ framework: string; controlId: string; title: string }>;
  /** MITRE ATT&CK techniques tagged on delivered injects, in delivery order. */
  techniquesExercised: Array<{ id: string; name: string }>;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** ATT&CK tags of delivered injects, deduplicated. An inject without its own tags uses its template inject's. */
export function techniquesExercised(injects: Array<{ secret: unknown; templateSecret?: unknown }>): AarInputs["techniquesExercised"] {
  const out: AarInputs["techniquesExercised"] = [];
  for (const i of injects) {
    const own = attackTagsOf(i.secret);
    for (const id of own.length ? own : attackTagsOf(i.templateSecret)) {
      if (!out.some((t) => t.id === id)) out.push({ id, name: getTechniqueFullName(id) ?? id });
    }
  }
  return out.slice(0, 100);
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Expected actions in any of the stored shapes: string[], [{team, actions}], {team: string[]}. */
export function flattenExpectedActions(v: unknown): string[] {
  const out: string[] = [];
  if (Array.isArray(v)) {
    for (const item of v) {
      if (typeof item === "string") out.push(item);
      else {
        const r = rec(item);
        const team = str(r.team);
        for (const a of Array.isArray(r.actions) ? r.actions : []) if (typeof a === "string") out.push(team ? `${team}: ${a}` : a);
      }
    }
  } else {
    for (const [team, list] of Object.entries(rec(v))) {
      for (const a of Array.isArray(list) ? list : []) if (typeof a === "string") out.push(`${team}: ${a}`);
    }
  }
  return out;
}

/** A short public summary of an inject's content, for any mode. */
export function injectSummary(content: unknown): string {
  const c = rec(content);
  const parts: string[] = [];
  const path = str(c.path) ?? "optimal";
  const variants = rec(c.variants);
  const variant = rec(variants[path] ?? Object.values(variants)[0]);
  for (const t of [c.narrativeMd, c.scenarioUpdate, variant.narrativeMd]) if (str(t)) parts.push(String(t).trim());
  const questions = Array.isArray(c.questions) ? c.questions : [];
  for (const q of questions) {
    const r = rec(q);
    const text = str(r.stem) ?? str(r.text);
    if (text) parts.push(`${str(r.team) ? `${r.team}: ` : ""}${text}`);
  }
  for (const tv of Array.isArray(c.teamVariants) ? c.teamVariants : []) {
    const r = rec(tv);
    for (const q of Array.isArray(r.questions) ? r.questions : []) {
      const text = str(rec(q).text);
      if (text) parts.push(`${str(r.team) ? `${r.team}: ` : ""}${text}`);
    }
  }
  const joined = parts.join("\n");
  return joined.length > 1500 ? `${joined.slice(0, 1497)}...` : joined;
}

/** Latest human grade per response. */
export function effectiveGradeMap<G extends { responseId: string; source: string; createdAt: Date }>(grades: G[]): Map<string, G> {
  const out = new Map<string, G>();
  for (const g of [...grades].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    const prev = out.get(g.responseId);
    if (!prev || g.source === "human" || prev.source !== "human") out.set(g.responseId, g);
  }
  return out;
}

/** Latest evaluator rating per objective. */
export function effectiveRatings(ratings: AarRating[]): Map<string, AarRating> {
  const out = new Map<string, AarRating>();
  for (const r of [...ratings].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const prev = out.get(r.objectiveId);
    if (!prev || r.source === "evaluator" || prev.source !== "evaluator") out.set(r.objectiveId, r);
  }
  return out;
}

/** Policy required roles: strings or {role}|{label} objects. */
export function readRequiredRoles(policy: unknown): string[] {
  const list = rec(policy).requiredRoles;
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const item of list) {
    const v = typeof item === "string" ? item : (str(rec(item).role) ?? str(rec(item).label) ?? str(rec(item).title));
    if (v && v.trim()) out.push(v.trim().slice(0, 80));
  }
  return [...new Set(out)].slice(0, 20);
}

/** Counts toward required-role presence: the facilitator confirmed attended or partial. */
export function confirmedPresent(p: Pick<AarRosterEntry, "attendance">): boolean {
  return p.attendance === "attended" || p.attendance === "partial";
}

/**
 * Simple case-insensitive match of required roles against titles and exercise
 * roles. Only people the facilitator confirmed as attended or partial count.
 */
export function matchRequiredRoles(
  required: string[],
  roster: Array<Pick<AarRosterEntry, "title" | "roles" | "removed" | "attendance">>,
): Array<{ role: string; present: boolean }> {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return required.map((role) => {
    const want = norm(role);
    const present = roster.some((p) => {
      if (p.removed || !confirmedPresent(p)) return false;
      const labels = [p.title ?? "", ...p.roles, ...p.roles.map((r) => ROLE_LABELS[r] ?? r)].map(norm).filter(Boolean);
      return labels.some((l) => l === want || l.includes(want) || (l.length >= 3 && want.includes(l) && l.split(" ").length > 1));
    });
    return { role, present };
  });
}

// ---------------------------------------------------------------------------
// Gather
// ---------------------------------------------------------------------------

function clockStatus(s: string): AarClock["status"] {
  return (["pending", "running", "met", "missed", "not_applicable"].includes(s) ? s : "pending") as AarClock["status"];
}

export async function gatherAarInputs(exerciseId: string, client: DbClient = db): Promise<AarInputs> {
  const ex = await client.exercise.findUniqueOrThrow({
    where: { id: exerciseId },
    include: {
      template: { select: { summary: true, config: true } },
      sourceDocument: { select: { id: true, title: true, kind: true, sha256: true, sections: true, createdAt: true } },
      teams: true,
      participants: { include: { user: { select: { name: true } } } },
      objectives: { orderBy: { seq: "asc" } },
      injects: { where: { status: { in: ["open", "closed"] } }, orderBy: { seq: "asc" } },
      clocks: { orderBy: { key: "asc" } },
    },
  });
  const [instance, capabilities, responses, grades, events, observations, ratings, hotwash, feedback] = await Promise.all([
    getExerciseSettings(client),
    client.capability.findMany({ select: { id: true, key: true, name: true, framework: true } }),
    client.response.findMany({ where: { exerciseId }, orderBy: { createdAt: "asc" } }),
    client.grade.findMany({ where: { response: { exerciseId } }, select: { responseId: true, source: true, createdAt: true, rating: true, rationale: true, score: true } }),
    client.exerciseEvent.findMany({ where: { exerciseId }, orderBy: [{ at: "asc" }, { id: "asc" }] }),
    client.observation.findMany({ where: { exerciseId }, orderBy: { at: "asc" } }),
    client.capabilityRating.findMany({ where: { exerciseId }, orderBy: { createdAt: "asc" } }),
    client.hotwashItem.findMany({ where: { exerciseId }, orderBy: { createdAt: "asc" } }),
    client.feedback.findMany({ where: { exerciseId }, orderBy: { createdAt: "asc" } }),
  ]);
  const timezone = instance?.timezone ?? "UTC";
  const capById = new Map(capabilities.map((c) => [c.id, c]));
  const teamName = new Map(ex.teams.map((t) => [t.id, t.name]));
  const injectById = new Map(ex.injects.map((i) => [i.id, i]));
  const plan = readPlan(ex.plan);

  // Template injects: expected actions live there for Crisis Sim.
  const tIds = ex.injects.map((i) => i.templateInjectId).filter((x): x is string => Boolean(x));
  const templateInjects = tIds.length
    ? await client.templateInject.findMany({ where: { id: { in: tIds } }, select: { id: true, expectedActions: true, secret: true } })
    : [];
  const tExpected = new Map(templateInjects.map((t) => [t.id, flattenExpectedActions(t.expectedActions)]));
  const tSecret = new Map(templateInjects.map((t) => [t.id, t.secret]));

  // Roster from participant rows plus join and leave events.
  const joined = new Map<string, Date>();
  const left = new Map<string, Date>();
  for (const e of events) {
    const d = rec(e.data);
    if (e.type === "participant_joined" && e.actorParticipantId && !joined.has(e.actorParticipantId)) joined.set(e.actorParticipantId, e.at);
    if ((e.type === "participant_removed" || e.type === "participant_excused" || e.type === "participant_left") && typeof d.participantId === "string") {
      left.set(d.participantId, e.at);
    }
  }
  const roster: AarRosterEntry[] = ex.participants
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((p) => ({
      participantId: p.id,
      name: p.displayName,
      aliases: [p.user?.name, p.guestName].filter((n): n is string => Boolean(n && n !== p.displayName)),
      title: p.title,
      organization: p.organization,
      team: p.teamId ? (teamName.get(p.teamId) ?? null) : null,
      roles: p.roles,
      guest: p.isGuest,
      joinedAt: iso(p.joinedAt ?? joined.get(p.id) ?? null),
      leftAt: iso(p.leftAt ?? left.get(p.id) ?? p.removedAt ?? null),
      removed: Boolean(p.removedAt),
      attendance: p.attendance === "attended" || p.attendance === "partial" || p.attendance === "absent" ? p.attendance : null,
      noDevice: p.noDevice,
    }));
  const participantRole = new Map(roster.map((p) => [p.participantId, roleLabelFor(p)]));

  // Objectives.
  const objectives: AarObjective[] = ex.objectives.map((o) => ({
    id: o.id,
    seq: o.seq,
    text: o.text,
    capabilities: o.capabilityIds.map((id) => capById.get(id)).filter((c): c is NonNullable<typeof c> => Boolean(c)),
    injectIds: o.injectIds.filter((id) => injectById.has(id)),
  }));

  // Injects.
  const injects: AarInject[] = ex.injects.map((i) => {
    const content = rec(i.content);
    const secret = rec(i.secret);
    const expected = [...(i.templateInjectId ? (tExpected.get(i.templateInjectId) ?? []) : []), ...flattenExpectedActions(secret.expectedActions)];
    const docRefs = [
      ...(Array.isArray(content.docSectionRefs) ? content.docSectionRefs : []),
      ...(Array.isArray(content.questions) ? content.questions.flatMap((q) => (Array.isArray(rec(q).docSectionRefs) ? (rec(q).docSectionRefs as unknown[]) : [])) : []),
    ].filter((x): x is string => typeof x === "string");
    return {
      id: i.id,
      seq: i.seq,
      title: i.title,
      scenarioTime: iso(i.scenarioTime),
      openedAt: iso(i.openedAt),
      closedAt: iso(i.closedAt),
      closeTrigger: i.closeTrigger,
      summary: injectSummary(i.content),
      expectedActions: [...new Set(expected)],
      objectiveIds: objectives.filter((o) => o.injectIds.includes(i.id)).map((o) => o.id),
      docSectionRefs: [...new Set(docRefs)],
    };
  });

  // Grades.
  const effective = effectiveGradeMap(grades);
  const gradeOf = (responseId: string) => {
    const g = effective.get(responseId);
    return { rating: g?.rating ?? null, ratingSource: g?.source === "human" ? ("human" as const) : null, ratingRationale: g?.rationale ?? null };
  };
  const scoreOf = (responseId: string) => {
    const g = effective.get(responseId);
    return { ratingScore: g?.score ?? null, ratingRationale: g?.rationale ?? null };
  };

  // Decision log and response evidence.
  const decisions: AarDecision[] = [];
  const responseItems: AarResponseItem[] = [];
  if (ex.mode === "crisissim") {
    for (const e of events) {
      if (e.type !== "decision" && e.type !== "materiality_decision") continue;
      const inj = e.injectId ? injectById.get(e.injectId) : undefined;
      if (!inj) continue;
      const d = rec(e.data);
      const team = str(d.team);
      const q = (Array.isArray(rec(inj.content).questions) ? (rec(inj.content).questions as unknown[]) : []).map(rec).find((x) => x.team === team);
      const optText = new Map((Array.isArray(q?.options) ? q.options : []).map((o) => [String(rec(o).id), String(rec(o).text ?? "")]));
      const split: Record<string, number> = {};
      for (const [opt, n] of Object.entries(rec(d.recommendation ?? d.distribution))) {
        if (typeof n === "number") split[(optText.get(opt) || opt).slice(0, 300)] = n;
      }
      decisions.push({
        sourceId: e.id,
        sourceKind: "event",
        injectId: inj.id,
        seq: inj.seq,
        scenarioTime: str(d.scenarioTime) ?? iso(inj.scenarioTime),
        team,
        owner: str(d.decisionOwner),
        question: str(d.stem),
        decision: str(d.decision) ?? str(d.majorityText) ?? (d.decisionSource === "tie" ? "No decision (tied vote)" : "No decision recorded"),
        split,
        kind: e.type === "materiality_decision" || d.questionType === "materiality" ? "materiality" : "decision",
        rating: null,
        ratingSource: null,
        ratingRationale: null,
        at: e.at.toISOString(),
        participantText: false,
      });
    }
  }
  for (const r of responses) {
    const inj = injectById.get(r.injectId);
    if (!inj) continue;
    const p = rec(r.payload);
    const team = r.teamId ? (teamName.get(r.teamId) ?? null) : null;
    const role = participantRole.get(r.participantId) ?? null;
    const g = gradeOf(r.id);
    if (r.kind === "vote") {
      const comment = str(p.comment);
      if (comment) responseItems.push({ sourceId: r.id, sourceKind: "vote", kind: "vote comment", injectId: inj.id, team, role, text: comment, rating: null, ratingSource: null, at: r.createdAt.toISOString() });
      continue;
    }
    if (r.kind === "deliverable") {
      const text = str(p.text) ?? "";
      responseItems.push({ sourceId: r.id, sourceKind: "answer", kind: "deliverable", injectId: inj.id, team, role, text, rating: g.rating, ratingSource: g.ratingSource, ...scoreOf(r.id), at: r.createdAt.toISOString() });
      continue;
    }
    if (r.kind === "answer") {
      const byQ = rec(p.byQuestion);
      const text = [str(p.text) ?? "", ...Object.entries(byQ).map(([k, v]) => (typeof v === "string" && v.trim() ? `${k}: ${v}` : ""))].filter(Boolean).join("\n");
      const byPid = str(p.byParticipantId);
      const owner = byPid ? (participantRole.get(byPid) ?? role) : role;
      decisions.push({
        sourceId: r.id,
        sourceKind: "answer",
        injectId: inj.id,
        seq: inj.seq,
        scenarioTime: iso(inj.scenarioTime),
        team,
        owner,
        question: inj.title,
        decision: text,
        split: {},
        kind: "answer",
        ...g,
        at: r.createdAt.toISOString(),
        participantText: true,
      });
      responseItems.push({ sourceId: r.id, sourceKind: "answer", kind: "answer", injectId: inj.id, team, role: owner, text, rating: g.rating, ratingSource: g.ratingSource, ...scoreOf(r.id), at: r.createdAt.toISOString() });
      continue;
    }
    if (r.kind === "entry") {
      if (r.status === "denied") continue;
      const type = str(p.type) ?? "note";
      const qKey = str(p.questionKey);
      const questions = Array.isArray(rec(inj.content).questions) ? (rec(inj.content).questions as unknown[]).map(rec) : [];
      const qText = qKey ? (str(questions.find((q) => q.key === qKey)?.text) ?? null) : null;
      const owner = str(p.speakerRole) ?? role;
      const text = str(p.text) ?? "";
      decisions.push({
        sourceId: r.id,
        sourceKind: "entry",
        injectId: inj.id,
        seq: inj.seq,
        scenarioTime: iso(inj.scenarioTime),
        team,
        owner,
        question: qText,
        decision: `${type.charAt(0).toUpperCase()}${type.slice(1)}: ${text}`,
        split: {},
        kind: "entry",
        ...g,
        at: r.createdAt.toISOString(),
        participantText: true,
      });
      responseItems.push({ sourceId: r.id, sourceKind: "entry", kind: `${type} entry`, injectId: inj.id, team, role: owner, text, rating: g.rating, ratingSource: g.ratingSource, ...scoreOf(r.id), at: r.createdAt.toISOString() });
    }
  }
  // Observations.
  const obs: AarObservation[] = observations.map((o) => ({
    id: o.id,
    kind: o.kind,
    text: o.text,
    injectId: o.injectId,
    objectiveId: o.objectiveId,
    capabilityKey: o.capabilityId ? (capById.get(o.capabilityId)?.key ?? null) : null,
    authorRole: o.authorParticipantId ? (participantRole.get(o.authorParticipantId) ?? null) : null,
    at: o.at.toISOString(),
  }));

  const aarRatings: AarRating[] = ratings
    .filter((r) => r.source === "evaluator" && ["P", "S", "M", "U", "N"].includes(r.rating))
    .map((r) => ({
      id: r.id,
      objectiveId: r.objectiveId,
      capabilityKey: r.capabilityId ? (capById.get(r.capabilityId)?.key ?? null) : null,
      rating: r.rating as AarRating["rating"],
      source: "evaluator",
      rationale: r.rationale,
      createdAt: r.createdAt.toISOString(),
    }));

  // Feedback.
  const sums = new Map<string, { sum: number; n: number }>();
  for (const f of feedback) {
    for (const [k, v] of Object.entries(rec(f.ratings))) {
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      const s = sums.get(k) ?? { sum: 0, n: 0 };
      s.sum += v;
      s.n += 1;
      sums.set(k, s);
    }
  }
  const textOf = (f: (typeof feedback)[number], key: "strengths" | "improvements") => {
    const v = rec(f.ratings)[key];
    return typeof v === "string" ? v.trim().slice(0, 2000) : "";
  };
  const fb: AarFeedback = {
    count: feedback.length,
    eligible: roster.filter((p) => !p.removed && !p.noDevice && (p.joinedAt || confirmedPresent(p))).length,
    averages: Object.fromEntries([...sums].map(([k, s]) => [k, Math.round((s.sum / s.n) * 10) / 10])),
    comments: feedback.filter((f) => f.comments && f.comments.trim()).map((f) => ({ id: f.id, text: f.comments!.trim() })),
    strengths: feedback.filter((f) => textOf(f, "strengths")).map((f) => ({ id: f.id, text: textOf(f, "strengths") })),
    improvements: feedback.filter((f) => textOf(f, "improvements")).map((f) => ({ id: f.id, text: textOf(f, "improvements") })),
  };

  // Clocks. A running clock whose deadline passed before the last inject's scenario time is missed.
  const lastScenario = ex.injects.filter((i) => i.scenarioTime).at(-1)?.scenarioTime ?? null;
  const clocks: AarClock[] = ex.clocks.map((c) => {
    let status = clockStatus(c.status);
    if (status === "running" && c.deadlineAt && lastScenario && lastScenario.getTime() > c.deadlineAt.getTime()) status = "missed";
    if (status === "running" && c.metAt) status = c.deadlineAt && c.metAt.getTime() > c.deadlineAt.getTime() ? "missed" : "met";
    return { id: c.id, key: c.key, label: c.label, status, triggeredAt: iso(c.triggeredAt), deadlineAt: iso(c.deadlineAt), metAt: iso(c.metAt) };
  });

  // Source document.
  const doc = ex.sourceDocument
    ? {
        id: ex.sourceDocument.id,
        title: ex.sourceDocument.title,
        kind: ex.sourceDocument.kind,
        sha256: ex.sourceDocument.sha256,
        sections: (Array.isArray(ex.sourceDocument.sections) ? ex.sourceDocument.sections : [])
          .map(rec)
          .filter((s) => typeof s.id === "string")
          .map((s) => ({ id: String(s.id), heading: String(s.heading ?? s.id) })),
      }
    : null;

  // Frameworks and tested controls: plan requirements, then rubric control refs of delivered questions.
  const frameworks = instance?.enabledFrameworks ?? [];
  const tested = new Map<string, { framework: string; controlId: string; title: string }>();
  const requirements: AarInputs["exercise"]["requirements"] = [];
  for (const r of plan.requirements) {
    const control = getControl(r.framework, r.controlId);
    if (!control) continue;
    const key = `${control.framework}:${control.controlId}`;
    if (tested.has(key)) continue;
    const row = { framework: control.framework, controlId: control.controlId, title: control.title };
    requirements.push(row);
    tested.set(key, row);
  }
  const askedKeys = new Set<string>();
  for (const i of ex.injects) {
    for (const q of Array.isArray(rec(i.content).questions) ? (rec(i.content).questions as unknown[]) : []) {
      const k = str(rec(q).key);
      if (k) askedKeys.add(k);
    }
  }
  if (askedKeys.size > 0 && frameworks.length > 0) {
    const rubrics = await client.rubric.findMany({
      where: {
        questionKey: { in: [...askedKeys] },
        OR: [{ exerciseId }, ...(ex.templateId ? [{ templateId: ex.templateId }] : [])],
      },
      select: { criteria: true },
    });
    for (const r of rubrics) {
      for (const c of Array.isArray(r.criteria) ? r.criteria : []) {
        for (const ref of Array.isArray(rec(c).controlRefs) ? (rec(c).controlRefs as unknown[]) : []) {
          const fw = str(rec(ref).framework);
          const id = str(rec(ref).controlId);
          if (!fw || !id || !frameworks.includes(fw)) continue;
          const control = getControl(fw, id);
          if (control) tested.set(`${fw}:${control.controlId}`, { framework: fw, controlId: control.controlId, title: control.title });
        }
      }
    }
  }

  const tc = rec(ex.template?.config);
  const scenarioSummary = [ex.template?.summary, str(tc.executiveBriefMd)].filter((s): s is string => Boolean(s && s.trim())).join("\n\n");
  const durationMin =
    ex.startedAt && ex.endedAt ? Math.max(0, Math.round((ex.endedAt.getTime() - ex.startedAt.getTime() - ex.pausedMsTotal) / 60_000)) : null;

  const required = readRequiredRoles(instance?.policy);

  return {
    exercise: {
      id: ex.id,
      title: ex.title,
      mode: ex.mode,
      modeLabel: (MODE_LABELS as Record<string, string>)[ex.mode] ?? ex.mode,
      status: ex.status,
      isPractice: ex.isPractice,
      sponsor: plan.sponsor,
      scope: plan.scope,
      hazard: plan.hazard,
      assumptions: plan.assumptions,
      missionAreas: [...plan.missionAreas],
      plansExercised: plan.plansExercised.length
        ? plan.plansExercised.map((d) => ({ title: d.title, version: d.version, date: d.date, owner: d.owner, sha256: d.sha256 ?? null }))
        : ex.sourceDocument
          ? [{ title: ex.sourceDocument.title, version: "", date: ex.sourceDocument.createdAt.toISOString().slice(0, 10), owner: "", sha256: ex.sourceDocument.sha256 }]
          : [],
      requirements,
      scenarioSummary,
      startedAt: iso(ex.startedAt),
      endedAt: iso(ex.endedAt),
      durationMin,
      timezone,
      scenarioStartAt: iso(ex.scenarioStartAt),
      endReason: ex.endReason,
    },
    objectives,
    injects,
    decisions,
    responses: responseItems,
    observations: obs,
    ratings: aarRatings,
    hotwash: hotwash.map((h) => ({ id: h.id, kind: h.kind, objectiveId: h.objectiveId, text: h.text })),
    feedback: fb,
    clocks,
    roster,
    requiredRoles: matchRequiredRoles(required, roster),
    sourceDocument: doc,
    frameworks,
    testedControls: [...tested.values()],
    techniquesExercised: techniquesExercised(ex.injects.map((i) => ({ secret: i.secret, templateSecret: i.templateInjectId ? tSecret.get(i.templateInjectId) : undefined }))),
  };
}
