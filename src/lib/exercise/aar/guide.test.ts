// @vitest-environment node
import { describe, expect, it } from "vitest";
import { AAR_GUIDE_COPY } from "@/components/aar/editor/aar-guide";
import { fixtureInputs } from "./fixtures";
import { buildDeterministicSections } from "./draft";
import { AAR_FIELD_LABELS } from "./field-labels";
import { AAR_GUIDE_STEPS, aarPromptInput, buildAarPrompt } from "./guide";
import { proposeFindings } from "./proposals";

const DASHES = /[–—]/;

function prompt(over: Parameters<typeof fixtureInputs>[0] = {}) {
  const base = fixtureInputs();
  const inputs = fixtureInputs({
    hotwash: [...base.hotwash, { id: "h3", kind: "afi", objectiveId: "obj1", text: "Sam Ortiz did not know the isolation order — it was unclear." }],
    feedback: { ...base.feedback, improvements: [{ id: "f2", text: "Riley Park wanted a printed contact list." }] },
    ...over,
  });
  let n = 0;
  const sections = proposeFindings(inputs, buildDeterministicSections(inputs), () => `afi_${++n}`).sections;
  return buildAarPrompt(aarPromptInput(inputs, sections));
}

describe("How to write the AAR", () => {
  it("lists the steps in HSEEP order, ending with sign-off and the bundle", () => {
    expect(AAR_GUIDE_STEPS[0]).toMatch(/hotwash/i);
    expect(AAR_GUIDE_STEPS.findIndex((s) => /proposed findings/.test(s))).toBeLessThan(AAR_GUIDE_STEPS.findIndex((s) => /executive summary/.test(s)));
    expect(AAR_GUIDE_STEPS.at(-2)).toMatch(/facilitator, then the sponsor/);
    expect(AAR_GUIDE_STEPS.at(-1)).toMatch(/evidence bundle/);
  });

  it("puts the exercise record in the prompt", () => {
    const p = prompt();
    expect(p).toContain("Name: Depot ransomware");
    expect(p).toContain("Objective 1. Decide on containment within the first hour.");
    expect(p).toContain("Capability: RS.MA Incident management");
    expect(p).toContain("Rating: S: Performed with some challenges. Rationale: Isolation was quick but the order was unclear.");
    expect(p).toContain("[E1] Inject 1, T+0h 0m, Fri 17:30 UTC, Executive, Chief executive: What is your first move? Decision: Isolate the affected systems now.");
    expect(p).toContain("- GDPR 72 hours: Missed.");
    expect(p).toMatch(/Area for improvement \(Objective 2, Inject 2, Evaluator\): The team did not know who calls the insurer\./);
    expect(p).toContain("Inject 2. Reporter calls: Met 1");
    expect(p).toMatch(/Participant feedback, improvements\n\[E\d+\] .*printed contact list/);
    expect(p).toMatch(/\[F\d\] .*isolation order/);
  });

  it("replaces participant names with roles", () => {
    const p = prompt();
    for (const name of ["Sam Ortiz", "Riley Park", "Dana Lee"]) expect(p).not.toContain(name);
    expect(p).toContain("CISO did not know the isolation order");
  });

  it("asks for each field by the editor's label", () => {
    const p = prompt();
    for (const label of [AAR_FIELD_LABELS.executiveSummary, AAR_FIELD_LABELS.strength, AAR_FIELD_LABELS.title, AAR_FIELD_LABELS.observation, AAR_FIELD_LABELS.analysis, AAR_FIELD_LABELS.recommendation, AAR_FIELD_LABELS.capability, AAR_FIELD_LABELS.evidence]) {
      expect(p).toMatch(new RegExp(`^${label}:`, "m"));
    }
    expect(p).toMatch(/^Areas for improvement$/m);
    expect(p).toContain("Five to eight sentences.");
    expect(p).toContain("[F<number>]: Accept or Reject");
  });

  it("states the HSEEP rules", () => {
    const p = prompt();
    expect(p).toContain("Not observed is not a failure.");
    expect(p).toContain("U means the team attempted the task and could not perform it.");
    expect(p).toContain("Exercise artificialities are not areas for improvement.");
    expect(p).toContain("Cite only evidence from the record below");
    expect(p).toContain("Do not use real names.");
  });

  it("has no em or en dashes, even when the record does", () => {
    expect(prompt()).not.toMatch(DASHES);
    for (const s of [...AAR_GUIDE_STEPS, ...Object.values(AAR_GUIDE_COPY)]) expect(s).not.toMatch(DASHES);
  });

  it("uses the caution and manual entry lines", () => {
    expect(AAR_GUIDE_COPY.caution).toBe("Use your organization's approved AI tool. The prompt includes exercise details.");
    expect(AAR_GUIDE_COPY.manual).toBe("Copy each part into the matching field. The report does not import it.");
  });
});
