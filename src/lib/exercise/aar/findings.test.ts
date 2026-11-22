// @vitest-environment node
import { describe, expect, it } from "vitest";
import { fixtureInputs } from "./fixtures";
import { buildDeterministicSections } from "./draft";
import { AarEditError } from "./edit";
import { aarSectionsSchema, type AarSections } from "./schema";
import { allFindings, appendixRows, applyFindingAction, decisionText, findingCounts, findingsEditProblem, reasonProblem, reportAfis } from "./findings";
import { isLowGrade, proposeFindings } from "./proposals";
import { unresolvedAfis } from "@/lib/exercise/improvement/afis";

const actor = { userId: "u1", name: "Fran Facilitator" };
const NOW = new Date("2026-10-21T10:00:00.000Z");

function ids() {
  let n = 0;
  return () => `afi_${++n}`;
}

/** Inputs with one item from every source. */
function richInputs() {
  const base = fixtureInputs();
  return fixtureInputs({
    hotwash: [...base.hotwash, { id: "h3", kind: "afi", objectiveId: "obj1", text: "Nobody owned the holding statement." }],
    feedback: { ...base.feedback, improvements: [{ id: "f2", text: "Dana Lee should have been looped in earlier." }] },
    responses: [
      ...base.responses,
      { sourceId: "r2", sourceKind: "answer", kind: "deliverable", injectId: "inj2", team: "Executive", role: "General Counsel", text: "We would wait.", rating: "partially_met", ratingSource: "human", ratingScore: 1, ratingRationale: "No owner named.", at: "2026-10-20T14:52:00.000Z" },
      { sourceId: "r3", sourceKind: "answer", kind: "deliverable", injectId: "inj1", team: "Technical", role: "CISO", text: "Isolate.", rating: "partially_met", ratingSource: "human", ratingScore: 3, at: "2026-10-20T14:53:00.000Z" },
    ],
  });
}

function proposed(): AarSections {
  const inputs = richInputs();
  return proposeFindings(inputs, buildDeterministicSections(inputs), ids()).sections;
}

const find = (s: AarSections, title: RegExp) => allFindings(s).find((f) => title.test(f.afi.title))!;

describe("proposed findings", () => {
  it("proposes one finding per source: hotwash, evaluator, feedback and low grades", () => {
    const s = proposed();
    const all = allFindings(s);
    expect(all.every((f) => f.afi.status === "proposed")).toBe(true);
    expect(all.map((f) => f.afi.sources[0].kind).sort()).toEqual(["evaluator", "feedback", "grade", "hotwash"]);
    // The hotwash item sits under its objective; feedback has no objective yet.
    expect(find(s, /holding statement/).objectiveId).toBe("obj1");
    expect(find(s, /looped in/).objectiveId).toBeNull();
    // The evaluator observation carries its evidence chip.
    expect(find(s, /insurer/).afi.evidence[0]).toMatchObject({ kind: "observation", sourceId: "o1" });
    // Low grade: score 1 of 4 is proposed with the evaluator rationale; a score of 3 is not.
    const grade = all.find((f) => f.afi.sources[0].kind === "grade")!;
    expect(grade.afi.sources[0].sourceId).toBe("r2");
    expect(grade.afi.title).toBe("Inject 2. Reporter calls: graded partially met");
    expect(grade.afi.observation).toContain("Evaluator rationale: No owner named.");
    expect(grade.objectiveId).toBe("obj2");
  });

  it("replaces names with roles", () => {
    const s = proposed();
    expect(find(s, /looped in/).afi.title).not.toContain("Dana Lee");
    expect(find(s, /looped in/).afi.title).toContain("General Counsel");
  });

  it("does not propose the same source row twice and folds repeated text into one finding", () => {
    const inputs = richInputs();
    const once = proposeFindings(inputs, buildDeterministicSections(inputs), ids());
    const twice = proposeFindings(inputs, once.sections, ids());
    expect(twice.added).toEqual([]);
    expect(allFindings(twice.sections)).toHaveLength(allFindings(once.sections).length);
    // A hotwash item with the same words as the evaluator observation adds a source instead of a finding.
    const more = fixtureInputs({ ...inputs, hotwash: [...inputs.hotwash, { id: "h9", kind: "afi", objectiveId: "obj2", text: "The team did not know who calls the insurer!" }] });
    const third = proposeFindings(more, twice.sections, ids());
    expect(third.added).toEqual([]);
    expect(find(third.sections, /insurer/).afi.sources.map((x) => x.kind)).toEqual(["evaluator", "hotwash"]);
  });

  it("treats not met, not effective and a score of 1 or less as low", () => {
    expect(isLowGrade("not_met", 3)).toBe(true);
    expect(isLowGrade("ineffective", null)).toBe(true);
    expect(isLowGrade("partially_met", 1)).toBe(true);
    expect(isLowGrade("partially_met", 1.5)).toBe(false);
    expect(isLowGrade("met", 4)).toBe(false);
  });
});

