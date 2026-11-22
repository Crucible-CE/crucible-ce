// Master Scenario Events List: delivered injects plus the template injects
// still to come. Control only (the route checks). Expected actions, decision
// questions and the intended best option never reach players.
//
// Scheduled time is STARTEX plus the planned minutes of every earlier template
// inject (TemplateInject.plannedDelayMin, else an even split of the time box).
// Before STARTEX only the offset is known.

import { db } from "@/lib/db";
import { getExerciseSettings } from "@/lib/exercise/settings";
import { readPlan, templateInjectsForObjective } from "./schemas";
import { syncObjectiveInjects } from "./objectives";
import { formatInZone } from "./time";
import { cleanTechniqueIds, getTechniqueFullName } from "@/lib/exercise/content/mitre";

export interface MselDecision {
  team: string;
  question: string;
  owner: string | null;
  /** Intended best option text, once the inject closed. */
  best: string | null;
}

export interface MselRow {
  kind: "delivered" | "planned";
  injectId: string | null;
  templateInjectId: string | null;
  seq: number;
  title: string;
  status: string;
  scenarioTime: string | null;
  scenarioOffsetMin: number | null;
  deliveredAt: string | null;
  closedAt: string | null;
  closeTrigger: string | null;
  targetTeams: string[];
  objectives: Array<{ id: string; seq: number; text: string }>;
  expectedActions: string[];
  controllerNotes: string | null;
  /** Minutes after STARTEX this inject is planned for, or null when unknown. */
  scheduledOffsetMin: number | null;
  /** STARTEX plus scheduledOffsetMin, once the exercise has started. */
  scheduledAt: string | null;
  /** Decision questions and owners per team. */
  decisions: MselDecision[];
  /** MITRE ATT&CK technique IDs the inject exercises. */
  techniques: string[];
}

/** ATT&CK tags from an inject secret: Crisis Sim attackTechniques or Strategic mitreTags. Catalog IDs only. */
export function attackTagsOf(secret: unknown): string[] {
  const o = secret && typeof secret === "object" ? (secret as Record<string, unknown>) : {};
  return cleanTechniqueIds(Array.isArray(o.attackTechniques) ? o.attackTechniques : o.mitreTags);
}

/** "T1486 Data Encrypted for Impact". */
export function techniqueLabel(id: string): string {
  const name = getTechniqueFullName(id);
  return name ? `${id} ${name}` : id;
}

/** Template expectedActions are free-form JSON; reduce to lines of text. */
export function expectedActionLines(raw: unknown): string[] {
  const out: string[] = [];
  const visit = (v: unknown, depth: number) => {
    if (depth > 4 || out.length >= 30) return;
    if (typeof v === "string") {
      if (v.trim()) out.push(v.trim());
    } else if (Array.isArray(v)) {
      for (const x of v) visit(x, depth + 1);
    } else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      // {team, actions: string[]} (Crisis Sim and Strategic expected actions)
      if (Array.isArray(o.actions)) {
        const team = typeof o.team === "string" && o.team ? `${o.team}: ` : "";
        for (const a of o.actions) if (typeof a === "string" && a.trim()) out.push(`${team}${a.trim()}`);
        return;
      }
      const text = o.text ?? o.action ?? o.description ?? o.title;
      if (typeof text === "string") {
        const team = typeof o.team === "string" && o.team ? `${o.team}: ` : "";
        if (text.trim()) out.push(`${team}${text.trim()}`);
      } else {
        for (const [k, x] of Object.entries(o)) {
          if (Array.isArray(x)) for (const line of x) if (typeof line === "string" && line.trim()) out.push(`${k}: ${line.trim()}`);
        }
      }
    }
  };
  visit(raw, 0);
  return out;
}

interface QuestionLike {
  team: string;
  question: string;
  owner: string | null;
  options: Array<{ id: string; text: string }>;
}

function isOption(x: unknown): x is { id: string; text: string } {
  return Boolean(x) && typeof (x as { id?: unknown }).id === "string" && typeof (x as { text?: unknown }).text === "string";
}

/** Decision questions from inject content, when it has any. Tolerant of any mode's shape. */
export function questionsOf(content: unknown): QuestionLike[] {
  const list = (content as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(list)) return [];
  const out: QuestionLike[] = [];
  for (const q of list.slice(0, 20)) {
    if (!q || typeof q !== "object") continue;
    const o = q as Record<string, unknown>;
    const question = typeof o.stem === "string" ? o.stem : typeof o.text === "string" ? o.text : null;
    if (!question) continue;
    out.push({
      team: typeof o.team === "string" && o.team ? o.team : "All teams",
      question,
      owner: typeof o.decisionOwner === "string" && o.decisionOwner ? o.decisionOwner : null,
      options: Array.isArray(o.options) ? o.options.filter(isOption).map((x) => ({ id: x.id, text: x.text })) : [],
    });
  }
  return out;
}

