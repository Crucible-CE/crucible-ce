// Studio editor state: a lenient draft of the graph and the pure operations
// the editor applies to it. Drafts may be incomplete; validateStudio says
// what is missing. Safe to import on the client.

import type { BranchCondition } from "@/lib/exercise/modes/shared/branching";
import { scenarioSchema } from "@/lib/exercise/modes/strategic/schema";
import { cleanTechniqueIds } from "@/lib/exercise/content/mitre";
import { buildCondition, emptyFields, conditionType, outcomeOptions } from "./conditions";
import { outgoing, startNode } from "./graph";
import type { StudioMode } from "./schema";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = <T = unknown>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

export interface DraftArtifact {
  id: string;
  kind: string;
  title: string;
  content: string;
  from?: string;
  sentAt?: string;
}
export interface DraftVariant {
  team: string;
  status: "active" | "standby";
  narrativeMd: string;
  questions: Array<{ key: string; text: string; framework?: string }>;
}
export interface StrategicContent {
  schemaVersion: 1;
  narrativeMd: string;
  phase: "opening" | "main" | "resolution";
  artifacts: DraftArtifact[];
  teamVariants: DraftVariant[];
}
export interface StrategicSecret {
  schemaVersion: 1;
  expectedActions: Record<string, string[]>;
  gradingNotes?: string;
  mitreTags: string[];
  capabilityKeys: string[];
  clockUpdates: Array<{ key: string; action: "trigger" | "met" }>;
}
export interface DraftQuestion {
  key: string;
  text: string;
  category: string;
  capabilityKeys: string[];
  objectiveKeys: string[];
  docSectionRefs: string[];
}
export interface DocumentContent {
  schemaVersion: 1;
  scenarioUpdate: string;
  rationale?: string;
  keyIssues: string[];
  sourceExcerpt?: string;
  docSectionRefs: string[];
  questions: DraftQuestion[];
}
export interface DocumentSecret {
  schemaVersion: 1;
  expectedActions: string[];
}

export interface DraftInject {
  nodeId: string;
  seq: number;
  title: string;
  scenarioOffsetMin: number;
  plannedDelayMin: number | null;
  objectiveKeys: string[];
  content: StrategicContent | DocumentContent;
  secret: StrategicSecret | DocumentSecret;
  position: { x: number; y: number; end?: boolean };
}

export interface DraftBranch {
  fromNodeId: string;
  toNodeId: string;
  condition: BranchCondition;
  priority: number;
}

export interface DraftClock {
  key: string;
  label: string;
  durationHours?: number;
  businessDays?: number;
}

export interface DraftTemplate {
  title: string;
  summary: string | null;
  branching: "linear" | "branched";
  config: Obj & { teams: string[]; regulatoryClocks: DraftClock[] };
  objectives: Array<{ key: string; text: string; capabilityKeys: string[] }>;
}

export interface DraftGraph {
  template: DraftTemplate;
  injects: DraftInject[];
  branches: DraftBranch[];
}

// ---------------------------------------------------------------------------
// Normalizers: keep what is stored, fill the rest.
// ---------------------------------------------------------------------------

export function normalizeStrategicContent(v: unknown): StrategicContent {
  const o = obj(v);
  const phase = o.phase === "opening" || o.phase === "resolution" ? o.phase : "main";
  return {
    schemaVersion: 1,
    narrativeMd: str(o.narrativeMd),
    phase,
    artifacts: arr(o.artifacts).map((a, i) => {
      const x = obj(a);
      return {
        id: str(x.id, `a${i + 1}`),
        kind: str(x.kind, "email"),
        title: str(x.title),
        content: str(x.content),
        ...(typeof x.from === "string" ? { from: x.from } : {}),
        ...(typeof x.sentAt === "string" ? { sentAt: x.sentAt } : {}),
      };
    }),
    teamVariants: arr(o.teamVariants).map((tv) => {
      const x = obj(tv);
      return {
        team: str(x.team),
        status: x.status === "standby" ? "standby" : "active",
        narrativeMd: str(x.narrativeMd),
        questions: arr(x.questions).map((q, i) => {
          const y = obj(q);
          return { key: str(y.key, `q${i + 1}`), text: str(y.text), ...(typeof y.framework === "string" ? { framework: y.framework } : {}) };
        }),
      };
    }),
  };
}

