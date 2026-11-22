// Client shapes for the AAR page (GET /api/exercises/{id}/aar).

import type { AarSectionKey, AarSections, EditLogEntry } from "@/lib/exercise/aar/schema";
import type { EvidenceOption } from "@/lib/exercise/aar/evidence";

export type { AarSectionKey, AarSections, EditLogEntry, EvidenceOption };
export type SectionOrigin = "human" | "system";

export interface AarSummary {
  id: string;
  version: number;
  status: "draft" | "review" | "final" | string;
  sections: AarSections | null;
  editLog: EditLogEntry[];
  origins: Record<AarSectionKey, SectionOrigin | null>;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  finalizedAt: string | null;
  isLatest: boolean;
  editable: boolean;
  /** Draft only: review freezes the content for signing. */
  contentEditable: boolean;
  meeting: { aamAt: string | null; aamAttendees: string; ipAgreedAt: string | null };
  signatureCount: number;
  amendReason: string | null;
  previous: { id: string; version: number; contentHash: string | null } | null;
}

export interface AarTracker {
  hotwash: number;
  ratings: { done: number; total: number };
  feedback: { responses: number; participants: number };
  attendance: { confirmed: number; total: number };
  draft: boolean;
  meeting: boolean;
  final: boolean;
}

export interface AarPageData {
  exercise: { id: string; title: string; mode: string; status: string; isPractice: boolean; timezone: string; startedAt: string | null; endedAt: string | null; scenarioStartAt: string | null };
  reportable: boolean;
  blockedReason: string | null;
  aar: AarSummary | null;
  versions: Array<{ id: string; version: number; status: string; createdAt: string; finalizedAt: string | null }>;
  evidence: EvidenceOption[];
  tracker: AarTracker;
  canDrive: boolean;
}

export const STATUS_LABELS: Record<string, string> = { draft: "Draft", review: "In review", final: "Final" };

export const SECTION_LABELS: Record<AarSectionKey, string> = {
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