function decisionsOf(content: unknown, best: Record<string, unknown> | null): MselDecision[] {
  return questionsOf(content).map((q) => {
    const id = best && typeof best[q.team] === "string" ? (best[q.team] as string) : null;
    return { team: q.team, question: q.question, owner: q.owner, best: id ? (q.options.find((o) => o.id === id)?.text ?? null) : null };
  });
}

/** Minutes after STARTEX for each template inject, by id. Null after any unknown delay. */
export function scheduleOffsets(
  tInjects: Array<{ id: string; plannedDelayMin: number | null }>,
  timeboxMin: number | null,
): Map<string, number | null> {
  const even = timeboxMin && tInjects.length ? Math.floor(timeboxMin / tInjects.length) : null;
  const out = new Map<string, number | null>();
  let at: number | null = 0;
  for (const t of tInjects) {
    out.set(t.id, at);
    const delay = t.plannedDelayMin ?? even;
    at = at === null || delay === null ? null : at + delay;
  }
  return out;
}

export async function buildMsel(exerciseId: string): Promise<{ rows: MselRow[]; timezone: string; scenarioStartAt: string | null; startedAt: string | null }> {
  await syncObjectiveInjects(exerciseId);
  const ex = await db.exercise.findUnique({
    where: { id: exerciseId },
    select: {
      plan: true,
      templateId: true,
      scenarioStartAt: true,
      startedAt: true,
      timeboxMin: true,
      teams: { select: { id: true, name: true } },
      objectives: { orderBy: { seq: "asc" }, select: { id: true, seq: true, text: true, injectIds: true } },
      injects: {
        where: { status: { in: ["held", "open", "closed"] } },
        orderBy: { seq: "asc" },
        select: {
          id: true,
          seq: true,
          title: true,
          status: true,
          scenarioTime: true,
          openedAt: true,
          closedAt: true,
          closeTrigger: true,
          targetTeamIds: true,
          templateInjectId: true,
          controllerNotes: true,
          content: true,
          secret: true,
        },
      },
    },
  });
  if (!ex) return { rows: [], timezone: "UTC", scenarioStartAt: null, startedAt: null };
  const instance = await getExerciseSettings();
  const plan = readPlan(ex.plan);
  const teamName = new Map(ex.teams.map((t) => [t.id, t.name]));
  const tInjects = ex.templateId
    ? await db.templateInject.findMany({
        where: { templateId: ex.templateId },
        orderBy: { seq: "asc" },
        select: {
          id: true,
          seq: true,
          title: true,
          scenarioOffsetMin: true,
          plannedDelayMin: true,
          targetTeams: true,
          expectedActions: true,
          objectiveKeys: true,
          content: true,
          secret: true,
        },
      })
    : [];
  const tById = new Map(tInjects.map((t) => [t.id, t]));
  const linksByObjective = new Map(ex.objectives.map((o) => [o.id, new Set(templateInjectsForObjective(plan, o.id, tInjects))]));
  const objectivesForTemplateInject = (templateInjectId: string) =>
    ex.objectives.filter((o) => linksByObjective.get(o.id)?.has(templateInjectId)).map(({ id, seq, text }) => ({ id, seq, text }));
  const offsets = scheduleOffsets(tInjects, ex.timeboxMin);
  const scheduled = (templateInjectId: string | null) => {
    const offset = templateInjectId ? (offsets.get(templateInjectId) ?? null) : null;
    return {
      scheduledOffsetMin: offset,
      scheduledAt: offset !== null && ex.startedAt ? new Date(ex.startedAt.getTime() + offset * 60_000).toISOString() : null,
    };
  };
  const closeEvents = await db.exerciseEvent.findMany({
    where: { exerciseId, type: "inject_closed" },
    select: { injectId: true, data: true },
  });
  const bestByInject = new Map<string, Record<string, unknown>>();
  for (const e of closeEvents) {
    const best = ((e.data ?? {}) as { summary?: { best?: unknown } }).summary?.best;
    if (e.injectId && best && typeof best === "object") bestByInject.set(e.injectId, best as Record<string, unknown>);
  }

  const rows: MselRow[] = ex.injects.map((i) => {
    const t = i.templateInjectId ? tById.get(i.templateInjectId) : undefined;
    const linked = ex.objectives.filter((o) => o.injectIds.includes(i.id)).map(({ id, seq, text }) => ({ id, seq, text }));
    const fromTemplate = t ? objectivesForTemplateInject(t.id) : [];
    const objectives = [...new Map([...linked, ...fromTemplate].map((o) => [o.id, o])).values()].sort((a, b) => a.seq - b.seq);
    return {
      kind: "delivered",
      injectId: i.id,
      templateInjectId: i.templateInjectId,
      seq: i.seq,
      title: i.title,
      status: i.status,
      scenarioTime: i.scenarioTime?.toISOString() ?? null,
      scenarioOffsetMin: t?.scenarioOffsetMin ?? null,
      deliveredAt: i.openedAt?.toISOString() ?? null,
      closedAt: i.closedAt?.toISOString() ?? null,
      closeTrigger: i.closeTrigger,
      targetTeams: i.targetTeamIds.length ? i.targetTeamIds.map((id) => teamName.get(id) ?? "Removed team") : ["All teams"],
      objectives,
      expectedActions: t ? expectedActionLines(t.expectedActions) : [],
      controllerNotes: i.controllerNotes,
      ...scheduled(i.templateInjectId),
      decisions: decisionsOf(i.content, bestByInject.get(i.id) ?? null),
      techniques: attackTagsOf(i.secret).length ? attackTagsOf(i.secret) : attackTagsOf(t?.secret),
    };
  });

  const delivered = new Set(ex.injects.map((i) => i.templateInjectId).filter(Boolean));
  let seq = ex.injects.reduce((m, i) => Math.max(m, i.seq), 0);
  for (const t of tInjects) {
    if (delivered.has(t.id)) continue;
    seq += 1;
    rows.push({
      kind: "planned",
      injectId: null,
      templateInjectId: t.id,
      seq,
      title: t.title,
      status: "planned",
      scenarioTime: ex.scenarioStartAt ? new Date(ex.scenarioStartAt.getTime() + t.scenarioOffsetMin * 60_000).toISOString() : null,
      scenarioOffsetMin: t.scenarioOffsetMin,
      deliveredAt: null,
      closedAt: null,
      closeTrigger: null,
      targetTeams: t.targetTeams.length ? t.targetTeams : ["All teams"],
      objectives: objectivesForTemplateInject(t.id),
      expectedActions: expectedActionLines(t.expectedActions),
      controllerNotes: null,
      ...scheduled(t.id),
      decisions: decisionsOf(t.content, null),
      techniques: attackTagsOf(t.secret),
    });
  }
  return {
    rows,
    timezone: instance?.timezone ?? "UTC",
    scenarioStartAt: ex.scenarioStartAt?.toISOString() ?? null,
    startedAt: ex.startedAt?.toISOString() ?? null,
  };
}

