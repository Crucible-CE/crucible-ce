// @vitest-environment node
import { describe, expect, it } from "vitest";
import { fixtureInputs } from "./fixtures";
import { buildDeterministicSections, clockStatement, buildControlMapping } from "./draft";
import { matchRequiredRoles, readRequiredRoles, techniquesExercised } from "./inputs";
import { makeNameReplacer } from "./names";
import { AarEditError, appendEditLog, applySectionEdit, protectedFieldChange, sectionOrigins, sectionsToRegenerate } from "./edit";
import { evidenceFromOption, evidenceOptions } from "./evidence";
import { recordSections } from "./service";
import { ATTACK_FRAMEWORK, controlResultLabel, type EditLogEntry } from "./schema";

describe("deterministic sections", () => {
  const inputs = fixtureInputs();
  const s = buildDeterministicSections(inputs);

  it("states each clock outcome plainly", () => {
    expect(s.clocks.map((c) => c.statement)).toEqual([
      "Met on time at 2026-10-24 09:00 UTC. The deadline was 2026-10-29 17:30 UTC.",
      "Missed. Not met by the 2026-10-26 17:30 UTC deadline.",
      "Open at ENDEX. Due 2026-10-24 17:30 UTC.",
      "Not started.",
    ]);
    expect(clockStatement({ status: "missed", deadlineAt: "2026-10-26T17:30:00.000Z", metAt: "2026-10-27T08:00:00.000Z", triggeredAt: null }, "UTC")).toBe(
      "Missed. Met at 2026-10-27 08:00 UTC, after the 2026-10-26 17:30 UTC deadline.",
    );
  });

  it("builds the roster with names, titles, teams and guests", () => {
    expect(s.roster).toHaveLength(4);
    expect(s.roster[1]).toMatchObject({ name: "Dana Lee", title: "General Counsel", team: "Executive", guest: true, joinedAt: "2026-10-20T13:58:00.000Z" });
    expect(s.overview.participatingOrganizations).toEqual(["Acme", "Acme Security"]);
    expect(s.overview.pointsOfContact).toEqual(["Fran Facilitator, Acme"]);
    expect(s.overview.durationMin).toBe(65);
  });

  it("matches required roles case-insensitively against titles and roles", () => {
    expect(readRequiredRoles({ requiredRoles: ["CISO", { role: "Communications lead" }, "Evaluator", ""] })).toEqual(["CISO", "Communications lead", "Evaluator"]);
    const roster = [
      { title: "Chief Information Security Officer (ciso)", roles: ["player"], removed: false, attendance: "attended" as const },
      { title: null, roles: ["evaluator"], removed: false, attendance: "partial" as const },
      { title: "Communications lead", roles: ["player"], removed: true, attendance: "attended" as const },
    ];
    expect(matchRequiredRoles(["CISO", "evaluator", "Communications lead"], roster)).toEqual([
      { role: "CISO", present: true },
      { role: "evaluator", present: true },
      { role: "Communications lead", present: false },
    ]);
    // Only facilitator-confirmed attended or partial counts.
    const unconfirmed = roster.map((p) => ({ ...p, attendance: null }));
    expect(matchRequiredRoles(["CISO"], unconfirmed)).toEqual([{ role: "CISO", present: false }]);
    expect(matchRequiredRoles(["CISO"], [{ ...roster[0], attendance: "absent" as const }])).toEqual([{ role: "CISO", present: false }]);
    expect(s.requiredRoles).toEqual([
      { role: "CISO", present: true },
      { role: "Communications lead", present: false },
    ]);
  });

  it("puts evaluator ratings on the analysis and leaves the rest unrated", () => {
    expect(s.analysis[0]).toMatchObject({ objectiveId: "obj1", rating: "S", ratingSource: "evaluator" });
    expect(s.analysis[1]).toMatchObject({ rating: null, ratingSource: null });
  });

  it("writes the decision log, parking lot and methodology from the record", () => {
    expect(s.decisionLog[0]).toMatchObject({ injectId: "inj1", team: "Executive", owner: "Chief executive", decision: "Isolate the affected systems now.", kind: "decision" });
    expect(s.decisionLog[0].split).toEqual({ "Isolate the affected systems now.": 2, "Wait and watch.": 1 });
    // Names become roles in report text.
    expect(s.parkingLot).toEqual(["Ask General Counsel about cyber insurance limits."]);
    expect(s.methodology.text).toContain("Crisis Sim");
    expect(s.methodology.text).toContain("HSEEP");
    expect(s.methodology.text).toContain("Evaluators and facilitators wrote the executive summary, strengths and areas for improvement.");
    expect(Object.keys(s.methodology)).toEqual(["text"]);
    // The narrative starts empty: people write it.
    expect(s.executiveSummary).toBe("");
    expect(s.analysis.every((a) => a.strengths.length === 0 && a.afis.length === 0)).toBe(true);
  });

  it("maps AFI control references to gaps and rubric controls to tested", () => {
    const analysis = structuredClone(s.analysis);
    analysis[1].afis.push({
      id: "afi_1",
      title: "Insurer notice owner unclear",
      observation: "",
      analysis: "",
      recommendation: "",
      capabilityKey: "RS.CO",
      references: [{ type: "control", ref: "nist-csf:RS.MA-01" }],
      evidence: [],
      actionItemId: null,
      rejectedReason: null,
      status: "proposed",
      decision: null,
      review: null,
      sources: [],
      mergedFrom: [],
    });
    const mapping = buildControlMapping(analysis, { frameworks: ["nist-csf"], testedControls: [{ framework: "nist-csf", controlId: "DE.AE-08", title: "Incident declaration" }] });
    expect(mapping).toEqual([
      { framework: "nist-csf", controlId: "DE.AE-08", title: "Incident declaration", status: "tested", afiIds: [] },
      { framework: "nist-csf", controlId: "RS.MA-01", title: "Plan executed with third parties", status: "gap", afiIds: ["afi_1"] },
    ]);
  });
  it("lists ATT&CK techniques exercised after the controls", () => {
    const techniques = techniquesExercised([
      { secret: { attackTechniques: ["T1486", "T9999"] } },
      { secret: {}, templateSecret: { attackTechniques: ["T1078"] } },
      { secret: { mitreTags: ["T1486", "T1566.004"] } },
    ]);
    expect(techniques.map((t) => t.id)).toEqual(["T1486", "T1078", "T1566.004"]);
    const mapping = buildControlMapping([], { frameworks: [], testedControls: [], techniquesExercised: techniques });
    expect(mapping[0]).toEqual({ framework: ATTACK_FRAMEWORK, controlId: "T1486", title: "Data Encrypted for Impact", status: "tested", afiIds: [] });
    expect(controlResultLabel(mapping[0])).toBe("Technique exercised");
    expect(controlResultLabel({ framework: "nist-csf", status: "tested" })).toBe("Tested");
  });
});

