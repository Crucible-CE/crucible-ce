// Which built-in library templates has the organization changed? A library
// template counts as edited when its stored content no longer matches the
// seed it came from: title, summary, settings, objectives, injects or
// branches. Moving nodes on the Studio canvas does not count. Export for
// Cloud includes edited library templates and skips the rest, since Cloud
// has the same library.

import type { DbClient } from "@/lib/db";
import { db } from "@/lib/db";
import { CRISISSIM_SEED_TEMPLATES } from "./crisissim-seed-data";
import { parseSeedTemplate } from "./crisissim-seed";
import { STRATEGIC_SEED_TEMPLATES } from "@/lib/exercise/strategic/seed-data";
import { parseStrategicSeed } from "@/lib/exercise/strategic/seed";

interface Comparable {
  title: string;
  summary: string | null | undefined;
  branching: string;
  config: unknown;
  objectives: unknown;
  injects: Array<{
    nodeId: string;
    seq: number;
    title: string;
    scenarioOffsetMin: number;
    plannedDelayMin: number | null | undefined;
    targetTeams: unknown;
    objectiveKeys: unknown;
    expectedActions: unknown;
    content: unknown;
    secret: unknown;
  }>;
  branches: Array<{ fromNodeId: string; toNodeId: string; condition: unknown; priority: number }>;
}

/** JSON with sorted keys and undefined dropped, so database JSON and parsed seeds compare equal. */
function stable(v: unknown): string {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map((x) => stable(x)).join(",")}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
}

function fingerprint(c: Comparable): string {
  return stable({
    title: c.title,
    summary: c.summary ?? null,
    branching: c.branching,
    config: c.config,
    objectives: c.objectives,
    injects: [...c.injects]
      .sort((a, b) => a.seq - b.seq)
      .map((i) => ({
        nodeId: i.nodeId,
        seq: i.seq,
        title: i.title,
        scenarioOffsetMin: i.scenarioOffsetMin,
        plannedDelayMin: i.plannedDelayMin ?? null,
        targetTeams: i.targetTeams,
        objectiveKeys: i.objectiveKeys,
        expectedActions: i.expectedActions,
        content: i.content,
        secret: i.secret,
      })),
    branches: c.branches
      .map((b) => ({ fromNodeId: b.fromNodeId, toNodeId: b.toNodeId, condition: b.condition, priority: b.priority }))
      .sort((a, b) => stable(a).localeCompare(stable(b))),
  });
}

let seedPrints: Map<string, string> | null = null;

/** Fingerprints of the library as shipped, by template id. */
function librarySeedPrints(): Map<string, string> {
  if (seedPrints) return seedPrints;
  const m = new Map<string, string>();
  for (const t of CRISISSIM_SEED_TEMPLATES) {
    const p = parseSeedTemplate(t);
    m.set(t.id, fingerprint({ title: t.title, summary: t.summary, branching: "linear", config: p.config, objectives: p.objectives, injects: p.injects, branches: [] }));
  }
  for (const t of STRATEGIC_SEED_TEMPLATES) {
    const p = parseStrategicSeed(t);
    m.set(t.id, fingerprint({ title: t.title, summary: t.summary, branching: t.branching, config: p.config, objectives: p.objectives, injects: p.injects, branches: p.branches }));
  }
  seedPrints = m;
  return m;
}

/** Ids of library templates whose content differs from the shipped library. Unknown library ids count as unedited. */
export async function editedLibraryTemplateIds(client: DbClient = db): Promise<string[]> {
  const prints = librarySeedPrints();
  const rows = await client.exerciseTemplate.findMany({
    where: { scope: "library", status: { in: ["draft", "published"] }, id: { in: [...prints.keys()] } },
    include: { injects: true, branches: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.filter((r) => fingerprint(r as unknown as Comparable) !== prints.get(r.id)).map((r) => r.id);
}
