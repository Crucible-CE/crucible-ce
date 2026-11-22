import { describe, expect, it } from "vitest";
import { BUILD_GUIDE_COPY } from "@/components/templates/build-guide-dialog";
import { DEFAULT_THRESHOLDS } from "@/lib/exercise/modes/crisissim/schema";
import { CONDITION_LABELS } from "@/lib/exercise/studio/conditions";
import { CRISISSIM_SEED_TEMPLATES, RANSOMWARE_TEMPLATE_ID } from "@/lib/exercise/templates/crisissim-seed-data";
import { STRATEGIC_SEED_TEMPLATES } from "@/lib/exercise/strategic/seed-data";
import { CRISISSIM_STEPS, buildCrisisSimPrompt, type CrisisSimPromptInput } from "./crisissim-prompt";
import { CRISISSIM_LABELS, QUALITY_LABELS, STRATEGIC_LABELS } from "./labels";
import { PLACEHOLDERS } from "./prompt-parts";
import { STRATEGIC_STEPS, buildStrategicPrompt, type StrategicPromptInput } from "./strategic-prompt";

const DASHES = /[–—]/;

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A line that starts with the label, as a heading or a "Label:" field. */
function hasHeading(prompt: string, label: string): boolean {
  return new RegExp(`^\\s*${escape(label)}(:| \\d|$)`, "m").test(prompt);
}

function ransomwareInput(injectCount?: number): CrisisSimPromptInput {
  const t = CRISISSIM_SEED_TEMPLATES.find((x) => x.id === RANSOMWARE_TEMPLATE_ID)!;
  return {
    title: t.title,
    summary: t.summary,
    orgName: t.config.orgName,
    executiveBrief: t.config.executiveBriefMd,
    teams: t.config.teams,
    thresholds: t.config.pathThresholds ?? DEFAULT_THRESHOLDS,
    targetDurationMin: t.config.targetDurationMin,
    anchor: t.config.scenarioAnchor,
    clocks: t.config.regulatoryClocks ?? [],
    objectives: t.objectives,
    injects: t.injects,
    injectCount: injectCount ?? t.injects.length,
  };
}

const EMPTY_CS: CrisisSimPromptInput = {
  title: "",
  teams: [],
  thresholds: { ...DEFAULT_THRESHOLDS },
  clocks: [],
  objectives: [],
  injects: [],
  injectCount: 6,
};

function strategicInput(): StrategicPromptInput {
  const t = STRATEGIC_SEED_TEMPLATES[0];
  const cfg = t.config as {
    teams: string[];
    regulatoryClocks?: Array<{ key: string; label: string; durationHours?: number; businessDays?: number }>;
    scenarioAnchor?: { weekday: number; time: string };
    targetDurationMin?: number;
    executiveBriefMd?: string;
    scenario?: { crisisType?: string };
  };
  return {
    title: t.title,
    summary: t.summary,
    executiveBrief: cfg.executiveBriefMd,
    crisisType: cfg.scenario?.crisisType,
    teams: cfg.teams,
    targetDurationMin: cfg.targetDurationMin,
    anchor: cfg.scenarioAnchor,
    clocks: cfg.regulatoryClocks ?? [],
    objectives: t.objectives,
    injects: t.injects,
    injectCount: t.injects.length,
  };
}

const EMPTY_ST: StrategicPromptInput = { title: "", teams: [], clocks: [], objectives: [], injects: [], injectCount: 5 };

