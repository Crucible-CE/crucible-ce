// Field labels the AAR editor shows. The "How to write the AAR" prompt uses
// the same constants, so its headings always match the editor. Pure.

export const AAR_FIELD_LABELS = {
  executiveSummary: "Executive summary",
  objective: "Objective",
  strengths: "Strengths",
  strength: "Strength",
  afis: "Areas for improvement",
  title: "Title",
  observation: "Observation",
  analysis: "Analysis",
  recommendation: "Recommendation",
  capability: "Capability",
  evidence: "Evidence",
} as const;

/** Labels on the Findings tab. */
export const FINDINGS_LABELS = {
  tab: "Findings",
  proposed: "Proposed",
  accepted: "Accepted",
  rejected: "Rejected",
  accept: "Accept",
  reject: "Reject",
  reopen: "Reopen",
  merge: "Merge",
  createAction: "Create work item",
  noAction: "No action needed",
  write: "Write a finding",
  collect: "Check the record",
  objective: "Objective",
  reason: "Reason",
  reference: "Reference",
  details: "Details",
} as const;