export function normalizeStrategicSecret(v: unknown): StrategicSecret {
  const o = obj(v);
  const ea: Record<string, string[]> = {};
  for (const [k, list] of Object.entries(obj(o.expectedActions))) ea[k] = arr(list).filter((x): x is string => typeof x === "string");
  return {
    schemaVersion: 1,
    expectedActions: ea,
    ...(typeof o.gradingNotes === "string" ? { gradingNotes: o.gradingNotes } : {}),
    mitreTags: cleanTechniqueIds(o.mitreTags),
    capabilityKeys: arr(o.capabilityKeys).filter((x): x is string => typeof x === "string"),
    clockUpdates: arr(o.clockUpdates)
      .map(obj)
      .filter((c) => typeof c.key === "string" && (c.action === "trigger" || c.action === "met"))
      .map((c) => ({ key: c.key as string, action: c.action as "trigger" | "met" })),
  };
}

export function normalizeDocumentContent(v: unknown): DocumentContent {
  const o = obj(v);
  return {
    schemaVersion: 1,
    scenarioUpdate: str(o.scenarioUpdate),
    ...(typeof o.rationale === "string" ? { rationale: o.rationale } : {}),
    keyIssues: arr(o.keyIssues).filter((x): x is string => typeof x === "string"),
    ...(typeof o.sourceExcerpt === "string" ? { sourceExcerpt: o.sourceExcerpt } : {}),
    docSectionRefs: arr(o.docSectionRefs).filter((x): x is string => typeof x === "string"),
    questions: arr(o.questions).map((q, i) => {
      const y = obj(q);
      const strs = (k: string) => arr(y[k]).filter((x): x is string => typeof x === "string");
      return {
        key: str(y.key, `q${i + 1}`),
        text: str(y.text),
        category: str(y.category, "decision_making"),
        capabilityKeys: strs("capabilityKeys"),
        objectiveKeys: strs("objectiveKeys"),
        docSectionRefs: strs("docSectionRefs"),
      };
    }),
  };
}

export function normalizeDocumentSecret(v: unknown): DocumentSecret {
  const o = obj(v);
  return { schemaVersion: 1, expectedActions: arr(o.expectedActions).filter((x): x is string => typeof x === "string") };
}

export function normalizeConfig(mode: StudioMode, v: unknown): DraftTemplate["config"] {
  const o = obj(v);
  const teams = arr(o.teams).filter((x): x is string => typeof x === "string");
  const regulatoryClocks = arr(o.regulatoryClocks)
    .map(obj)
    .filter((c) => typeof c.key === "string")
    .map((c) => ({
      key: c.key as string,
      label: str(c.label, c.key as string),
      ...(typeof c.durationHours === "number" ? { durationHours: c.durationHours } : {}),
      ...(typeof c.businessDays === "number" ? { businessDays: c.businessDays } : {}),
    }));
  if (mode === "strategic") {
    const scenario = scenarioSchema.safeParse(o.scenario ?? {});
    const anchor = obj(o.scenarioAnchor);
    return {
      ...o,
      schemaVersion: 1,
      source: o.source === "hybrid" ? "hybrid" : "template",
      scenario: scenario.success ? scenario.data : scenarioSchema.parse({}),
      winCondition: o.winCondition === "dynamic" ? "dynamic" : "none",
      teams,
      scenarioAnchor: typeof anchor.weekday === "number" && typeof anchor.time === "string" ? { weekday: anchor.weekday, time: anchor.time } : null,
      targetDurationMin: num(o.targetDurationMin, 90),
      regulatoryClocks,
      executiveBriefMd: str(o.executiveBriefMd),
    };
  }
  return {
    ...o,
    schemaVersion: 1,
    teams,
    moduleMinutes: typeof o.moduleMinutes === "number" ? o.moduleMinutes : null,
    paced: o.paced === "timer" ? "timer" : "facilitator",
    regulatoryClocks,
  };
}