describe("Crisis Sim build prompt", () => {
  it("uses what the editor already has", () => {
    const input = ransomwareInput();
    const p = buildCrisisSimPrompt(input);
    expect(p).toContain("Title: Ransomware decision sim");
    expect(p).toContain(`Summary: ${input.summary}`);
    expect(p).toContain("Organization name used in the exercise: Harbor Point Logistics");
    expect(p).toContain(`Teams: ${input.teams.join(", ")}`);
    expect(p).toContain("Start day and time: Monday 05:40");
    expect(p).toContain("Target minutes: 45");
    expect(p).toContain(`Injects to draft: ${input.injects.length}`);
    expect(p).toContain("- SEC Form 8-K Item 1.05 (4 business days)");
    expect(p).toContain("- State attorney general notice (30 days)");
    expect(p).toContain(`- o1: ${input.objectives[0].text}`);
    expect(p).toContain("Harbor Point Logistics is a publicly traded freight");
    expect(p).toContain("1. Detection, scenario minute 0");
    expect(p).toContain(`Repeat from Inject 1 for Inject 2 to Inject ${input.injects.length}.`);
    expect(p).toContain("90 (T+1h 30m, Monday 07:10)");
  });

  it("takes the count the facilitator types", () => {
    const p = buildCrisisSimPrompt(ransomwareInput(8));
    expect(p).toContain("Injects to draft: 8");
    expect(p).toContain("Write exactly 8 injects.");
    expect(buildCrisisSimPrompt({ ...EMPTY_CS, injectCount: 0 })).toContain("Injects to draft: 6");
    expect(buildCrisisSimPrompt({ ...EMPTY_CS, injectCount: 500 })).toContain("Injects to draft: 30");
  });

  it("leaves placeholders for what is missing", () => {
    const p = buildCrisisSimPrompt(EMPTY_CS);
    for (const ph of Object.values(PLACEHOLDERS)) expect(p).toContain(ph);
    expect(p).toContain("Start day and time: Not set.");
    expect(p).toContain("Objectives: none yet.");
    expect(p).toContain("Regulatory clocks: none picked yet.");
    expect(p).not.toContain("Summary:  ");
    expect(p).not.toContain("Injects already in the editor");
    // The facilitator still adds these when the template is filled in.
    const full = buildCrisisSimPrompt(ransomwareInput());
    for (const ph of [PLACEHOLDERS.org, PLACEHOLDERS.threat, PLACEHOLDERS.avoid]) expect(full).toContain(ph);
    expect(full).not.toContain(PLACEHOLDERS.title);
  });

  it("asks for every editor field, by its editor label, in editor order", () => {
    const p = buildCrisisSimPrompt(ransomwareInput());
    const format = p.slice(p.indexOf("OUTPUT FORMAT"));
    const order = [
      CRISISSIM_LABELS.scenario,
      CRISISSIM_LABELS.title,
      CRISISSIM_LABELS.summary,
      CRISISSIM_LABELS.thresholdOptimal,
      CRISISSIM_LABELS.thresholdCritical,
      CRISISSIM_LABELS.targetMinutes,
      CRISISSIM_LABELS.startDay,
      CRISISSIM_LABELS.startTime,
      CRISISSIM_LABELS.executiveBrief,
      CRISISSIM_LABELS.teams,
      CRISISSIM_LABELS.clocks,
      CRISISSIM_LABELS.objectives,
      CRISISSIM_LABELS.inject,
      CRISISSIM_LABELS.scenarioMinutes,
      CRISISSIM_LABELS.plannedMinutes,
      CRISISSIM_LABELS.targetTeams,
      CRISISSIM_LABELS.injectClocks,
      CRISISSIM_LABELS.attackTags,
      CRISISSIM_LABELS.narrative,
      CRISISSIM_LABELS.consequence,
      CRISISSIM_LABELS.artifacts,
      CRISISSIM_LABELS.kind,
      CRISISSIM_LABELS.from,
      CRISISSIM_LABELS.text,
      CRISISSIM_LABELS.questions,
      CRISISSIM_LABELS.team,
      CRISISSIM_LABELS.question,
      CRISISSIM_LABELS.decisionOwner,
      CRISISSIM_LABELS.type,
      CRISISSIM_LABELS.discussionPrompt,
      CRISISSIM_LABELS.options,
      CRISISSIM_LABELS.followUp,
      CRISISSIM_LABELS.rationale,
      CRISISSIM_LABELS.expectedActions,
      CRISISSIM_LABELS.writtenTask,
      CRISISSIM_LABELS.prompt,
      CRISISSIM_LABELS.gradingCriteria,
    ];
    let at = 0;
    for (const label of order) {
      expect(hasHeading(format, label), label).toBe(true);
      const m = new RegExp(`^\\s*${escape(label)}(:| \\d|$)`, "m").exec(format.slice(at));
      expect(m, `${label} after the previous field`).not.toBeNull();
      at += m!.index + 1;
    }
    for (const path of ["On track", "Under strain", "Escalating"]) expect(hasHeading(format, path)).toBe(true);
    for (const q of Object.values(QUALITY_LABELS)) expect(p).toContain(q);
  });

  it("states the rules", () => {
    const p = buildCrisisSimPrompt(ransomwareInput());
    expect(p).toContain("Return only the editor inputs");
    expect(p).toContain("at least one option rated Intended +2 or Defensible +1 on every path");
    expect(p).toContain("The best option must not be the only long or multi-step one.");
    expect(p).toContain("Do not use real company or person names.");
    expect(p).toContain("four business days after the company determines the incident is material");
    expect(p).toContain("GDPR Art. 33");
    expect(p).toContain("OFAC");
    expect(p).toContain(`Keep ${CRISISSIM_LABELS.thresholdOptimal} 4 and ${CRISISSIM_LABELS.thresholdCritical} -3 unless I say otherwise.`);
    expect(p).toContain("Only an option can start these clocks: SEC Form 8-K Item 1.05.");
    expect(p).toContain("Cyber insurer notice, State attorney general notice. An option can only meet them.");
  });
});

