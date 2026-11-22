// Helpers shared by the healthcare Strategic TTX templates.

import type { SeedVariant } from "@/lib/exercise/strategic/seed-data";

export const standby = (team: string, narrativeMd: string): SeedVariant => ({ team, status: "standby", narrativeMd, questions: [] });

export const active = (team: string, narrativeMd: string, questions: string[]): SeedVariant => ({
  team,
  status: "active",
  narrativeMd,
  questions: questions.map((text, i) => ({ key: `q${i + 1}`, text })),
});

/** Known, unknown and assumed facts as a Markdown block. */
export function kua(known: string[], unknown: string[], assumed: string[] = []): string {
  const out = ["**Known**", ...known.map((k) => `- ${k}`), "", "**Unknown**", ...unknown.map((k) => `- ${k}`)];
  if (assumed.length) out.push("", "**Assumed**", ...assumed.map((k) => `- ${k}`));
  return out.join("\n");
}