describe("findings decisions", () => {
  it("accept puts a finding in the report; accepting one with no objective needs an objective", () => {
    const s = proposed();
    const hot = find(s, /holding statement/).afi.id;
    const fb = find(s, /looped in/).afi.id;
    expect(() => applyFindingAction(s, { kind: "accept", ids: [fb] }, actor, NOW)).toThrow(/Pick the objective/);
    const r = applyFindingAction(s, { kind: "accept", ids: [hot] }, actor, NOW);
    const after = find(r.sections, /holding statement/);
    expect(after.afi.status).toBe("accepted");
    expect(after.afi.review).toEqual({ byUserId: "u1", byName: "Fran Facilitator", at: NOW.toISOString() });
    expect(reportAfis(r.sections.analysis[0].afis).map((f) => f.id)).toEqual([hot]);
    const moved = applyFindingAction(r.sections, { kind: "accept", ids: [fb], objectiveId: "obj2" }, actor, NOW).sections;
    expect(find(moved, /looped in/).objectiveId).toBe("obj2");
    expect(moved.unassignedFindings).toHaveLength(0);
  });

  it("No action needed needs an accepted finding and a reason, and creates no action item", () => {
    const s = proposed();
    const id = find(s, /holding statement/).afi.id;
    expect(() => applyFindingAction(s, { kind: "no_action", ids: [id], preset: "already_fixed" }, actor, NOW)).toThrow(/Accept/);
    const acc = applyFindingAction(s, { kind: "accept", ids: [id] }, actor, NOW).sections;
    expect(() => applyFindingAction(acc, { kind: "no_action", ids: [id] }, actor, NOW)).toThrow(/Give a reason/);
    expect(() => applyFindingAction(acc, { kind: "no_action", ids: [id], preset: "tracked_elsewhere" }, actor, NOW)).toThrow(/where it is tracked/);
    const done = applyFindingAction(acc, { kind: "no_action", ids: [id], preset: "tracked_elsewhere", reference: "CHG-1042" }, actor, NOW).sections;
    const f = find(done, /holding statement/).afi;
    expect(f.actionItemId).toBeNull();
    expect(decisionText(f.decision)).toBe("Tracked elsewhere. Reference: CHG-1042.");
    expect(unresolvedAfis(done, []).map((x) => x.id)).not.toContain(id);
  });

  it("reject needs a reason, keeps the finding out of the report and lists it in the appendix", () => {
    const s = proposed();
    const id = find(s, /holding statement/).afi.id;
    expect(() => applyFindingAction(s, { kind: "reject", ids: [id] }, actor, NOW)).toThrow(AarEditError);
    expect(reasonProblem("rejected", { preset: "other" })).toBe("Describe the reason.");
    const r = applyFindingAction(s, { kind: "reject", ids: [id], preset: "artificiality", reason: "The phone bridge was simulated." }, actor, NOW).sections;
    expect(reportAfis(r.analysis[0].afis)).toEqual([]);
    const row = appendixRows(r).find((x) => x.id === id)!;
    expect(row).toMatchObject({ status: "Rejected", sources: "Hotwash", reason: "Exercise artificiality. The phone bridge was simulated.", by: "Fran Facilitator", at: NOW.toISOString() });
    // Reopen brings it back to proposed.
    const back = applyFindingAction(r, { kind: "reopen", ids: [id] }, actor, NOW).sections;
    expect(find(back, /holding statement/).afi).toMatchObject({ status: "proposed", decision: null, rejectedReason: null });
  });

  it("bulk rejects with one reason, and checks every finding before changing any", () => {
    const s = proposed();
    const all = allFindings(s).map((f) => f.afi.id);
    const r = applyFindingAction(s, { kind: "reject", ids: all, preset: "duplicate" }, actor, NOW);
    expect(r.changed).toHaveLength(all.length);
    expect(allFindings(r.sections).every((f) => f.afi.status === "rejected" && f.afi.rejectedReason === "Duplicate.")).toBe(true);
    const one = applyFindingAction(s, { kind: "accept", ids: [all[0]] }, actor, NOW).sections;
    expect(() => applyFindingAction(one, { kind: "accept", ids: all }, actor, NOW)).toThrow(/already accepted/);
  });

  it("links an action item: exactly one decision of kind action", () => {
    const s = proposed();
    const id = find(s, /holding statement/).afi.id;
    const r = applyFindingAction(s, { kind: "link_action", id, actionItemId: "item1" }, actor, NOW).sections;
    const f = find(r, /holding statement/).afi;
    expect(f).toMatchObject({ status: "accepted", actionItemId: "item1", decision: { kind: "action" } });
    expect(findingCounts(r)).toMatchObject({ accepted: 1, actionItems: 1, noAction: 0 });
    expect(() => applyFindingAction(r, { kind: "reopen", ids: [id] }, actor, NOW)).toThrow(/work item/);
  });

  it("merges two proposed findings into one with both sources", () => {
    const s = proposed();
    const a = find(s, /holding statement/).afi.id;
    const b = find(s, /looped in/).afi.id;
    const r = applyFindingAction(s, { kind: "merge", primaryId: a, secondaryId: b }, actor, NOW).sections;
    const f = find(r, /holding statement/).afi;
    expect(f.sources.map((x) => x.kind)).toEqual(["hotwash", "feedback"]);
    expect(f.mergedFrom).toEqual([b]);
    expect(allFindings(r).some((x) => x.afi.id === b)).toBe(false);
    // Proposals stay merged: the feedback row is not proposed again.
    expect(proposeFindings(richInputs(), r, ids()).added).toEqual([]);
  });

  it("section edits cannot change decisions or remove a finding from the record", () => {
    const s = proposed();
    const i = find(s, /holding statement/);
    const edited = structuredClone(s);
    edited.analysis[0].afis[i.index].status = "accepted";
    expect(findingsEditProblem(s, edited)).toMatch(/Findings tab/);
    const removed = structuredClone(s);
    removed.analysis[0].afis.splice(i.index, 1);
    expect(findingsEditProblem(s, removed)).toMatch(/Reject the finding/);
    const text = structuredClone(s);
    text.analysis[0].afis[i.index].analysis = "The plan names no owner.";
    expect(findingsEditProblem(s, text)).toBeNull();
  });
});

