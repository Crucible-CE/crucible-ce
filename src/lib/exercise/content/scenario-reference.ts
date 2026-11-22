// Scenario reference: the threat actor, replay and industry profile a
// template is written against. Resolves the keys stored in template config
// and shapes them for the editor's Reference card and the build prompt. Pure.

import { getTechnique, getTechniqueFullName, normalizeTechniqueId } from "./mitre";
import { getIndustryTemplate, type IndustryTemplate } from "./industries";
import { getReplay, type Replay } from "./replays";
import { getThreatActor, type ThreatActor } from "./threat-actors";

export interface ScenarioReferenceKeys {
  threatActorKey?: string | null;
  replayKey?: string | null;
  industryKey?: string | null;
}

export interface ScenarioReference {
  actor: ThreatActor | null;
  replay: Replay | null;
  industry: IndustryTemplate | null;
}

export interface TechniqueRef {
  id: string;
  name: string;
}

export function resolveScenarioReference(keys: ScenarioReferenceKeys): ScenarioReference {
  return {
    actor: keys.threatActorKey ? (getThreatActor(keys.threatActorKey) ?? null) : null,
    replay: keys.replayKey ? (getReplay(keys.replayKey) ?? null) : null,
    industry: keys.industryKey ? (getIndustryTemplate(keys.industryKey) ?? null) : null,
  };
}

export function hasReference(r: ScenarioReference): boolean {
  return Boolean(r.actor || r.replay || r.industry);
}

/** Technique IDs with catalog names. Unknown IDs are dropped. */
export function techniqueRefs(ids: readonly string[]): TechniqueRef[] {
  const out: TechniqueRef[] = [];
  for (const raw of ids) {
    const id = normalizeTechniqueId(raw);
    const name = id ? getTechniqueFullName(id) : undefined;
    if (id && name && !out.some((t) => t.id === id)) out.push({ id, name });
  }
  return out;
}

/** The actor's first techniques in library order, which lists the most typical first. */
export function topTechniques(actor: ThreatActor, n = 10): TechniqueRef[] {
  return techniqueRefs(actor.techniques).slice(0, n);
}

const INITIAL_ACCESS = "TA0001";

/** The actor's techniques in the Initial Access tactic, by catalog name. */
export function initialAccessOf(actor: ThreatActor): TechniqueRef[] {
  return techniqueRefs(actor.techniques).filter((t) => getTechnique(t.id)?.tactics.includes(INITIAL_ACCESS));
}

/** "T1486 Data Encrypted for Impact". */
export function techniqueLine(t: TechniqueRef): string {
  return `${t.id} ${t.name}`;
}

/** "T+36h" style label for a replay timeline offset. */
export function replayOffsetLabel(hours: number): string {
  const h = Math.max(0, Math.round(hours));
  if (h < 48) return `T+${h}h`;
  return `T+${Math.round(h / 24)}d`;
}
