// Test fixture: a branched Document TTX template with rubrics, as export input.
import type { ExportableTemplate } from "@/lib/exercise/templates/portable";

export function documentFixture(): ExportableTemplate {
  const mod = (n: number) => ({
    nodeId: `m${n}`,
    seq: n,
    title: `Module ${n}`,
    scenarioOffsetMin: (n - 1) * 60,
    plannedDelayMin: 20,
    targetTeams: [],
    expectedActions: [`Expected action ${n}`],
    objectiveKeys: ["o1"],
    content: {
      schemaVersion: 1,
      scenarioUpdate: `Stage ${n}. File servers at the depot show encrypted files.`,
      keyIssues: ["Who declares"],
      docSectionRefs: ["s1"],
      questions: [{ key: `q${n}`, text: "Who declares the incident and when?", category: "detection", capabilityKeys: ["RS.MA"], objectiveKeys: ["o1"], docSectionRefs: ["s1"] }],
    },
    secret: { schemaVersion: 1, expectedActions: [`Expected action ${n}`] },
    position: { x: 0, y: (n - 1) * 160 },
  });
  return {
    mode: "document",
    title: "Playbook walk-through",
    summary: "Modules from the ransomware playbook.",
    branching: "branched",
    config: { schemaVersion: 1, sourceDocumentId: "doc-local-id", sourceDocumentSha: "a".repeat(64), teams: ["Ops", "IT"], moduleMinutes: 20, paced: "facilitator", regulatoryClocks: [], generation: { step: "done" } },
    objectives: [{ key: "o1", text: "Declare on time.", capabilityKeys: ["RS.MA"] }],
    injects: [mod(1), mod(2), { ...mod(3), position: { x: 0, y: 320, end: true } }],
    branches: [
      { fromNodeId: "m1", toNodeId: "m3", condition: { type: "entries_at_least", entryType: "gap", count: 2 }, priority: 0 },
      { fromNodeId: "m1", toNodeId: "m2", condition: { type: "default" }, priority: 1 },
      { fromNodeId: "m2", toNodeId: "m3", condition: { type: "default" }, priority: 0 },
    ],
    rubrics: [1, 2, 3].map((n) => ({
      questionKey: `q${n}`,
      criteria: [{ id: "c1", text: "Names the incident commander", controlRefs: [] }],
      modelAnswer: "The IC declares.",
      maxScore: 4,
      capabilityKey: "RS.MA",
    })),
  };
}
