"use client";

// Library picks for a template: threat actor, replay and industry profile,
// plus a read-only Reference card the author keeps open while writing
// injects. Shared by the Crisis Sim editor and Scenario Studio.

import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { FieldSelect } from "@/components/form/field-select";
import { SafeMarkdown } from "@/components/markdown/safe-markdown";
import { INDUSTRY_TEMPLATES } from "@/lib/exercise/content/industries";
import { listReplays } from "@/lib/exercise/content/replays";
import { ACTOR_STATUS_LABELS, actorStatusLabel, listThreatActors, type ThreatActor } from "@/lib/exercise/content/threat-actors";
import {
  hasReference,
  replayOffsetLabel,
  resolveScenarioReference,
  topTechniques,
  type ScenarioReferenceKeys,
} from "@/lib/exercise/content/scenario-reference";
import { Field } from "./fields";

export interface LibraryKeys {
  threatActorKey: string | null;
  replayKey: string | null;
  industryKey: string | null;
}

const LABELS = {
  threatActor: "Threat actor",
  replay: "Replay",
  industry: "Industry profile",
  none: "None",
  search: "Search actors",
  showDefunct: "Show defunct",
} as const;

function statusVariant(a: ThreatActor): "success" | "warning" | "outline" {
  if (a.status === "active") return "success";
  if (a.status === "disrupted") return "warning";
  return "outline";
}

function actorMatches(a: ThreatActor, q: string): boolean {
  if (!q) return true;
  const s = q.toLowerCase();
  return a.name.toLowerCase().includes(s) || a.aliases.some((x) => x.toLowerCase().includes(s));
}

/** Pickers for the three library keys. Empty choices are null. */
export function ScenarioLibraryPicker({
  value,
  onChange,
  idPrefix,
}: {
  value: LibraryKeys;
  onChange: (patch: Partial<LibraryKeys>) => void;
  idPrefix: string;
}) {
  const [query, setQuery] = useState("");
  const [showDefunct, setShowDefunct] = useState(false);
  const defunctId = useId();
  const actors = listThreatActors({ includeDefunct: showDefunct, keepKey: value.threatActorKey }).filter(
    (a) => a.key === value.threatActorKey || actorMatches(a, query.trim()),
  );
  const replays = listReplays();
  const keepReplay = value.replayKey && !replays.some((r) => r.key === value.replayKey) ? resolveScenarioReference({ replayKey: value.replayKey }).replay : null;

  return (
    <div className="flex flex-col gap-4">
      <Field label={LABELS.threatActor} htmlFor={`${idPrefix}-actor`}>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label={LABELS.search}
            placeholder={LABELS.search}
            className="h-9 max-w-[14rem]"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <label htmlFor={defunctId} className="flex items-center gap-1.5 text-[12px] text-[color:var(--color-muted-foreground)]">
            <input
              id={defunctId}
              type="checkbox"
              className="h-4 w-4 accent-[color:var(--mist-indigo)]"
              checked={showDefunct}
              onChange={(e) => setShowDefunct(e.target.checked)}
            />
            {LABELS.showDefunct}
          </label>
        </div>
        <FieldSelect
          id={`${idPrefix}-actor`}
          className="h-9"
          value={value.threatActorKey ?? ""}
          options={[
            { value: "", label: LABELS.none },
            ...actors.map((a) => ({ value: a.key, label: `${a.name}, ${ACTOR_STATUS_LABELS[a.status].toLowerCase()}` })),
          ]}
          onChange={(v) => onChange({ threatActorKey: v || null })}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={LABELS.replay} htmlFor={`${idPrefix}-replay`}>
          <FieldSelect
            id={`${idPrefix}-replay`}
            className="h-9"
            value={value.replayKey ?? ""}
            options={[
              { value: "", label: LABELS.none },
              ...(keepReplay ? [{ value: keepReplay.key, label: keepReplay.title }] : []),
              ...replays.map((r) => ({ value: r.key, label: r.title })),
            ]}
            onChange={(v) => onChange({ replayKey: v || null })}
          />
        </Field>
        <Field label={LABELS.industry} htmlFor={`${idPrefix}-industry`}>
          <FieldSelect
            id={`${idPrefix}-industry`}
            className="h-9"
            value={value.industryKey ?? ""}
            options={[{ value: "", label: LABELS.none }, ...INDUSTRY_TEMPLATES.map((t) => ({ value: t.key, label: `${t.industry}, ${t.orgName}` }))]}
            onChange={(v) => onChange({ industryKey: v || null })}
          />
        </Field>
      </div>
    </div>
  );
}

function Section({ title, children, open }: { title: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group rounded-md border border-[color:var(--color-border)] px-3 py-2">
      <summary className="cursor-pointer text-[13px] font-semibold">{title}</summary>
      <div className="mt-2 flex flex-col gap-2 text-[13px]">{children}</div>
    </details>
  );
}

const muted = "text-[12px] text-[color:var(--color-muted-foreground)]";

/** Read-only summary of the picks. Renders nothing when none is set. */
export function ReferenceCard({ keys, className }: { keys: ScenarioReferenceKeys; className?: string }) {
  const ref = resolveScenarioReference(keys);
  if (!hasReference(ref)) return null;
  const { actor, replay, industry } = ref;
  return (
    <aside aria-label="Reference" className={className}>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold">Reference</h3>
          <span className={muted}>Hidden from players.</span>
        </div>
        {actor && (
          <Section title={actor.name} open>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={statusVariant(actor)}>{actorStatusLabel(actor)}</Badge>
              {actor.origin && <span className={muted}>{actor.origin}</span>}
            </div>
            {actor.statusNote && <p className={muted}>{actor.statusNote}</p>}
            <p>{actor.summary}</p>
            <ul className="flex flex-col gap-0.5">
              {topTechniques(actor, 10).map((t) => (
                <li key={t.id} className="text-[12px]">
                  <span className="font-mono">{t.id}</span> {t.name}
                </li>
              ))}
            </ul>
          </Section>
        )}
        {replay && (
          <Section title={replay.title}>
            <p>{replay.summary}</p>
            <ol className="flex flex-col gap-1">
              {replay.timeline.map((e, i) => (
                <li key={i} className="text-[12px]">
                  <span className="font-mono">{replayOffsetLabel(e.offsetHours)}</span>
                  {e.date ? ` ${e.date}` : ""}. {e.event}
                </li>
              ))}
            </ol>
            <p className="text-[12px] font-semibold">Key decisions</p>
            <ul className="list-disc pl-5 text-[12px]">
              {replay.keyDecisions.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </Section>
        )}
        {industry && (
          <Section title={`${industry.industry}, ${industry.orgName}`}>
            <p className={muted}>
              {industry.size}. {industry.regions.join(", ")}.
            </p>
            <SafeMarkdown text={industry.profileMd} className="text-[12px]" />
            <p className="text-[12px]">Crown jewels: {industry.crownJewels.join(", ")}.</p>
          </Section>
        )}
      </div>
    </aside>
  );
}

