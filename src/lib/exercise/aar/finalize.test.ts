// @vitest-environment node
import { describe, expect, it } from "vitest";
import { finalizeProblems, meetingMissing, nextSignerRole, requiredRoles, sectionFacts, type FinalizeFacts } from "./finalize";
import { evidenceAfiId, listAfis, unresolvedAfis } from "@/lib/exercise/improvement/afis";
import { fixtureSections } from "./test-fixture";

const ok: FinalizeFacts = {
  exercise: { status: "ended", isPractice: false },
  aar: { status: "review", isLatest: true },
  sectionsReadable: true,
  unresolvedAfiCount: 0,
};

describe("finalize rules", () => {
  it("passes a reviewed report of an ended exercise", () => {
    expect(finalizeProblems(ok)).toEqual([]);
  });
  it("refuses practice exercises", () => {
    expect(finalizeProblems({ ...ok, exercise: { status: "ended", isPractice: true } })).toContain("Practice exercises do not get a signed report.");
  });
  it("refuses abandoned and running exercises", () => {
    expect(finalizeProblems({ ...ok, exercise: { status: "abandoned", isPractice: false } })).toContain("Abandoned exercises do not get a signed report.");
    expect(finalizeProblems({ ...ok, exercise: { status: "live", isPractice: false } })).toContain("End the exercise first.");
  });
  it("refuses unless the status is review", () => {
    expect(finalizeProblems({ ...ok, aar: { status: "draft", isLatest: true } })).toContain("Move the report to review first.");
    expect(finalizeProblems({ ...ok, aar: { status: "final", isLatest: true } })).toContain("This report is already final.");
  });
  it("refuses while any finding is proposed, or accepted with no follow-up", () => {
    expect(finalizeProblems({ ...ok, unresolvedAfiCount: 1 })[0]).toMatch(/One area for improvement is still proposed/);
    expect(finalizeProblems({ ...ok, unresolvedAfiCount: 3 })[0]).toMatch(/^3 areas for improvement are still proposed/);
    expect(finalizeProblems({ ...ok, acceptedWithoutFollowUp: 1 })[0]).toBe("One accepted area for improvement has no work item or no action reason.");
  });
  it("every objective needs an evaluator rating or Not evaluated with a reason", () => {
    const s = fixtureSections();
    expect(sectionFacts(s).unratedObjectives).toBe(0);
    s.analysis[0] = { ...s.analysis[0], rating: null, ratingSource: null };
    expect(sectionFacts(s).unratedObjectives).toBe(1);
    expect(finalizeProblems({ ...ok, ...sectionFacts(s) })[0]).toMatch(/no evaluator rating/);
    s.analysis[0] = { ...s.analysis[0], rating: null, ratingSource: "evaluator", notEvaluated: true, ratingRationale: "" };
    expect(sectionFacts(s).unratedObjectives).toBe(1);
    s.analysis[0].ratingRationale = "No inject tested it.";
    expect(sectionFacts(s).unratedObjectives).toBe(0);
  });
  it("refuses accepted AFIs without observation, analysis or recommendation, and an empty executive summary", () => {
    const s = fixtureSections();
    s.analysis[0].afis[0].status = "accepted";
    s.analysis[0].afis[1].status = "rejected";
    s.analysis[0].afis[0].analysis = " ";
    s.analysis[0].afis[1].recommendation = "";
    s.analysis[0].afis[1].rejectedReason = "Out of scope.";
    s.executiveSummary = "";
    const f = sectionFacts(s);
    expect(f).toMatchObject({ incompleteAfis: 1, executiveSummaryEmpty: true });
    const problems = finalizeProblems({ ...ok, ...f });
    expect(problems).toContain("One accepted area for improvement has no observation, analysis or recommendation. Complete it.");
    expect(problems).toContain("Write the executive summary first.");
  });
  it("needs the after-action meeting record", () => {
    expect(meetingMissing({ aamAt: null, aamAttendees: " ", ipAgreedAt: null })).toEqual(["date", "attendees", "plan"]);
    expect(meetingMissing({ aamAt: new Date(), aamAttendees: "Director", ipAgreedAt: new Date() })).toEqual([]);
    expect(finalizeProblems({ ...ok, meetingMissing: ["plan"] })[0]).toMatch(/after-action meeting/);
  });
  it("needs attendance confirmed for every participant", () => {
    expect(finalizeProblems({ ...ok, unconfirmedAttendance: 1 })).toContain("One participant has no confirmed attendance. Confirm it on the roster.");
    expect(finalizeProblems({ ...ok, unconfirmedAttendance: 2 })).toContain("2 participants have no confirmed attendance. Confirm them on the roster.");
    expect(finalizeProblems({ ...ok, unconfirmedAttendance: 0 })).toEqual([]);
  });
  it("refuses an older version", () => {
    expect(finalizeProblems({ ...ok, aar: { status: "review", isLatest: false } })).toContain("A newer version of this report exists.");
  });
});

describe("signing order", () => {
  it("is facilitator then sponsor when sponsor sign-off is required", () => {
    expect(requiredRoles(true)).toEqual(["facilitator", "sponsor"]);
    expect(nextSignerRole([], true)).toBe("facilitator");
    expect(nextSignerRole(["facilitator"], true)).toBe("sponsor");
    expect(nextSignerRole(["facilitator", "sponsor"], true)).toBeNull();
    // A sponsor row alone never skips the facilitator.
    expect(nextSignerRole(["sponsor"], true)).toBe("facilitator");
  });
  it("is facilitator only otherwise", () => {
    expect(nextSignerRole([], false)).toBe("facilitator");
    expect(nextSignerRole(["facilitator"], false)).toBeNull();
  });
});

describe("AFI resolution", () => {
  const sections = fixtureSections();
  it("lists every AFI with its objective", () => {
    const afis = listAfis(sections);
    expect(afis.map((a) => a.id)).toEqual(["afi1a", "afi1b"]);
    expect(afis[0].objectiveId).toBe("obj1");
  });
  it("counts AFIs without an action or a rejection as unresolved", () => {
    expect(unresolvedAfis(sections, []).length).toBe(2);
    expect(unresolvedAfis(sections, [{ id: "x", evidence: { afiId: "afi1a" } }]).map((a) => a.id)).toEqual(["afi1b"]);
    const s2 = fixtureSections();
    s2.analysis[0].afis[1].rejectedReason = "Out of scope for this program.";
    s2.analysis[0].afis[0].actionItemId = "item1";
    expect(unresolvedAfis(s2, [{ id: "item1", evidence: {} }])).toEqual([]);
    // A link to a deleted action item does not count.
    expect(unresolvedAfis(s2, []).map((a) => a.id)).toEqual(["afi1a"]);
  });
  it("reads afiId from object or array evidence", () => {
    expect(evidenceAfiId({ afiId: "a" })).toBe("a");
    expect(evidenceAfiId([{ afiId: "b" }])).toBe("b");
    expect(evidenceAfiId([])).toBeNull();
    expect(evidenceAfiId(null)).toBeNull();
  });
});
