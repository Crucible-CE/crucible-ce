// AAR fixtures for tests: HSEEP sections and a signed-document shape.
import type { AarSections } from "./schema";
import type { SignedAarDocument } from "./document";

/** Review fields of a finding nobody has decided yet. */
const PROPOSED = { status: "proposed" as const, decision: null, review: null, sources: [{ kind: "written" as const, sourceId: null }], mergedFrom: [] };

export function fixtureSections(objectives: Array<{ id: string; text: string }> = [{ id: "obj1", text: "Decide on containment within the first hour." }]): AarSections {
  return {
    schemaVersion: 1,
    overview: {
      name: "Fixture ransomware drill",
      mode: "crisissim",
      startedAt: "2026-03-04T14:00:00.000Z",
      endedAt: "2026-03-04T16:00:00.000Z",
      durationMin: 120,
      timezone: "America/New_York",
      scope: "Corporate IT and executive team.",
      missionAreas: ["Response"],
      hazard: "Ransomware on file servers.",
      scenarioSummary: "A crew encrypts file servers on a Friday evening.",
      sponsor: "Chief Operating Officer",
      participatingOrganizations: ["IT", "Legal", "Communications"],
      pointsOfContact: ["Exercise director"],
      sourceDocument: null,
      plansExercised: [{ title: "Incident response plan", version: "3.1", date: "2026-01-15", owner: "Security", sha256: null }],
      requirements: [{ framework: "pci-dss", controlId: "12.10.2", title: "Incident response plan reviewed and tested annually" }],
    },
    executiveSummary: "The team contained the incident quickly. Notification decisions were late.",
    analysis: objectives.map((o, i) => ({
      objectiveId: o.id,
      objectiveText: o.text,
      capabilityKeys: ["RS.MA"],
      rating: "S" as const,
      ratingSource: "evaluator" as const,
      ratingRationale: "Containment started within 40 minutes.",
      notEvaluated: false,
      strengths: [{ id: `s${i + 1}`, text: "Isolation runbook used.", evidence: [{ kind: "observation" as const, sourceId: "obs1", quote: "We isolate the file servers now.", at: "2026-03-04T14:12:00.000Z", speakerRole: "IT lead" }] }],
      afis: [
        {
          id: `afi${i + 1}a`,
          title: "Legal was briefed late",
          observation: "Legal joined after 90 minutes.",
          analysis: "The call tree skips legal.",
          recommendation: "Add legal to the first call tree.",
          capabilityKey: "RS.CO",
          references: [{ type: "control" as const, ref: "pci-dss:12.10.1", label: "PCI DSS 12.10.1" }],
          evidence: [{ kind: "answer" as const, sourceId: "resp2", quote: "Has anyone told legal yet?", at: "2026-03-04T15:30:00.000Z", speakerRole: "General counsel" }],
          actionItemId: null,
          rejectedReason: null,
          ...PROPOSED,
        },
        {
          id: `afi${i + 1}b`,
          title: "Backups not verified",
          observation: "Nobody checked backup integrity.",
          analysis: "No owner for backup checks.",
          recommendation: "Assign backup verification to IT operations.",
          capabilityKey: "RC.RP",
          references: [],
          evidence: [],
          actionItemId: null,
          rejectedReason: null,
          ...PROPOSED,
        },
      ],
    })),
    decisionLog: [
      { injectId: "inj1", seq: 1, scenarioTime: "2026-03-06T22:30:00.000Z", team: "Executive", owner: "Chief executive", question: "First move?", decision: "Isolate now.", split: { a: 3, b: 1 }, kind: "decision" },
    ],
    clocks: [
      { key: "sec_8k", label: "SEC Form 8-K Item 1.05", status: "met", triggeredAt: "2026-03-06T23:00:00.000Z", deadlineAt: "2026-03-12T23:00:00.000Z", metAt: "2026-03-10T15:00:00.000Z", statement: "Filed within 4 business days." },
    ],
    controlMapping: [
      { framework: "pci-dss", controlId: "12.10.1", title: "Incident response plan in place", status: "gap", afiIds: ["afi1a"] },
      { framework: "nist-csf", controlId: "RS.MA", title: "Incident Management", status: "tested", afiIds: [] },
    ],
    methodology: { text: "Facilitated discussion. Evaluators wrote the findings." },
    roster: [
      { participantId: "p1", name: "Fran Facilitator", title: "Exercise director", organization: "IT", team: null, roles: ["lead_facilitator"], guest: false, joinedAt: "2026-03-04T13:55:00.000Z", leftAt: null, attendance: "attended" as const, noDevice: false },
      { participantId: "p2", name: "Guest Player", title: "General counsel", organization: "Legal", team: "Executive", roles: ["player"], guest: true, joinedAt: "2026-03-04T13:58:00.000Z", leftAt: "2026-03-04T16:00:00.000Z", attendance: "partial" as const, noDevice: false },
    ],
    requiredRoles: [
      { role: "Legal", present: true },
      { role: "Communications", present: false },
    ],
    parkingLot: ["Cyber insurance notice terms."],
    unassignedFindings: [],
  };
}

export function fixtureDocument(): SignedAarDocument {
  return {
    schemaVersion: 1,
    exercise: { id: "ex1", title: "Fixture ransomware drill", mode: "crisissim", startedAt: "2026-03-04T14:00:00.000Z", endedAt: "2026-03-04T16:00:00.000Z" },
    aar: { id: "aar1", version: 1, previousId: null, sections: fixtureSections() },
    actionItems: [
      {
        id: "ai1",
        capabilityId: "cap1",
        capabilityKey: "RS.CO",
        capabilityName: "Incident Response Reporting and Communication",
        objectiveId: "obj1",
        objectiveText: "Decide on containment within the first hour.",
        afiId: "afi1a",
        afi: "Legal was briefed late",
        correctiveAction: "Add legal to the first call tree.",
        poete: "planning",
        responsibleOrg: "Security",
        poc: "IR manager",
        pocEmail: "ir@example.test",
        startDate: "2026-03-10T00:00:00.000Z",
        dueDate: "2026-05-01T00:00:00.000Z",
        status: "open",
        priority: "high",
        closureEvidence: null,
        rejectedReason: null,
        createdAt: "2026-03-05T00:00:00.000Z",
      },
    ],
    signers: [
      { role: "facilitator", name: "Fran Facilitator", title: "Exercise director", signedAt: "2026-03-08T12:00:00.000Z", userId: "u1" },
      { role: "sponsor", name: "Sam Sponsor", title: "Chief Operating Officer", signedAt: "2026-03-09T12:00:00.000Z", userId: null, enteredBy: { userId: "u1", name: "Fran Facilitator" } },
    ],
    generatedAt: "2026-03-09T12:00:00.000Z",
  };
}
