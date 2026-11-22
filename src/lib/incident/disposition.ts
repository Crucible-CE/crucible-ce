// Incident closure dispositions + false-positive reason categories.
// Following SOC best practice: a closed incident carries a classification, and
// false positives record WHY so detection rules can be tuned (FP feeds back into
// engineering). Shared by the API and UI so the codes stay aligned.

// Matches the schema comment on Incident.closureDisposition.
export const DISPOSITIONS = ["true_positive", "false_positive", "benign"] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export const DISPOSITION_LABELS: Record<Disposition, string> = {
  true_positive: "True positive (real incident)",
  false_positive: "False positive",
  benign: "Benign / authorized activity",
};

// Why an alert/incident was a false positive — drives detection tuning + FP-rate
// metrics. Order roughly by frequency in a real SOC.
export const FALSE_POSITIVE_REASONS = [
  { code: "benign_expected", label: "Benign / expected activity" },
  { code: "authorized_activity", label: "Authorized activity (admin, pentest, vendor)" },
  { code: "test_or_simulation", label: "Test or simulation traffic" },
  { code: "misconfiguration", label: "Detection misconfiguration (needs tuning)" },
  { code: "duplicate", label: "Duplicate of another incident" },
  { code: "no_indicators", label: "No indicators of compromise found" },
  { code: "other", label: "Other" },
] as const;

export const FP_REASON_CODES = FALSE_POSITIVE_REASONS.map((r) => r.code);

export function fpReasonLabel(code: string | null | undefined): string {
  return FALSE_POSITIVE_REASONS.find((r) => r.code === code)?.label ?? code ?? "Unknown";
}