describe("legacy AFIs", () => {
  it("maps resolveAfi data: an action item to accepted with action, a rejection reason to rejected, the rest to proposed", () => {
    const raw = structuredClone(buildDeterministicSections(fixtureInputs())) as unknown as { analysis: Array<{ afis: unknown[] }> };
    const legacy = (over: Record<string, unknown>) => ({ id: "x", title: "T", observation: "O", analysis: "A", recommendation: "R", capabilityKey: null, references: [], evidence: [], actionItemId: null, rejectedReason: null, ...over });
    raw.analysis[0].afis = [legacy({ id: "a", actionItemId: "item1" }), legacy({ id: "b", rejectedReason: "Covered elsewhere." }), legacy({ id: "c" })];
    const s = aarSectionsSchema.parse(raw);
    const [a, b, c] = s.analysis[0].afis;
    expect(a).toMatchObject({ status: "accepted", decision: { kind: "action" }, sources: [{ kind: "written", sourceId: null }] });
    expect(b).toMatchObject({ status: "rejected", decision: { kind: "rejected", reason: "Covered elsewhere." } });
    expect(c).toMatchObject({ status: "proposed", decision: null });
    expect(s.unassignedFindings).toEqual([]);
    expect(unresolvedAfis(s, [{ id: "item1", evidence: { afiId: "a" } }]).map((f) => f.id)).toEqual(["c"]);
  });
});
