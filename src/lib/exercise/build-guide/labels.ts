// Field labels shared by the template editors and the "How to build this"
// prompts, so a prompt's headings always match what the editor shows. Pure.

import { PATH_LABELS, type Quality, type QuestionType } from "@/lib/exercise/modes/crisissim/schema";

/** Crisis Sim template editor labels, in the order the editor shows them. */
export const CRISISSIM_LABELS = {
  scenario: "Scenario",
  title: "Title",
  summary: "Summary",
  thresholdOptimal: `${PATH_LABELS.optimal} at or above`,
  thresholdCritical: `${PATH_LABELS.critical} below`,
  targetMinutes: "Target minutes",
  startDay: "Start day",
  startTime: "Start time",
  executiveBrief: "Executive brief",
  reference: "Reference",
  threatActor: "Threat actor",
  replay: "Replay",
  industry: "Industry profile",
  teams: "Teams",
  clocks: "Regulatory clocks",
  objectives: "Objectives",
  inject: "Inject",
  scenarioMinutes: "Scenario minutes",
  plannedMinutes: "Planned minutes",
  targetTeams: "Target teams",
  injectClocks: "Clocks that start when this inject opens",
  attackTags: "MITRE ATT&CK tags",
  narrative: "Narrative",
  consequence: "Consequence",
  artifacts: "Artifacts",
  kind: "Kind",
  from: "From",
  text: "Text",
  questions: "Questions",
  question: "Question",
  decisionOwner: "Decision owner",
  type: "Type",
  discussionPrompt: "Discussion prompt",
  options: "Options",
  followUp: "Follow-up",
  rationale: "Rationale",
  expectedActions: "Expected actions",
  writtenTask: "Written task",
  team: "Team",
  prompt: "Prompt",
  gradingCriteria: "Grading criteria",
} as const;

export const QUALITY_LABELS: Record<Quality, string> = {
  great: "Intended +2",
  good: "Defensible +1",
  neutral: "Neutral 0",
  bad: "Off plan -2",
};

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  standard: "Standard",
  materiality: "Materiality",
  ransom: "Ransom",
};

/** What an option does to a regulatory clock. */
export const OPTION_CLOCK_LABELS = { none: "None", trigger: "Starts", met: "Meets" } as const;

/** Scenario Studio labels for Strategic TTX, in the order the Studio shows them. */
export const STRATEGIC_LABELS = {
  templateTab: "Template",
  injectTab: "Inject",
  branchesTab: "Branches",
  checksTab: "Checks",
  title: "Title",
  summary: "Summary",
  scenario: "Scenario",
  startDay: "Start day",
  startTime: "Start time",
  targetMinutes: "Target minutes",
  crisisType: "Crisis type",
  executiveBrief: "Executive brief",
  reference: "Reference",
  threatActor: "Threat actor",
  replay: "Replay",
  industry: "Industry profile",
  teams: "Teams",
  objectives: "Objectives",
  clocks: "Regulatory clocks",
  inject: "Inject",
  scenarioMinute: "Scenario minute",
  plannedMinutes: "Planned minutes",
  endNode: "End node",
  phase: "Phase",
  narrative: "Narrative",
  artifacts: "Artifacts",
  from: "From",
  sentAt: "Sent at",
  teamSees: "What this team sees",
  questions: "Questions",
  expectedActions: "Expected actions",
  clockUpdates: "Clock updates",
  gradingNotes: "Grading notes",
  mitreTags: "MITRE ATT&CK tags",
  goTo: "Go to",
  condition: "Condition",
} as const;

export const PHASE_LABELS = { opening: "Opening", main: "Main", resolution: "Resolution" } as const;

export const VARIANT_STATUS_LABELS = { none: "Not included", active: "Active", standby: "Standby" } as const;

export const CLOCK_UPDATE_LABELS = { none: "No change", trigger: "Start the clock", met: "Mark it met" } as const;

/** "4 business days", "72 hours", "30 days". */
export function clockDuration(c: { durationHours?: number; businessDays?: number }): string {
  if (c.businessDays) return `${c.businessDays} business ${c.businessDays === 1 ? "day" : "days"}`;
  if (c.durationHours) {
    if (c.durationHours >= 48 && c.durationHours % 24 === 0) return `${c.durationHours / 24} days`;
    return `${c.durationHours} ${c.durationHours === 1 ? "hour" : "hours"}`;
  }
  return "";
}