describe("names to roles", () => {
  const people = fixtureInputs().roster.map((p) => ({ participantId: p.participantId, name: p.name, aliases: p.aliases, title: p.title, team: p.team, roles: p.roles }));
  const replace = makeNameReplacer(people);

  it("replaces full names, aliases, swapped names and unique first names", () => {
    expect(replace("Dana Lee briefed the board. Samuel Ortiz agreed.")).toBe("General Counsel briefed the board. CISO agreed.");
    expect(replace("Lee, Dana will call outside counsel.")).toBe("General Counsel will call outside counsel.");
    expect(replace("Dana said Sam had the backups.")).toBe("General Counsel said CISO had the backups.");
    expect(replace("Riley Park escalated.")).toBe("Technical team member escalated.");
    expect(replace("Fran Facilitator paused.")).toBe("Lead facilitator paused.");
  });
  it("leaves ordinary words alone", () => {
    expect(replace("We will park the sample for later.")).toBe("We will park the sample for later.");
  });
});

describe("evidence from the record", () => {
  it("offers observations, answers and decisions with their row ids", () => {
    const opts = evidenceOptions(fixtureInputs());
    expect(opts.map((o) => [o.kind, o.sourceId])).toEqual(expect.arrayContaining([["observation", "o1"], ["answer", "r1"]]));
    const o1 = opts.find((o) => o.sourceId === "o1")!;
    expect(o1.context).toContain("Inject 2");
    expect(evidenceFromOption(o1)).toEqual({ kind: "observation", sourceId: "o1", quote: "The team did not know who calls the insurer.", at: "2026-10-20T14:55:00.000Z", speakerRole: "Evaluator" });
    expect(opts.some((o) => o.kind === "event")).toBe(true);
  });
});