export function normalizeGraph(
  mode: StudioMode,
  t: { title: string; summary: string | null; branching: string; config: unknown; objectives: unknown },
  injects: unknown[],
  branches: unknown[],
): DraftGraph {
  return {
    template: {
      title: t.title,
      summary: t.summary,
      branching: t.branching === "branched" ? "branched" : "linear",
      config: normalizeConfig(mode, t.config),
      objectives: arr(t.objectives)
        .map(obj)
        .map((x) => ({ key: str(x.key), text: str(x.text), capabilityKeys: arr(x.capabilityKeys).filter((k): k is string => typeof k === "string") })),
    },
    injects: injects
      .map(obj)
      .map((i, n) => {
        const pos = obj(i.position);
        return {
          nodeId: str(i.nodeId, `n${n + 1}`),
          seq: num(i.seq, n + 1),
          title: str(i.title),
          scenarioOffsetMin: num(i.scenarioOffsetMin, 0),
          plannedDelayMin: typeof i.plannedDelayMin === "number" ? i.plannedDelayMin : null,
          objectiveKeys: arr(i.objectiveKeys).filter((k): k is string => typeof k === "string"),
          content: mode === "strategic" ? normalizeStrategicContent(i.content) : normalizeDocumentContent(i.content),
          secret: mode === "strategic" ? normalizeStrategicSecret(i.secret) : normalizeDocumentSecret(i.secret),
          position: { x: num(pos.x, 0), y: num(pos.y, n * 160), ...(pos.end === true ? { end: true } : {}) },
        };
      })
      .sort((a, b) => a.seq - b.seq),
    branches: branches.map(obj).map((b) => ({
      fromNodeId: str(b.fromNodeId),
      toNodeId: str(b.toNodeId),
      condition: (b.condition ?? { type: "default" }) as BranchCondition,
      priority: num(b.priority, 0),
    })),
  };
}

