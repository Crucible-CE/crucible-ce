// Lobby: the setup record a driver edits before start, and the edits.
// Everything here is refused once the exercise is live (config is immutable
// after start).

import type { Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { findMode, MODE_LABELS } from "@/lib/exercise/modes/registry";
import { getExerciseSettings } from "@/lib/exercise/settings";
import { REGULATORY_CLOCK_PRESETS } from "@/lib/exercise/content/regulatory-clocks";
import { getControl, listCadenceControls } from "@/lib/exercise/content/frameworks";
import { bumpVersion } from "@/lib/exercise/runtime/transition";
import type { Mode } from "@/lib/exercise/runtime/types";
import { ServiceError } from "./errors";
import { freshJoinCode } from "./create";
import { ensureCapabilities } from "./seed-capabilities";
import { readPlan, templateInjectsForObjective, type PlanFields, type UpdateExerciseInput } from "./schemas";
import { emailConfigured } from "@/lib/exercise/email";
import { inviteStart, joinLink, publicBaseUrl } from "./invite";

/** Failed joins against one code before it stops working until rotated. */
export const JOIN_CODE_MAX_FAILURES = 20;

const EDITABLE = ["draft", "lobby"];

export interface LobbySetup {
  exercise: {
    id: string;
    mode: Mode;
    modeLabel: string;
    title: string;
    status: string;
    advancePolicy: string;
    timeboxMin: number | null;
    injectBudget: number | null;
    scenarioStartAt: string | null;
    guestJoin: boolean;
    joinCode: string | null;
    /** PUBLIC_URL + /join/CODE. Null without a code or PUBLIC_URL. */
    joinUrl: string | null;
    joinCodeLocked: boolean;
    isPractice: boolean;
    templateId: string | null;
    templateTitle: string | null;
    templateInjectCount: number;
    config: unknown;
  };
  plan: PlanFields;
  /** Suggested plan values the editor offers when the plan has none. */
  planSuggestions: {
    requirements: Array<{ framework: string; controlId: string }>;
    plansExercised: Array<{ title: string; version: string; date: string; owner: string; sha256: string | null }>;
  };
  caps: { teams: boolean; advance: string[] };
  teams: Array<{ id: string; name: string; seq: number }>;
  participants: Array<{
    id: string;
    userId: string | null;
    displayName: string;
    email: string | null;
    title: string | null;
    teamId: string | null;
    roles: string[];
    isDecisionMaker: boolean;
    isGuest: boolean;
  }>;
  objectives: Array<{ id: string; seq: number; text: string; capabilityIds: string[]; templateInjectIds: string[] }>;
  /** Planned template injects, for linking objectives. */
  templateInjects: Array<{ id: string; seq: number; title: string }>;
  clocks: Array<{ id: string; key: string; label: string; durationHours: number | null; businessDays: number | null; status: string }>;
  capabilities: Array<{ id: string; key: string; name: string; framework: string }>;
  clockPresets: Array<{ key: string; label: string; durationHours: number | null; businessDays: number | null; note: string }>;
  timezone: string;
  invite: {
    /** SMTP is configured, so the server can send invites. */
    emailEnabled: boolean;
    /** The start an invite names (plan.startsAt, else a future scenario start). */
    startAt: string | null;
  };
}

/** The setup record for the lobby editor and the control room. Control only (the route checks). */
export async function loadSetup(exerciseId: string, opts: { includeJoinCode: boolean }): Promise<LobbySetup> {
  await ensureCapabilities();
  const ex = await db.exercise.findUnique({
    where: { id: exerciseId },
    include: {
      teams: { orderBy: { seq: "asc" } },
      participants: { where: { removedAt: null }, orderBy: { createdAt: "asc" }, include: { user: { select: { email: true } } } },
      objectives: { orderBy: { seq: "asc" } },
      clocks: { orderBy: { key: "asc" } },
      template: { select: { title: true, _count: { select: { injects: true } } } },
      sourceDocument: { select: { title: true, sha256: true, createdAt: true } },
    },
  });
  if (!ex) throw new ServiceError(404, "Exercise not found.");
  const mode = findMode(ex.mode);
  const instance = await getExerciseSettings();
  const framework = instance?.capabilityFramework ?? "nist-csf";
  const usedCapIds = new Set(ex.objectives.flatMap((o) => o.capabilityIds));
  const capabilities = await db.capability.findMany({
    where: { OR: [{ framework, isActive: true }, { id: { in: [...usedCapIds] } }] },
    orderBy: [{ framework: "asc" }, { seq: "asc" }],
    select: { id: true, key: true, name: true, framework: true },
  });
  const plan = readPlan(ex.plan);
  const base = publicBaseUrl();
  const joinCode = opts.includeJoinCode ? ex.joinCode : null;
  const templateInjects = ex.templateId
    ? await db.templateInject.findMany({
        where: { templateId: ex.templateId },
        orderBy: { seq: "asc" },
        select: { id: true, seq: true, title: true, objectiveKeys: true },
      })
    : [];

  return {
    exercise: {
      id: ex.id,
      mode: ex.mode as Mode,
      modeLabel: MODE_LABELS[ex.mode as Mode] ?? ex.mode,
      title: ex.title,
      status: ex.status,
      advancePolicy: ex.advancePolicy,
      timeboxMin: ex.timeboxMin,
      injectBudget: ex.injectBudget,
      scenarioStartAt: ex.scenarioStartAt?.toISOString() ?? null,
      guestJoin: ex.guestJoin,
      joinCode,
      joinUrl: joinCode && base ? joinLink(base, joinCode) : null,
      joinCodeLocked: ex.joinCodeFailures >= JOIN_CODE_MAX_FAILURES,
      isPractice: ex.isPractice,
      templateId: ex.templateId,
      templateTitle: ex.template?.title ?? null,
      templateInjectCount: ex.template?._count.injects ?? 0,
      config: ex.config,
    },
    plan: {
      sponsor: plan.sponsor,
      scope: plan.scope,
      hazard: plan.hazard,
      groundRules: plan.groundRules,
      assumptions: plan.assumptions,
      stopWord: plan.stopWord,
      noFaultStatement: plan.noFaultStatement,
      guestTeamChoice: plan.guestTeamChoice,
      startsAt: plan.startsAt,
      missionAreas: plan.missionAreas,
      requirements: plan.requirements,
      plansExercised: plan.plansExercised,
      sponsorUserId: plan.sponsorUserId,
    },
    planSuggestions: await planSuggestions(ex.id, ex.sourceDocument),
    caps: { teams: mode?.caps.teams ?? true, advance: mode?.caps.advance ?? ["facilitator"] },
    teams: ex.teams.map((t) => ({ id: t.id, name: t.name, seq: t.seq })),
    participants: ex.participants.map((p) => ({
      id: p.id,
      userId: p.userId,
      displayName: p.displayName,
      email: p.user?.email ?? null,
      title: p.title,
      teamId: p.teamId,
      roles: p.roles,
      isDecisionMaker: p.isDecisionMaker,
      isGuest: p.isGuest,
    })),
    objectives: ex.objectives.map((o) => ({
      id: o.id,
      seq: o.seq,
      text: o.text,
      capabilityIds: o.capabilityIds,
      templateInjectIds: templateInjectsForObjective(plan, o.id, templateInjects),
    })),
    templateInjects: templateInjects.map((t) => ({ id: t.id, seq: t.seq, title: t.title })),
    clocks: ex.clocks.map((c) => ({
      id: c.id,
      key: c.key,
      label: c.label,
      durationHours: c.durationHours,
      businessDays: c.businessDays,
      status: c.status,
    })),
    capabilities,
    clockPresets: REGULATORY_CLOCK_PRESETS.map((p) => ({
      key: p.key,
      label: p.label,
      durationHours: p.durationHours ? Math.round(p.durationHours) : null,
      businessDays: p.businessDays ?? null,
      note: p.note,
    })),
    timezone: instance?.timezone ?? "UTC",
    invite: {
      emailEnabled: emailConfigured(),
      startAt: inviteStart(plan.startsAt, ex.scenarioStartAt)?.toISOString() ?? null,
    },
  };
}

function assertDistinct(names: string[], message: string) {
  const seen = new Set<string>();
  for (const n of names) {
    const k = n.trim().toLowerCase();
    if (seen.has(k)) throw new ServiceError(400, message);
    seen.add(k);
  }
}

async function syncTeams(tx: Tx, exerciseId: string, input: NonNullable<UpdateExerciseInput["teams"]>) {
  assertDistinct(input.map((t) => t.name), "Give every team a different name.");
  const existing = await tx.team.findMany({ where: { exerciseId }, select: { id: true } });
  const ids = new Set(existing.map((t) => t.id));
  for (const t of input) if (t.id && !ids.has(t.id)) throw new ServiceError(400, "A team in the list does not belong to this exercise.");
  const keep = new Set(input.map((t) => t.id).filter(Boolean) as string[]);
  const removed = existing.filter((t) => !keep.has(t.id)).map((t) => t.id);
  if (removed.length) await tx.team.deleteMany({ where: { id: { in: removed }, exerciseId } });
  // Two passes so a swap of names cannot hit the unique (exerciseId, name) index.
  for (const t of input) if (t.id) await tx.team.update({ where: { id: t.id }, data: { name: `__rename_${t.id}` } });
  for (const [i, t] of input.entries()) {
    if (t.id) await tx.team.update({ where: { id: t.id }, data: { name: t.name, seq: i + 1 } });
    else await tx.team.create({ data: { exerciseId, name: t.name, seq: i + 1 } });
  }
}

async function syncObjectives(
  tx: Tx,
  exerciseId: string,
  input: NonNullable<UpdateExerciseInput["objectives"]>,
  objectiveKeys: Record<string, string>,
): Promise<{ keys: Record<string, string>; ids: string[] }> {
  const existing = await tx.objective.findMany({ where: { exerciseId }, select: { id: true } });
  const known = new Set(existing.map((o) => o.id));
  for (const o of input) if (o.id && !known.has(o.id)) throw new ServiceError(400, "An objective in the list does not belong to this exercise.");
  const capIds = [...new Set(input.flatMap((o) => o.capabilityIds))];
  if (capIds.length) {
    const found = await tx.capability.count({ where: { id: { in: capIds } } });
    if (found !== capIds.length) throw new ServiceError(400, "A capability in the list does not exist.");
  }
  const keep = new Set(input.map((o) => o.id).filter(Boolean) as string[]);
  const removed = existing.filter((o) => !keep.has(o.id)).map((o) => o.id);
  if (removed.length) await tx.objective.deleteMany({ where: { id: { in: removed }, exerciseId } });
  const ids: string[] = [];
  for (const [i, o] of input.entries()) {
    const data = { seq: i + 1, text: o.text, capabilityIds: [...new Set(o.capabilityIds)] };
    if (o.id) {
      await tx.objective.update({ where: { id: o.id }, data });
      ids.push(o.id);
    } else {
      const row = await tx.objective.create({ data: { ...data, exerciseId, injectIds: [] }, select: { id: true } });
      ids.push(row.id);
    }
  }
  const keys: Record<string, string> = {};
  for (const [k, v] of Object.entries(objectiveKeys)) if (keep.has(k)) keys[k] = v;
  return { keys, ids };
}

/** Lobby links from objectives to template injects, checked against the template. */
async function syncObjectiveLinks(
  tx: Tx,
  templateId: string | null,
  input: NonNullable<UpdateExerciseInput["objectives"]>,
  ids: string[],
  current: Record<string, string[]>,
): Promise<Record<string, string[]>> {
  const keep = new Set(ids);
  const next: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(current)) if (keep.has(k)) next[k] = v;
  const wanted = [...new Set(input.flatMap((o) => o.templateInjectIds ?? []))];
  if (wanted.length) {
    if (!templateId) throw new ServiceError(400, "This exercise has no template injects to link.");
    const found = await tx.templateInject.count({ where: { templateId, id: { in: wanted } } });
    if (found !== wanted.length) throw new ServiceError(400, "A linked inject is not part of this template.");
  }
  input.forEach((o, i) => {
    if (o.templateInjectIds !== undefined) next[ids[i]!] = [...new Set(o.templateInjectIds)];
  });
  return next;
}