describe("edits and refresh", () => {
  const inputs = fixtureInputs();
  const base = buildDeterministicSections(inputs);

  it("validates the whole report after a path edit", () => {
    const next = applySectionEdit(base, "overview", "hazard", "Ransomware and data theft");
    expect(next.overview.hazard).toBe("Ransomware and data theft");
    expect(() => applySectionEdit(base, "overview", "durationMin", "long")).toThrow(AarEditError);
    expect(() => applySectionEdit(base, "analysis", "0.__proto__.x", 1)).toThrow(AarEditError);
    expect(() => applySectionEdit(base, "analysis", "9.afis", [])).toThrow(AarEditError);
    const appended = applySectionEdit(base, "parkingLot", String(base.parkingLot.length), "New item");
    expect(appended.parkingLot.at(-1)).toBe("New item");
  });

  it("appends edit log entries and tracks origin per section", () => {
    let log: EditLogEntry[] = [];
    log = appendEditLog(log, { section: "executiveSummary", origin: "human", byUserId: "u1", path: "executiveSummary" });
    log = appendEditLog(log, { section: "decisionLog", origin: "system", byUserId: null });
    log = appendEditLog(log, { section: "roster", origin: "human", byUserId: "u1" });
    log = appendEditLog(log, { section: "roster", origin: "system", byUserId: null, path: "roster.attendance" });
    const origins = sectionOrigins(log);
    expect(origins.executiveSummary).toBe("human");
    expect(origins.decisionLog).toBe("system");
    // A narrow system refresh does not take a section back from a person.
    expect(origins.roster).toBe("human");
    expect(sectionsToRegenerate(log, { sections: ["decisionLog", "roster"] })).toEqual(["decisionLog"]);
    expect(sectionsToRegenerate(log, { sections: ["roster"], force: true })).toEqual(["roster"]);
  });

  it("refuses rating changes through the report text", () => {
    const next = structuredClone(base);
    next.analysis[0] = { ...next.analysis[0], rating: "P" };
    expect(protectedFieldChange(base, next)).toMatch(/ratings page/);
    const ok = applySectionEdit(base, "executiveSummary", null, "Containment was fast.");
    expect(protectedFieldChange(base, ok)).toBeNull();
  });

  it("refreshes record sections and follows the findings in the control mapping", () => {
    const current = structuredClone(base);
    current.analysis[1].afis.push({
      id: "afi_x",
      title: "Insurer owner unclear",
      observation: "Nobody owned the call.",
      analysis: "The plan has no owner.",
      recommendation: "Name one.",
      capabilityKey: null,
      references: [{ type: "control", ref: "nist-csf:RS.MA-01" }],
      evidence: [],
      actionItemId: null,
      rejectedReason: null,
      status: "proposed",
      decision: null,
      review: null,
      sources: [],
      mergedFrom: [],
    });
    const fresh = recordSections(inputs, current);
    expect(fresh.roster).toEqual(base.roster);
    expect(fresh.controlMapping?.find((c) => c.controlId === "RS.MA-01")).toMatchObject({ status: "gap", afiIds: ["afi_x"] });
    expect("executiveSummary" in fresh).toBe(false);
    expect("analysis" in fresh).toBe(false);
  });
});
