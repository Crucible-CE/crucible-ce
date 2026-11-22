// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CRISISSIM_SEED_TEMPLATES } from "./crisissim-seed-data";
import { parseSeedTemplate } from "./crisissim-seed";
import { STRATEGIC_SEED_TEMPLATES } from "@/lib/exercise/strategic/seed-data";
import { parseStrategicSeed } from "@/lib/exercise/strategic/seed";
import { LEGACY_PORTABLE_FORMATS, PORTABLE_FORMAT, parsePortable, toPortable, type ExportableTemplate } from "./portable";
import { documentFixture } from "@/lib/exercise/studio/fixtures";

function crisisExportable(i: number): ExportableTemplate {
  const t = CRISISSIM_SEED_TEMPLATES[i];
  const p = parseSeedTemplate(t);
  return { mode: "crisissim", title: t.title, summary: t.summary ?? null, branching: "linear", config: p.config, objectives: p.objectives, injects: p.injects, branches: [], rubrics: [] };
}

function strategicExportable(id: string): ExportableTemplate {
  const t = STRATEGIC_SEED_TEMPLATES.find((x) => x.id === id)!;
  const p = parseStrategicSeed(t);
  return {
    mode: "strategic",
    title: t.title,
    summary: t.summary,
    branching: t.branching,
    config: p.config,
    objectives: p.objectives,
    injects: p.injects.map((inj, k) => ({ ...inj, position: k === p.injects.length - 1 ? { ...inj.position, end: true } : inj.position })),
    branches: p.branches,
    rubrics: [],
  };
}

/** JSON round trip, as through a file. */
const viaFile = (v: unknown) => JSON.parse(JSON.stringify(v)) as unknown;

describe("portable templates", () => {
  it.each(CRISISSIM_SEED_TEMPLATES.map((_, i) => i))("round trips Crisis Sim seed %i", (i) => {
    const src = crisisExportable(i);
    const file = toPortable(src);
    expect(file).toMatchObject({ format: PORTABLE_FORMAT, version: 1, mode: "crisissim", branches: [], rubrics: [], sourceDocument: null });
    const r = parsePortable(viaFile(file));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.issues).toEqual([]);
    expect(r.value.injects.map((x) => [x.title, x.content, x.secret, x.expectedActions])).toEqual(src.injects.map((x) => [x.title, x.content, x.secret, x.expectedActions]));
    expect(r.value.config).toEqual(src.config);
    // Secrets travel in the file.
    expect(JSON.stringify(file)).toContain('"quality"');
  });

  it("writes crucible-template and still imports the older format name", () => {
    const file = toPortable(crisisExportable(0));
    expect(file.format).toBe("crucible-template");
    for (const format of LEGACY_PORTABLE_FORMATS) expect(parsePortable(viaFile({ ...file, format })).ok).toBe(true);
    expect(parsePortable(viaFile({ ...file, format: "something-else" })).ok).toBe(false);
  });

  it.each(["lib-strategic-utility-ransomware", "lib-strategic-fintech-breach"])("round trips Strategic TTX seed %s", (id) => {
    const src = strategicExportable(id);
    const r = parsePortable(viaFile(toPortable(src)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.mode).toBe("strategic");
    expect(r.value.branching).toBe(src.branching);
    expect(r.value.branches).toEqual(src.branches);
    expect(r.value.issues).toEqual([]);
    expect(r.value.injects.map((x) => ({ nodeId: x.nodeId, content: x.content, secret: x.secret, objectiveKeys: x.objectiveKeys, targetTeams: x.targetTeams }))).toEqual(
      src.injects.map((x) => ({ nodeId: x.nodeId, content: x.content, secret: x.secret, objectiveKeys: x.objectiveKeys, targetTeams: x.targetTeams })),
    );
  });

  it("round trips a Document TTX template with rubrics and the document hash, never its id", () => {
    const src = documentFixture();
    const file = toPortable(src, { title: "Ransomware playbook", sha256: "a".repeat(64) });
    expect(file.template.config.sourceDocumentId).toBeNull();
    expect(file.template.config.generation).toBeUndefined();
    expect(file.sourceDocument).toEqual({ title: "Ransomware playbook", sha256: "a".repeat(64) });
    const r = parsePortable(viaFile(file));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.rubrics.map((x) => x.questionKey)).toEqual(["q1", "q2", "q3"]);
    expect(r.value.branches).toHaveLength(3);
    expect(r.value.injects.map((x) => x.content)).toEqual(src.injects.map((x) => x.content));
    expect(r.value.injects[0].objectiveKeys).toEqual(["o1"]);
    expect(r.value.sourceDocument?.sha256).toBe("a".repeat(64));
  });

  it("imports a file written before Studio (no node ids, seq or branches)", () => {
    const file = viaFile(toPortable(crisisExportable(0))) as { mode?: string; injects: Array<Record<string, unknown>>; branches?: unknown; rubrics?: unknown; sourceDocument?: unknown };
    delete file.mode;
    delete file.branches;
    delete file.rubrics;
    delete file.sourceDocument;
    for (const i of file.injects) {
      delete i.nodeId;
      delete i.seq;
      delete i.position;
    }
    const r = parsePortable(file);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.injects.map((i) => i.nodeId)).toEqual(file.injects.map((_, k) => `n${k + 1}`));
  });

  it("refuses a file whose branches loop", () => {
    const src = strategicExportable("lib-strategic-fintech-breach");
    src.branches = [...src.branches, { fromNodeId: "f4", toNodeId: "f2", condition: { type: "score_below", value: 1 }, priority: 5 }];
    const r = parsePortable(viaFile(toPortable(src)));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("The file has an invalid branch graph.");
  });

  it("refuses files that are not template exports or name two modes", () => {
    expect(parsePortable({ hello: "world" })).toEqual({ ok: false, error: "This is not a template export file." });
    const file = viaFile(toPortable(crisisExportable(0))) as { mode: string };
    file.mode = "strategic";
    expect(parsePortable(file)).toEqual({ ok: false, error: "The file names two different exercise types." });
  });
});
