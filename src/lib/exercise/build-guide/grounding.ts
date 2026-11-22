// Grounds the build prompt in the library picks: the threat actor, the
// replay and the industry profile chosen in scenario settings. Pure.

import { ACTOR_STATUS_LABELS } from "@/lib/exercise/content/threat-actors";
import {
  initialAccessOf,
  replayOffsetLabel,
  resolveScenarioReference,
  techniqueLine,
  topTechniques,
  type ScenarioReference,
  type ScenarioReferenceKeys,
} from "@/lib/exercise/content/scenario-reference";
import { bulletList } from "./prompt-parts";

export type { ScenarioReferenceKeys };

/** Lines for WHAT I HAVE SO FAR. Empty when nothing is picked. */
export function groundingLines(ref: ScenarioReference): string[] {
  const out: string[] = [];
  const { actor, replay, industry } = ref;
  if (industry) {
    out.push(
      [
        `Industry profile: ${industry.industry}. ${industry.orgName}, ${industry.size}. Regions: ${industry.regions.join(", ")}.`,
        industry.regulators.length ? `Regulators: ${industry.regulators.join(", ")}.` : "",
        `Crown jewels: ${industry.crownJewels.join(", ")}.`,
        industry.keyVendors.length ? `Key vendors: ${industry.keyVendors.join(", ")}.` : "",
        industry.profileMd.trim(),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  if (actor) {
    const status = `${ACTOR_STATUS_LABELS[actor.status]} as of ${actor.statusAsOf}`;
    const access = initialAccessOf(actor);
    out.push(`Threat actor: ${actor.name}. Status: ${status}.${actor.statusNote ? ` ${actor.statusNote}` : ""}`);
    out.push(`Actor summary: ${actor.summary}`);
    out.push(`Actor initial access: ${access.length ? access.map(techniqueLine).join("; ") : "Not listed in the library."}`);
    out.push(`Actor top techniques (MITRE ATT&CK):\n${bulletList(topTechniques(actor, 10).map(techniqueLine))}`);
    if (actor.typicalImpact.length) out.push(`Actor typical impact: ${actor.typicalImpact.join(", ")}.`);
  }
  if (replay) {
    out.push(`Replay: ${replay.title}. ${replay.summary}`);
    out.push(`Replay initial access: ${replay.initialAccess}`);
    out.push(
      `Replay timeline:\n${bulletList(replay.timeline.map((e) => `${replayOffsetLabel(e.offsetHours)}${e.date ? ` (${e.date})` : ""}: ${e.event}`))}`,
    );
    out.push(`Replay key decisions:\n${bulletList(replay.keyDecisions)}`);
  }
  return out;
}

/** Rules that keep the draft true to the picks. */
export function groundingRules(ref: ScenarioReference): string[] {
  const out: string[] = [];
  if (ref.actor) {
    out.push(
      `The scenario must stay consistent with how ${ref.actor.name} really operates: its initial access, techniques and impact listed above. Do not give it tools or methods it is not known to use.`,
    );
    if (ref.actor.status !== "active") {
      out.push(`${ref.actor.name} is ${ref.actor.status} in public reporting. Present it as a historical pattern or a copycat crew, not as news.`);
    }
  }
  if (ref.replay) {
    out.push("Follow the replay's sequence of events and key decisions, adapted to the organization above. Do not name the real victim.");
  }
  if (ref.industry) {
    out.push(`Write for ${ref.industry.orgName} and use its crown jewels, vendors and regulators from the industry profile.`);
  }
  return out;
}

/** Replaces the hand-filled placeholders when a pick covers them. */
export function groundedContext(ref: ScenarioReference): { org?: string; threat?: string } {
  return {
    ...(ref.industry ? { org: `${ref.industry.orgName}, from the industry profile below` } : {}),
    ...(ref.actor ? { threat: ref.replay ? `${ref.actor.name}, following the replay below` : ref.actor.name } : ref.replay ? { threat: "The replay below" } : {}),
  };
}

export function resolveGrounding(keys: ScenarioReferenceKeys | null | undefined): ScenarioReference {
  return resolveScenarioReference(keys ?? {});
}