/** One CSV cell. Quotes always; neutralizes spreadsheet formulas. */
export function csvCell(value: string): string {
  const v = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${v.replace(/"/g, '""')}"`;
}

export const CLOSE_TRIGGER_LABELS: Record<string, string> = {
  votes_in: "All votes in",
  all_teams: "Every team answered",
  timer: "Time ran out",
  facilitator: "Facilitator",
  endex: "ENDEX",
};

export function mselCsv(rows: MselRow[], timezone: string): string {
  const header = [
    "Seq",
    "Scheduled",
    "Scenario time",
    "Delivered",
    "Closed",
    "Close trigger",
    "Teams",
    "Title",
    "Status",
    "Objectives",
    "Expected actions",
    "Decisions",
    "Intended best option",
    "Controller notes",
    "ATT&CK techniques",
  ];
  const t = (iso: string | null) => (iso ? formatInZone(new Date(iso), timezone) : "");
  const lines = [header.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push(
      [
        String(r.seq),
        r.scheduledAt ? t(r.scheduledAt) : r.scheduledOffsetMin !== null ? `STARTEX + ${r.scheduledOffsetMin} min` : "",
        t(r.scenarioTime),
        t(r.deliveredAt),
        t(r.closedAt),
        r.closeTrigger ? (CLOSE_TRIGGER_LABELS[r.closeTrigger] ?? r.closeTrigger) : "",
        r.targetTeams.join("; "),
        r.title,
        r.status,
        r.objectives.map((o) => `${o.seq}. ${o.text}`).join("; "),
        r.expectedActions.join("; "),
        r.decisions.map((d) => `${d.team}${d.owner ? ` (${d.owner})` : ""}. ${d.question}`).join("; "),
        r.decisions.filter((d) => d.best).map((d) => `${d.team}. ${d.best}`).join("; "),
        r.controllerNotes ?? "",
        r.techniques.map(techniqueLabel).join("; "),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}
