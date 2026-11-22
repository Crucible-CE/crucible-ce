// @vitest-environment node
// Library collections: every Crisis Sim template passes publish validation
// and the seed authoring rules, every Strategic TTX template passes Studio
// validation, and every playbook is in the generated module and written to
// the same rules.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  anchoredTime,
  expectedActionsSchema,
  templateConfigSchema,
  templateInjectContentSchema,
  templateInjectSecretSchema,
  templateObjectivesSchema,
  PATH_KEYS,
  WEEKDAYS,
} from "@/lib/exercise/modes/crisissim/schema";
import { formatIssues, optionBalanceIssues, validateTemplate } from "@/lib/exercise/modes/crisissim/validate";
import { parseSeedTemplate } from "@/lib/exercise/templates/crisissim-seed";
import { parseStrategicSeed } from "@/lib/exercise/strategic/seed";
import { validateStudio } from "@/lib/exercise/studio/validate";
import { getThreatActor } from "@/lib/exercise/content/threat-actors";
import { getReplay } from "@/lib/exercise/content/replays";
import { getIndustryTemplate } from "@/lib/exercise/content/industries";
import { isDocumentKind } from "@/lib/exercise/documents/kinds";
import { LIBRARY_COLLECTIONS, LIBRARY_PLAYBOOKS, LIBRARY_TEMPLATE_IDS } from "@/lib/exercise/library";
import { libraryPlaybookText } from "./documents";
import { GENERATED_PATH, readPlaybookFiles, renderPlaybookModule } from "./playbook-files";
import { PLAYBOOK_FILES } from "./playbooks.generated";
import type { LibraryCrisisSimTemplate, LibraryStrategicTemplate } from "./types";

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) collectStrings(v, out);
  return out;
}

const DASHES = /[\u2013\u2014]/;

function parseCrisis(t: LibraryCrisisSimTemplate) {
  return {
    config: templateConfigSchema.parse(t.config),
    objectives: templateObjectivesSchema.parse(t.objectives),
    injects: t.injects.map((inj) => ({
      title: inj.title,
      scenarioOffsetMin: inj.scenarioOffsetMin,
      plannedDelayMin: inj.plannedDelayMin,
      targetTeams: inj.targetTeams,
      objectiveKeys: inj.objectiveKeys,
      expectedActions: expectedActionsSchema.parse(inj.expectedActions),
      content: templateInjectContentSchema.parse(inj.content),
      secret: templateInjectSecretSchema.parse(inj.secret),
    })),
  };
}

function strategicGraph(t: LibraryStrategicTemplate) {
  const p = parseStrategicSeed(t);
  return {
    template: { title: t.title, summary: t.summary, branching: t.branching, config: p.config, objectives: p.objectives },
    injects: p.injects.map((i) => ({
      nodeId: i.nodeId,
      seq: i.seq,
      title: i.title,
      scenarioOffsetMin: i.scenarioOffsetMin,
      plannedDelayMin: i.plannedDelayMin,
      objectiveKeys: i.objectiveKeys,
      content: i.content,
      secret: i.secret,
      position: i.position,
    })),
    branches: p.branches,
  };
}

