// Shared labels and formatting for AAR exports (PDF, DOCX, bundle).
import { formatInZone } from "@/lib/exercise/time";

export const SIGNATURE_STATEMENT = "This signature shows the report has not changed since it was signed.";

export const POETE_TEXT: Record<string, string> = {
  planning: "Planning",
  organization: "Organization",
  equipment: "Equipment",
  training: "Training",
  exercise: "Exercise",
};
export const STATUS_TEXT: Record<string, string> = { open: "Open", in_progress: "In progress", done: "Done", rejected: "Rejected" };
export const PRIORITY_TEXT: Record<string, string> = { low: "Low", medium: "Medium", high: "High" };
export const CLOCK_TEXT: Record<string, string> = { pending: "Not started", running: "Running", met: "Met", missed: "Missed", not_applicable: "Not applicable" };
export const ROLE_TEXT: Record<string, string> = {
  lead_facilitator: "Lead facilitator",
  controller: "Controller",
  evaluator: "Evaluator",
  scribe: "Scribe",
  player: "Player",
  observer: "Observer",
};
export const MODE_TEXT: Record<string, string> = { crisissim: "Crisis Sim", document: "Playbook Exercise", strategic: "Strategic TTX" };

/** HSEEP exercise type per mode. */
export const HSEEP_TYPE_TEXT: Record<string, string> = {
  crisissim: "Discussion-based exercise (decision game)",
  document: "Discussion-based tabletop exercise",
  strategic: "Discussion-based tabletop exercise (multi-team)",
};

/** "Crisis Sim. Discussion-based exercise (decision game)" */
export function modeWithType(mode: string): string {
  const name = MODE_TEXT[mode] ?? mode;
  const type = HSEEP_TYPE_TEXT[mode];
  return type ? `${name}. ${type}` : name;
}

export const ATTENDANCE_TEXT: Record<string, string> = { attended: "Attended", partial: "Partial", absent: "Absent" };

export const SECTION_TEXT: Record<string, string> = {
  overview: "Overview",
  executiveSummary: "Executive summary",
  analysis: "Analysis of capabilities",
  decisionLog: "Decision log",
  clocks: "Regulatory clocks",
  controlMapping: "Control mapping",
  methodology: "Methodology",
  roster: "Participants",
  requiredRoles: "Required roles",
  parkingLot: "Parking lot",
  unassignedFindings: "Findings with no objective",
};

/** "From the record, human edited" for one section's provenance. */
export function provenanceText(p: { humanEdited: boolean; fromRecord: boolean }): string {
  const parts = [p.fromRecord ? "From the record" : null, p.humanEdited ? "Human edited" : null].filter(Boolean);
  return parts.length ? parts.join(", ") : "Not recorded";
}

export interface AarRenderMeta {
  instanceName: string;
  timezone: string;
  draft: boolean;
  /** Present for a final version. */
  signature?: { keyId: string; signedAt: string; contentHash: string } | null;
  /** Organization confidentiality marking for the page header. Empty prints nothing. */
  marking?: string;
}

export function fmtTime(iso: string | null | undefined, tz: string): string {
  if (!iso) return "Not recorded";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : formatInZone(d, tz);
}

export function fmtDay(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : "";
}