describe("Strategic TTX build prompt", () => {
  it("uses what Studio already has", () => {
    const input = strategicInput();
    const p = buildStrategicPrompt(input);
    expect(p).toContain(`Title: ${input.title}`);
    expect(p).toContain(`Teams: ${input.teams.join(", ")}`);
    expect(p).toContain(`Injects to draft: ${input.injectCount}`);
    if (input.crisisType) {
      expect(p).toContain(`Threat or crisis: ${input.crisisType}`);
      expect(p).not.toContain(PLACEHOLDERS.threat);
    }
    for (const c of input.clocks) expect(p).toContain(c.label);
    expect(p).toContain(`1. ${input.injects[0].title}, scenario minute`);
  });

  it("leaves placeholders for what is missing", () => {
    const p = buildStrategicPrompt(EMPTY_ST);
    for (const ph of Object.values(PLACEHOLDERS)) expect(p).toContain(ph);
    expect(p).toContain("Injects to draft: 5");
    expect(p).toContain("Teams: Not set.");
  });

  it("asks for every Studio field, by its Studio label, in Studio order", () => {
    const p = buildStrategicPrompt(strategicInput());
    const format = p.slice(p.indexOf("OUTPUT FORMAT"));
    const order = [
      STRATEGIC_LABELS.templateTab,
      STRATEGIC_LABELS.title,
      STRATEGIC_LABELS.summary,
      STRATEGIC_LABELS.startDay,
      STRATEGIC_LABELS.startTime,
      STRATEGIC_LABELS.targetMinutes,
      STRATEGIC_LABELS.executiveBrief,
      STRATEGIC_LABELS.teams,
      STRATEGIC_LABELS.objectives,
      STRATEGIC_LABELS.clocks,
      STRATEGIC_LABELS.inject,
      STRATEGIC_LABELS.scenarioMinute,
      STRATEGIC_LABELS.plannedMinutes,
      STRATEGIC_LABELS.endNode,
      STRATEGIC_LABELS.phase,
      STRATEGIC_LABELS.narrative,
      STRATEGIC_LABELS.artifacts,
      STRATEGIC_LABELS.from,
      STRATEGIC_LABELS.sentAt,
      STRATEGIC_LABELS.teams,
      STRATEGIC_LABELS.teamSees,
      STRATEGIC_LABELS.questions,
      STRATEGIC_LABELS.expectedActions,
      STRATEGIC_LABELS.clockUpdates,
      STRATEGIC_LABELS.gradingNotes,
      STRATEGIC_LABELS.mitreTags,
      STRATEGIC_LABELS.branchesTab,
      STRATEGIC_LABELS.goTo,
      STRATEGIC_LABELS.condition,
    ];
    let at = 0;
    for (const label of order) {
      const m = new RegExp(`^\\s*${escape(label)}(:| \\d|$)`, "m").exec(format.slice(at));
      expect(m, `${label} after the previous field`).not.toBeNull();
      at += m!.index + 1;
    }
    for (const c of ["default", "always", "team_outcome", "score_below", "score_at_least"] as const) expect(p).toContain(CONDITION_LABELS[c]);
    expect(p).not.toContain(CONDITION_LABELS.path);
    expect(p).toContain("Expected actions are hidden from players");
  });
});

