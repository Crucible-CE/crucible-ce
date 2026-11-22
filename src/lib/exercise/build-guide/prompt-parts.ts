// Pieces shared by the Crisis Sim and Strategic TTX build prompts. Pure.

import { REGULATORY_CLOCK_PRESETS } from "@/lib/exercise/content/regulatory-clocks";
import { ARTIFACT_KIND_LABELS, WEEKDAYS, anchoredTime } from "@/lib/exercise/modes/crisissim/schema";
import { clockDuration } from "./labels";

/** What the facilitator fills in before sending. */
export const PLACEHOLDERS = {
  title: "[Title]",
  org: "[Organization profile]",
  threat: "[Threat or crisis]",
  avoid: "[Anything to avoid]",
} as const;

export interface PromptClock {
  key: string;
  label: string;
  durationHours?: number;
  businessDays?: number;
}

export interface PromptAnchor {
  weekday: number;
  time: string;
}

export const MAX_DRAFT_INJECTS = 30;

export function clampCount(n: number, fallback: number): number {
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(MAX_DRAFT_INJECTS, Math.round(n));
}

export function text(v: string | null | undefined): string {
  return typeof v === "string" ? v.trim() : "";
}

export function validAnchor(a: PromptAnchor | null | undefined): PromptAnchor | null {
  if (!a || !/^\d\d:\d\d$/.test(a.time) || !(a.weekday >= 0 && a.weekday <= 6)) return null;
  return a;
}

export function anchorLabel(a: PromptAnchor | null): string {
  return a ? `${WEEKDAYS[a.weekday]} ${a.time}` : "Not set. Pick a weekday and a time that fit the scenario.";
}

/** "T+1h 30m" for a minute offset. */
export function tPlus(min: number): string {
  const m = Math.max(0, Math.round(min));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const r = m % 60;
  const parts = [d ? `${d}d` : "", h ? `${h}h` : "", r || (!d && !h) ? `${r}m` : ""].filter(Boolean);
  return `T+${parts.join(" ")}`;
}

/** Example scenario time for the output format, "90 (T+1h 30m, Monday 07:10)". */
export function timeExample(a: PromptAnchor | null): string {
  return a
    ? `minutes from the start, then the T+ time and the day and time, for example 90 (${tPlus(90)}, ${anchoredTime(a, 90).label})`
    : `minutes from the start, then the T+ time, for example 90 (${tPlus(90)})`;
}

export function clockLine(c: PromptClock): string {
  const d = clockDuration(c);
  return d ? `${c.label} (${d})` : c.label;
}

export function presetClockList(): string {
  return REGULATORY_CLOCK_PRESETS.map((p) => `- ${clockLine(p)}`).join("\n");
}

export function artifactKinds(): string {
  return Object.values(ARTIFACT_KIND_LABELS).join(", ");
}

export function bulletList(items: string[]): string {
  return items.map((i) => `- ${i}`).join("\n");
}

/** Context the facilitator adds by hand, unless a library pick already covers it. */
export function contextLines(threat: string, picked: { org?: string; threat?: string } = {}): string[] {
  return [
    `Organization profile: ${picked.org || PLACEHOLDERS.org}`,
    `Threat or crisis: ${[threat, picked.threat].filter(Boolean).join(". ") || PLACEHOLDERS.threat}`,
    `Anything to avoid: ${PLACEHOLDERS.avoid}`,
  ];
}

export const ACCURACY_RULES = [
  "Do not use real company or person names. Use fictional names or roles.",
  "Keep regulatory facts accurate. SEC Form 8-K Item 1.05 is due four business days after the company determines the incident is material, not four days after discovery. GDPR Art. 33 requires notice to the lead supervisory authority within 72 hours of becoming aware of a personal data breach. A ransom payment raises OFAC sanctions questions, because paying a sanctioned party can be a violation. The ransom decision needs legal review, a sanctions check and contact with law enforcement.",
  "If you are not sure of a regulatory detail, leave it out rather than guess.",
];