describe("library registry", () => {
  it("has unique template ids and playbook keys", () => {
    expect(new Set(LIBRARY_TEMPLATE_IDS).size).toBe(LIBRARY_TEMPLATE_IDS.length);
    const keys = LIBRARY_PLAYBOOKS.map((p) => p.libraryKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("labels every template and playbook with its collection", () => {
    for (const c of LIBRARY_COLLECTIONS) {
      for (const t of [...c.crisisSim, ...c.strategic]) expect(t.collection, t.id).toBe(c.label);
      for (const p of c.playbooks) expect(p.collection, p.libraryKey).toBe(c.label);
    }
  });
});

for (const collection of LIBRARY_COLLECTIONS) {
  describe(`collection: ${collection.label}`, () => {
    it("has a label", () => {
      expect(collection.label.trim()).not.toBe("");
    });

    for (const t of collection.crisisSim) {
      describe(`crisis sim ${t.id}`, () => {
        it("parses and passes publish validation", () => {
          const parsed = parseCrisis(t);
          const issues = validateTemplate(parsed);
          expect(issues, formatIssues(issues, 50)).toEqual([]);
          expect(() => parseSeedTemplate(t)).not.toThrow();
        });

        it("rates every option on every path with one or two bad on every path options", () => {
          for (const inj of parseCrisis(t).injects) {
            for (const q of inj.content.questions) {
              expect(q.options.map((o) => o.id)).toEqual(["a", "b", "c", "d"]);
              const quality = inj.secret.quality[q.team];
              const allBad = q.options.filter((o) => PATH_KEYS.every((p) => quality[o.id][p] === "bad")).length;
              expect(allBad, `${inj.title} ${q.team}`).toBeGreaterThanOrEqual(1);
              expect(allBad, `${inj.title} ${q.team}`).toBeLessThanOrEqual(2);
              for (const o of q.options) {
                expect(inj.secret.followUps[q.team][o.id], `${inj.title} ${q.team} ${o.id} follow-up`).toBeTruthy();
                expect(inj.secret.rationales[q.team]?.[o.id], `${inj.title} ${q.team} ${o.id} rationale`).toBeTruthy();
              }
              expect(q.decisionOwner).toBeTruthy();
              expect(q.discussionPrompt).toBeTruthy();
            }
          }
        });

        it("keeps options a similar length", () => {
          for (const inj of parseCrisis(t).injects) {
            expect(optionBalanceIssues(inj), inj.title).toEqual([]);
            for (const q of inj.content.questions) {
              const lengths = q.options.map((o) => o.text.length);
              const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
              for (const o of q.options) {
                const label = `${inj.title} ${q.team} ${o.id} is ${o.text.length} chars, average ${Math.round(avg)}`;
                expect(o.text.length / avg, label).toBeGreaterThanOrEqual(0.7);
                expect(o.text.length / avg, label).toBeLessThanOrEqual(1.3);
              }
            }
          }
        });

        it("writes 2 to 4 expected actions for every team with a question", () => {
          for (const inj of parseCrisis(t).injects) {
            for (const q of inj.content.questions) {
              const ea = inj.expectedActions.find((e) => e.team === q.team);
              expect(ea, `${inj.title} ${q.team}`).toBeDefined();
              expect(ea!.actions.length).toBeGreaterThanOrEqual(2);
              expect(ea!.actions.length).toBeLessThanOrEqual(4);
            }
          }
        });

        it("plans about 80 percent of the target duration", () => {
          const { config, injects } = parseCrisis(t);
          const total = injects.reduce((a, i) => a + (i.plannedDelayMin ?? 0), 0);
          expect(total / config.targetDurationMin).toBeGreaterThanOrEqual(0.7);
          expect(total / config.targetDurationMin).toBeLessThanOrEqual(0.9);
        });

        it("has narrative times that match the scenario anchor", () => {
          const { config, injects } = parseCrisis(t);
          const anchor = config.scenarioAnchor!;
          expect(anchor).toBeDefined();
          const re = new RegExp(`^(?:(${WEEKDAYS.join("|")}) )?(\\d\\d:\\d\\d)\\.`);
          for (const inj of injects) {
            const at = anchoredTime(anchor, inj.scenarioOffsetMin);
            for (const p of PATH_KEYS) {
              const m = re.exec(inj.content.variants[p].narrativeMd);
              expect(m, `${inj.title} ${p} starts with its time`).not.toBeNull();
              expect(m![2], `${inj.title} ${p}`).toBe(at.time);
              if (m![1]) expect(m![1], `${inj.title} ${p}`).toBe(at.weekday);
            }
          }
        });

        it("uses existing content keys and has an org profile", () => {
          const config = templateConfigSchema.parse(t.config);
          if (config.replayKey) expect(getReplay(config.replayKey), config.replayKey).toBeDefined();
          expect(config.orgName).toBeTruthy();
          expect(config.executiveBriefMd?.length ?? 0).toBeGreaterThan(400);
        });

        it("contains no em or en dashes", () => {
          expect(collectStrings(t).filter((s) => DASHES.test(s))).toEqual([]);
        });
      });
    }

    for (const t of collection.strategic) {
      describe(`strategic ${t.id}`, () => {
        it("parses and passes Studio validation", () => {
          const { issues, graph } = validateStudio("strategic", strategicGraph(t));
          expect(graph).not.toBeNull();
          expect(issues.filter((i) => i.severity !== "info")).toEqual([]);
        });

        it("branches on a real condition when branched", () => {
          if (t.branching !== "branched") return;
          expect(t.branches.some((b) => b.condition.type !== "default" && b.condition.type !== "always")).toBe(true);
        });

        it("gives every active team questions and expected actions, and phases in order", () => {
          const order = { opening: 0, main: 1, resolution: 2 };
          let last = -1;
          for (const inj of t.injects) {
            const active = inj.teamVariants.filter((v) => v.status === "active");
            expect(active.length, inj.nodeId).toBeGreaterThan(0);
            for (const v of active) {
              expect(v.questions.length, `${inj.nodeId} ${v.team}`).toBeGreaterThan(0);
              expect(inj.expectedActions[v.team]?.length ?? 0, `${inj.nodeId} ${v.team}`).toBeGreaterThanOrEqual(2);
            }
            expect(order[inj.phase]).toBeGreaterThanOrEqual(last === 2 ? 2 : 0);
            last = order[inj.phase];
          }
        });

        it("uses existing content keys and has an org profile", () => {
          const s = parseStrategicSeed(t).config.scenario;
          if (s.threatActorKey) expect(getThreatActor(s.threatActorKey), s.threatActorKey).toBeDefined();
          if (s.replayKey) expect(getReplay(s.replayKey), s.replayKey).toBeDefined();
          if (s.industryKey) expect(getIndustryTemplate(s.industryKey), s.industryKey).toBeDefined();
          expect(s.orgProfileMd.length).toBeGreaterThan(400);
        });

        it("contains no em or en dashes", () => {
          expect(collectStrings(t).filter((s) => DASHES.test(s))).toEqual([]);
        });
      });
    }

    for (const p of collection.playbooks) {
      describe(`playbook ${p.libraryKey}`, () => {
        const text = libraryPlaybookText(p);
        const words = text.split(/\s+/).filter(Boolean).length;

        it("is a known document kind with a title", () => {
          expect(isDocumentKind(p.kind)).toBe(true);
          expect(text.startsWith("# ")).toBe(true);
        });

        it("runs 6 to 12 pages", () => {
          // About 500 words per page.
          expect(words).toBeGreaterThanOrEqual(3000);
          expect(words).toBeLessThanOrEqual(6000);
        });

        it("ends with sources and has the required sections", () => {
          const headings = [...text.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].toLowerCase());
          expect(headings.at(-1)).toBe("sources");
          for (const want of ["roles", "notification", "ransom", "recover", "post-incident"]) {
            expect(headings.some((h) => h.includes(want)), want).toBe(true);
          }
          expect(text).toMatch(/\[FILL IN/);
        });

        it("contains no em or en dashes", () => {
          expect(text.split("\n").filter((l) => DASHES.test(l))).toEqual([]);
        });
      });
    }
  });
}

describe("playbook files", () => {
  it("playbooks.generated.ts matches the Markdown files", () => {
    const current = readFileSync(path.resolve(GENERATED_PATH), "utf8").replace(/\r\n?/g, "\n");
    expect(current, "Run npm run library:playbooks").toBe(renderPlaybookModule());
  });

  it("every registered playbook has a file and every file is registered", () => {
    const files = Object.keys(readPlaybookFiles());
    expect(Object.keys(PLAYBOOK_FILES)).toEqual(files);
    expect(LIBRARY_PLAYBOOKS.map((p) => p.file).sort()).toEqual([...files].sort());
  });
});