describe("Build prompt grounding", () => {
  const reference = { threatActorKey: "qilin", replayKey: "synnovis-2024", industryKey: "healthcare-provider" };

  it("adds the actor, replay and industry to the Crisis Sim prompt", () => {
    const p = buildCrisisSimPrompt({ ...ransomwareInput(), reference });
    const have = p.slice(p.indexOf("WHAT I HAVE SO FAR"), p.indexOf("RULES"));
    expect(have).toContain("Threat actor: Qilin. Status: Active as of 2026-06.");
    expect(have).toContain("Actor initial access: T1133 External Remote Services; T1078 Valid Accounts; T1566 Phishing");
    expect(have).toContain("Actor top techniques (MITRE ATT&CK):\n- T1133 External Remote Services");
    expect(have).toContain("- T1484.001 Domain or Tenant Policy Modification: Group Policy Modification");
    expect(have.match(/^- T\d{4}/gm)?.length).toBe(10);
    expect(have).toContain("Replay: Synnovis pathology ransomware (2024).");
    expect(have).toContain("T+0h (2024-06-03): Qilin attacks Synnovis.");
    expect(have).toContain("Replay key decisions:\n- Hospitals depend on you for blood tests.");
    expect(have).toContain("Industry profile: Healthcare provider. North Valley Care Network");
    expect(have).toContain("Organization profile: North Valley Care Network, from the industry profile below");
    expect(have).toContain("Threat or crisis: Qilin, following the replay below");
    expect(have).not.toContain(PLACEHOLDERS.org);
    expect(have).not.toContain(PLACEHOLDERS.threat);
    const rules = p.slice(p.indexOf("\nRULES\n"), p.lastIndexOf("OUTPUT FORMAT"));
    expect(rules).toContain("The scenario must stay consistent with how Qilin really operates");
    expect(rules).toContain("Do not name the real victim.");
    expect(rules).toContain(`${CRISISSIM_LABELS.attackTags} are hidden from players`);
  });

  it("tells the tool when the actor is not active", () => {
    const p = buildStrategicPrompt({ ...strategicInput(), reference: { threatActorKey: "hive" } });
    expect(p).toContain("Status: Defunct as of 2023-01-26.");
    expect(p).toContain("Hive is defunct in public reporting.");
    expect(p).toContain("The scenario must stay consistent with how Hive really operates");
    expect(p).toContain("Prefer the actor techniques listed above.");
  });

  it("adds nothing when no pick is set or a key is unknown", () => {
    const base = buildStrategicPrompt(strategicInput());
    expect(buildStrategicPrompt({ ...strategicInput(), reference: { threatActorKey: "unknown", replayKey: null } })).toBe(base);
    expect(base).not.toContain("Threat actor:");
    expect(base).not.toContain("must stay consistent");
  });

  it("keeps library text free of em and en dashes", () => {
    const keys = { threatActorKey: "storm-0501", replayKey: "stryker-2026", industryKey: "saas" };
    expect(buildCrisisSimPrompt({ ...EMPTY_CS, reference: keys })).not.toMatch(DASHES);
    expect(buildStrategicPrompt({ ...EMPTY_ST, reference: keys })).not.toMatch(DASHES);
  });
});

describe("How to build this copy", () => {
  it("has no em or en dashes", () => {
    const ui = [
      ...Object.values(BUILD_GUIDE_COPY).map((v) => (typeof v === "function" ? v("Crisis Sim") : v)),
      ...CRISISSIM_STEPS,
      ...STRATEGIC_STEPS,
    ];
    for (const line of ui) expect(line, line).not.toMatch(DASHES);
    expect(buildCrisisSimPrompt(ransomwareInput())).not.toMatch(DASHES);
    expect(buildCrisisSimPrompt(EMPTY_CS)).not.toMatch(DASHES);
    expect(buildStrategicPrompt(strategicInput())).not.toMatch(DASHES);
    expect(buildStrategicPrompt(EMPTY_ST)).not.toMatch(DASHES);
  });

  it("keeps UI lines to one short sentence where it says so", () => {
    for (const k of ["trigger", "description", "brackets", "copied", "copyFailed"] as const) {
      expect(BUILD_GUIDE_COPY[k].length).toBeLessThan(80);
    }
  });
});

