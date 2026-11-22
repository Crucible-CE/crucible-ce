// Source document kinds. Pure, safe for client components.

export const DOCUMENT_KINDS = ["playbook", "bcp_dr", "crisis_comm", "threat_briefing", "sop", "policy", "other"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  playbook: "Playbook",
  bcp_dr: "BCP or DR plan",
  crisis_comm: "Crisis communications plan",
  threat_briefing: "Threat briefing",
  sop: "SOP",
  policy: "Policy",
  other: "Other",
};

export function isDocumentKind(v: unknown): v is DocumentKind {
  return typeof v === "string" && (DOCUMENT_KINDS as readonly string[]).includes(v);
}

export function documentKindLabel(kind: string): string {
  return isDocumentKind(kind) ? DOCUMENT_KIND_LABELS[kind] : "Other";
}