/** The graph as the PUT body expects it. Document nodes carry no objectiveKeys. */
export function toPutGraph(mode: StudioMode, g: DraftGraph) {
  return {
    template: g.template,
    injects: g.injects.map((i) => {
      if (mode === "strategic") return i;
      const { objectiveKeys: _o, ...rest } = i;
      return rest;
    }),
    branches: g.branches,
  };
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export function newNodeId(g: DraftGraph): string {
  const used = new Set(g.injects.map((i) => i.nodeId));
  for (let n = g.injects.length + 1; ; n++) if (!used.has(`n${n}`)) return `n${n}`;
}

export function newQuestionKey(g: DraftGraph): string {
  const used = new Set(
    g.injects.flatMap((i) => ("questions" in i.content ? (i.content as DocumentContent).questions.map((q) => q.key) : [])),
  );
  for (let n = 1; ; n++) if (!used.has(`q${n}`)) return `q${n}`;
}

function renumber(injects: DraftInject[]): DraftInject[] {
  return [...injects].sort((a, b) => a.seq - b.seq).map((i, n) => ({ ...i, seq: n + 1 }));
}

export function addInject(mode: StudioMode, g: DraftGraph, near?: string | null): { graph: DraftGraph; nodeId: string } {
  const nodeId = newNodeId(g);
  const last = [...g.injects].sort((a, b) => a.seq - b.seq).at(-1);
  const nearNode = near ? g.injects.find((i) => i.nodeId === near) : undefined;
  const maxY = Math.max(0, ...g.injects.map((i) => i.position.y));
  const inject: DraftInject = {
    nodeId,
    seq: (last?.seq ?? 0) + 1,
    title: "",
    scenarioOffsetMin: last ? last.scenarioOffsetMin + 30 : 0,
    plannedDelayMin: null,
    objectiveKeys: [],
    content:
      mode === "strategic"
        ? { schemaVersion: 1, narrativeMd: "", phase: g.injects.length === 0 ? "opening" : "main", artifacts: [], teamVariants: [] }
        : {
            schemaVersion: 1,
            scenarioUpdate: "",
            keyIssues: [],
            docSectionRefs: [],
            questions: [{ key: newQuestionKey(g), text: "", category: "decision_making", capabilityKeys: [], objectiveKeys: [], docSectionRefs: [] }],
          },
    secret:
      mode === "strategic"
        ? { schemaVersion: 1, expectedActions: {}, mitreTags: [], capabilityKeys: [], clockUpdates: [] }
        : { schemaVersion: 1, expectedActions: [] },
    position: nearNode
      ? { x: nearNode.position.x + 60, y: nearNode.position.y + 160 }
      : { x: last?.position.x ?? 0, y: g.injects.length ? maxY + 160 : 0 },
  };
  return { graph: { ...g, injects: [...g.injects, inject] }, nodeId };
}

export function duplicateInject(g: DraftGraph, nodeId: string): { graph: DraftGraph; nodeId: string } {
  const src = g.injects.find((i) => i.nodeId === nodeId);
  if (!src) return { graph: g, nodeId };
  const id = newNodeId(g);
  const copy: DraftInject = {
    ...structuredClone(src),
    nodeId: id,
    seq: src.seq + 0.5,
    title: `${src.title} (copy)`.slice(0, 160),
    position: { x: src.position.x + 40, y: src.position.y + 40 },
  };
  if ("questions" in copy.content) {
    const used = new Set(g.injects.flatMap((i) => ("questions" in i.content ? (i.content as DocumentContent).questions.map((q) => q.key) : [])));
    let n = 1;
    for (const q of (copy.content as DocumentContent).questions) {
      while (used.has(`q${n}`)) n++;
      q.key = `q${n}`;
      used.add(q.key);
    }
  }
  return { graph: { ...g, injects: renumber([...g.injects, copy]) }, nodeId: id };
}

export function removeInject(g: DraftGraph, nodeId: string): DraftGraph {
  return {
    ...g,
    injects: renumber(g.injects.filter((i) => i.nodeId !== nodeId)),
    branches: g.branches.filter((b) => b.fromNodeId !== nodeId && b.toNodeId !== nodeId),
  };
}

export function updateInject(g: DraftGraph, nodeId: string, fn: (i: DraftInject) => DraftInject): DraftGraph {
  return { ...g, injects: g.injects.map((i) => (i.nodeId === nodeId ? fn(i) : i)) };
}

/** Move a node one place earlier (-1) or later (+1) in seq order. */
export function moveInject(g: DraftGraph, nodeId: string, dir: -1 | 1): DraftGraph {
  const ordered = [...g.injects].sort((a, b) => a.seq - b.seq);
  const i = ordered.findIndex((x) => x.nodeId === nodeId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ordered.length) return g;
  [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
  return { ...g, injects: ordered.map((x, n) => ({ ...x, seq: n + 1 })) };
}

/** A sensible first condition for a new branch from a node. */
export function suggestCondition(mode: StudioMode, g: DraftGraph, fromNodeId: string): BranchCondition {
  const out = outgoing(g, fromNodeId);
  const hasFallback = out.some((b) => {
    const t = conditionType(b.condition);
    return t === "default" || t === "always";
  });
  if (!hasFallback) return { type: "default" };
  const teams = g.template.config.teams;
  if (teams.length) {
    const r = buildCondition("team_outcome", { ...emptyFields(mode, teams), outcome: outcomeOptions(mode).at(-1)!.value });
    if (r.ok) return r.condition;
  }
  return { type: "score_below", value: 2 };
}

/** Add a branch. Conditions run before Otherwise; priorities stay dense. */
export function addBranch(mode: StudioMode, g: DraftGraph, fromNodeId: string, toNodeId: string, condition?: BranchCondition): DraftGraph {
  const c = condition ?? suggestCondition(mode, g, fromNodeId);
  const out = outgoing(g, fromNodeId);
  const next: DraftBranch = { fromNodeId, toNodeId, condition: c, priority: out.length };
  // Keep an Otherwise branch last so new conditions are tried first.
  const ordered = [...out.map(({ index: _i, ...b }) => b as DraftBranch)];
  const fallbackAt = ordered.findIndex((b) => conditionType(b.condition) === "default");
  if (c.type !== "default" && fallbackAt >= 0) ordered.splice(fallbackAt, 0, next);
  else ordered.push(next);
  return {
    ...g,
    branches: [...g.branches.filter((b) => b.fromNodeId !== fromNodeId), ...ordered.map((b, n) => ({ ...b, priority: n }))],
  };
}

/** Outgoing branches of a node in priority order, with their index in g.branches. */
export function branchesFrom(g: DraftGraph, fromNodeId: string) {
  return outgoing(g, fromNodeId) as Array<DraftBranch & { index: number }>;
}

export function updateBranch(g: DraftGraph, index: number, patch: Partial<DraftBranch>): DraftGraph {
  return { ...g, branches: g.branches.map((b, i) => (i === index ? { ...b, ...patch } : b)) };
}

export function removeBranch(g: DraftGraph, index: number): DraftGraph {
  const gone = g.branches[index];
  if (!gone) return g;
  const rest = g.branches.filter((_, i) => i !== index);
  return reprioritize({ ...g, branches: rest }, gone.fromNodeId);
}

/** Move a branch earlier or later among its node's outgoing branches. */
export function moveBranch(g: DraftGraph, index: number, dir: -1 | 1): DraftGraph {
  const b = g.branches[index];
  if (!b) return g;
  const out = branchesFrom(g, b.fromNodeId);
  const i = out.findIndex((x) => x.index === index);
  const j = i + dir;
  if (j < 0 || j >= out.length) return g;
  [out[i], out[j]] = [out[j], out[i]];
  const prio = new Map(out.map((x, n) => [x.index, n]));
  return { ...g, branches: g.branches.map((x, k) => (prio.has(k) ? { ...x, priority: prio.get(k)! } : x)) };
}

function reprioritize(g: DraftGraph, fromNodeId: string): DraftGraph {
  const out = branchesFrom(g, fromNodeId);
  const prio = new Map(out.map((x, n) => [x.index, n]));
  return { ...g, branches: g.branches.map((x, k) => (prio.has(k) ? { ...x, priority: prio.get(k)! } : x)) };
}

/** Switch linear and branched. Going branched with no branches follows seq order. */
export function setBranching(g: DraftGraph, branching: "linear" | "branched"): DraftGraph {
  const next = { ...g, template: { ...g.template, branching } };
  if (branching !== "branched" || g.branches.length > 0 || g.injects.length === 0) return next;
  const ordered = [...g.injects].sort((a, b) => a.seq - b.seq);
  const lastId = ordered.at(-1)!.nodeId;
  return {
    ...next,
    injects: g.injects.map((i) => (i.nodeId === lastId ? { ...i, position: { ...i.position, end: true } } : i)),
    branches: ordered.slice(1).map((n, k) => ({ fromNodeId: ordered[k].nodeId, toNodeId: n.nodeId, condition: { type: "default" } as BranchCondition, priority: 0 })),
  };
}

/** Rename a team everywhere it is used. */
export function renameTeam(g: DraftGraph, from: string, to: string): DraftGraph {
  const rename = (t: string) => (t === from ? to : t);
  return {
    ...g,
    template: { ...g.template, config: { ...g.template.config, teams: g.template.config.teams.map(rename) } },
    injects: g.injects.map((i) => {
      if (!("teamVariants" in i.content)) return i;
      const c = i.content as StrategicContent;
      const s = i.secret as StrategicSecret;
      const ea: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(s.expectedActions)) ea[rename(k)] = v;
      return { ...i, content: { ...c, teamVariants: c.teamVariants.map((v) => ({ ...v, team: rename(v.team) })) }, secret: { ...s, expectedActions: ea } };
    }),
    branches: g.branches.map((b) =>
      (b.condition.type === "team_outcome" || b.condition.type === "majority") && b.condition.team === from ? { ...b, condition: { ...b.condition, team: to } } : b,
    ),
  };
}

/** Remove a team and its variants and expected actions. Branches that name it stay and are flagged. */
export function removeTeam(g: DraftGraph, team: string): DraftGraph {
  return {
    ...g,
    template: { ...g.template, config: { ...g.template.config, teams: g.template.config.teams.filter((t) => t !== team) } },
    injects: g.injects.map((i) => {
      if (!("teamVariants" in i.content)) return i;
      const c = i.content as StrategicContent;
      const s = i.secret as StrategicSecret;
      const { [team]: _gone, ...ea } = s.expectedActions;
      return { ...i, content: { ...c, teamVariants: c.teamVariants.filter((v) => v.team !== team) }, secret: { ...s, expectedActions: ea } };
    }),
  };
}

/** Earlier nodes on the way to this one, oldest first: the shortest branch path, or seq order when linear. */
export function pathTo(g: DraftGraph, nodeId: string): DraftInject[] {
  const byId = new Map(g.injects.map((i) => [i.nodeId, i]));
  if (g.template.branching !== "branched" || g.branches.length === 0) {
    const self = byId.get(nodeId);
    return self ? [...g.injects].filter((i) => i.seq < self.seq).sort((a, b) => a.seq - b.seq) : [];
  }
  const start = startNode(g);
  if (!start) return [];
  const parent = new Map<string, string | null>([[start.nodeId, null]]);
  const queue = [start.nodeId];
  while (queue.length) {
    const id = queue.shift()!;
    if (id === nodeId) break;
    for (const b of outgoing(g, id)) {
      if (!parent.has(b.toNodeId)) {
        parent.set(b.toNodeId, id);
        queue.push(b.toNodeId);
      }
    }
  }
  if (!parent.has(nodeId)) return [];
  const path: DraftInject[] = [];
  let cur = parent.get(nodeId) ?? null;
  while (cur) {
    const n = byId.get(cur);
    if (n) path.unshift(n);
    cur = parent.get(cur) ?? null;
  }
  return path;
}