async function syncClocks(tx: Tx, exerciseId: string, input: NonNullable<UpdateExerciseInput["clocks"]>) {
  assertDistinct(input.map((c) => c.key), "Each regulatory clock can be added once.");
  const existing = await tx.regulatoryClock.findMany({ where: { exerciseId }, select: { id: true } });
  const ids = new Set(existing.map((c) => c.id));
  const keep = new Set(input.map((c) => c.id).filter((x): x is string => Boolean(x) && ids.has(x as string)));
  const removed = existing.filter((c) => !keep.has(c.id)).map((c) => c.id);
  if (removed.length) await tx.regulatoryClock.deleteMany({ where: { id: { in: removed }, exerciseId } });
  for (const c of input) {
    const data = { key: c.key, label: c.label, durationHours: c.durationHours ?? null, businessDays: c.businessDays ?? null };
    if (c.id && keep.has(c.id)) await tx.regulatoryClock.update({ where: { id: c.id }, data });
    else await tx.regulatoryClock.create({ data: { ...data, exerciseId } });
  }
}

/** Requirements must name a known control; the sponsor account must exist. Dedupes requirements in place. */
async function checkPlanFields(plan: NonNullable<UpdateExerciseInput["plan"]>): Promise<void> {
  if (plan.requirements) {
    const seen = new Set<string>();
    const out: typeof plan.requirements = [];
    for (const r of plan.requirements) {
      const c = getControl(r.framework, r.controlId);
      if (!c) throw new ServiceError(400, `${r.framework} ${r.controlId} is not a known control.`);
      const key = `${c.framework}:${c.controlId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ framework: c.framework, controlId: c.controlId });
    }
    plan.requirements = out;
  }
  if (plan.sponsorUserId) {
    const u = await db.user.findFirst({ where: { id: plan.sponsorUserId, isActive: true }, select: { id: true } });
    if (!u) throw new ServiceError(400, "The sponsor account was not found.");
  }
}

/**
 * Plan field suggestions: requirements from the schedule entry this exercise
 * was launched from (its frameworks' cadence controls), and the source
 * document as a plan exercised (Document TTX).
 */
async function planSuggestions(
  exerciseId: string,
  sourceDocument: { title: string; sha256: string; createdAt: Date } | null,
): Promise<LobbySetup["planSuggestions"]> {
  const launched = await db.adminAuditLog.findFirst({
    where: { action: "exercise.created", targetType: "Exercise", targetId: exerciseId },
    orderBy: { createdAt: "asc" },
    select: { metadataJson: true },
  });
  const scheduleId = (launched?.metadataJson as { scheduleId?: unknown } | null)?.scheduleId;
  const requirements: Array<{ framework: string; controlId: string }> = [];
  if (typeof scheduleId === "string") {
    const s = await db.exerciseSchedule.findUnique({ where: { id: scheduleId }, select: { frameworkKeys: true } });
    for (const fw of s?.frameworkKeys ?? []) for (const c of listCadenceControls(fw)) requirements.push({ framework: c.framework, controlId: c.controlId });
  }
  return {
    requirements,
    plansExercised: sourceDocument
      ? [{ title: sourceDocument.title, version: "", date: sourceDocument.createdAt.toISOString().slice(0, 10), owner: "", sha256: sourceDocument.sha256 }]
      : [],
  };
}

/** Apply lobby edits. Returns the new stateVersion. */
export async function updateExercise(exerciseId: string, input: UpdateExerciseInput): Promise<number> {
  const ex = await db.exercise.findUnique({
    where: { id: exerciseId },
    select: { status: true, mode: true, config: true, plan: true, joinCode: true, templateId: true },
  });
  if (!ex) throw new ServiceError(404, "Exercise not found.");
  if (!EDITABLE.includes(ex.status)) throw new ServiceError(409, "The exercise has started. Setup can no longer change.");
  const mode = findMode(ex.mode);
  if (!mode) throw new ServiceError(400, "This exercise type is not available yet.");
  if (input.advancePolicy && !mode.caps.advance.includes(input.advancePolicy)) {
    throw new ServiceError(400, "That advance policy is not used by this exercise type.");
  }
  if (input.teams && !mode.caps.teams && input.teams.length > 0) {
    throw new ServiceError(400, "This exercise type does not use teams.");
  }
  if (input.plan) await checkPlanFields(input.plan);

  const data: Prisma.ExerciseUpdateInput = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.timeboxMin !== undefined) data.timeboxMin = input.timeboxMin;
  if (input.injectBudget !== undefined) data.injectBudget = input.injectBudget;
  if (input.scenarioStartAt !== undefined) data.scenarioStartAt = input.scenarioStartAt ? new Date(input.scenarioStartAt) : null;
  if (input.advancePolicy !== undefined) data.advancePolicy = input.advancePolicy;
  if (input.isPractice !== undefined) data.isPractice = input.isPractice;
  if (input.guestJoin !== undefined) {
    data.guestJoin = input.guestJoin;
    if (input.guestJoin && !ex.joinCode) data.joinCode = await freshJoinCode();
  }
  if (input.config !== undefined) {
    const base = ex.config && typeof ex.config === "object" ? (ex.config as Record<string, unknown>) : {};
    const parsed = mode.configSchema.safeParse({ ...base, ...input.config });
    if (!parsed.success) throw new ServiceError(400, "Those settings are not valid for this exercise type.");
    data.config = parsed.data as Prisma.InputJsonValue;
  }

  const version = await db.$transaction(async (tx) => {
    // Re-check inside the transaction: a concurrent start wins.
    const locked = await tx.exercise.updateMany({ where: { id: exerciseId, status: { in: EDITABLE } }, data: { updatedAt: new Date() } });
    if (locked.count !== 1) throw new ServiceError(409, "The exercise has started. Setup can no longer change.");

    let plan = readPlan(ex.plan);
    if (input.teams) await syncTeams(tx, exerciseId, input.teams);
    if (input.objectives) {
      const synced = await syncObjectives(tx, exerciseId, input.objectives, plan.objectiveKeys);
      const links = await syncObjectiveLinks(tx, ex.templateId, input.objectives, synced.ids, plan.objectiveTemplateInjects);
      plan = { ...plan, objectiveKeys: synced.keys, objectiveTemplateInjects: links };
    }
    if (input.clocks) await syncClocks(tx, exerciseId, input.clocks);
    if (input.plan) plan = { ...plan, ...input.plan };
    if (input.plan || input.objectives) data.plan = plan as Prisma.InputJsonValue;

    await tx.exercise.update({ where: { id: exerciseId }, data });
    return bumpVersion(tx, exerciseId);
  });
  return version;
}

/** New join code; resets the failure counter. */
export async function rotateJoinCode(exerciseId: string): Promise<string> {
  const ex = await db.exercise.findUnique({ where: { id: exerciseId }, select: { status: true } });
  if (!ex) throw new ServiceError(404, "Exercise not found.");
  if (ex.status === "ended" || ex.status === "abandoned") throw new ServiceError(409, "The exercise is over.");
  const code = await freshJoinCode();
  await db.$transaction(async (tx) => {
    await tx.exercise.update({ where: { id: exerciseId }, data: { joinCode: code, joinCodeFailures: 0 } });
    await bumpVersion(tx, exerciseId);
  });
  return code;
}
