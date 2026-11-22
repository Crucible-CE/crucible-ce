"use client";

// The report: every HSEEP section with its origin badge, inline editing and
// per-section refresh from the record. Evaluators write the executive summary,
// strengths and areas for improvement, and cite evidence from the record.
// The analysis shows accepted findings only; the Findings tab decides them.
// Read-only for final reports and older versions.

import { useState, type ReactNode } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldSelect } from "@/components/form/field-select";
import { formatInZone, scenarioLabel } from "@/lib/exercise/time";
import { NOT_EVALUATED_LABEL, RATING_LABELS, controlResultLabel, type Afi, type ObjectiveAnalysis } from "@/lib/exercise/aar/schema";
import { CloudSeam } from "@/components/cloud/cloud-seam";
import { AAR_FIELD_LABELS as F } from "@/lib/exercise/aar/field-labels";
import { followUpText } from "@/lib/exercise/aar/findings";
import type { Evidence } from "@/lib/exercise/aar/schema";
import { EditableText, EvidenceChip, EvidencePicker, FieldLabel, SectionCard } from "./fields";
import { SECTION_LABELS, type AarSectionKey, type AarSections, type EvidenceOption, type SectionOrigin } from "./types";

/** Sections built from the record: they refresh from the exercise. */
const RECORD_SECTIONS: readonly AarSectionKey[] = ["overview", "decisionLog", "clocks", "controlMapping", "methodology", "roster", "requiredRoles", "parkingLot"];

export interface ReportActions {
  save(section: AarSectionKey, path: string | null, value: unknown): Promise<boolean>;
  refresh(section: AarSectionKey): void;
  remove(section: AarSectionKey, path: string, label: string): void;
  /** Record items the evaluator can cite. */
  evidence?: EvidenceOption[];
}

function when(iso: string | null | undefined, tz: string): string {
  return iso ? formatInZone(new Date(iso), tz) : "Not recorded";
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="mt-0.5 text-[14px]">{value || "Not recorded"}</div>
    </div>
  );
}

const ROLE_LABELS: Record<string, string> = {
  lead_facilitator: "Lead facilitator",
  controller: "Controller",
  evaluator: "Evaluator",
  scribe: "Scribe",
  player: "Player",
  observer: "Observer",
};

const ATTENDANCE_LABELS: Record<string, string> = { attended: "Attended", partial: "Partial", absent: "Absent" };

function newId(prefix: string): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function RatingLine({ a }: { a: ObjectiveAnalysis }) {
  if (a.notEvaluated) {
    return (
      <div className="flex flex-wrap items-center gap-2" data-testid="objective-rating">
        <Badge variant="outline">{NOT_EVALUATED_LABEL}</Badge>
        <Badge variant="outline">Evaluator</Badge>
      </div>
    );
  }
  if (!a.rating) return <p className="text-[13px] text-[color:var(--color-muted-foreground)]">Not rated.</p>;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="objective-rating">
      <Badge variant={a.rating === "P" ? "success" : a.rating === "S" ? "accent" : a.rating === "M" ? "warning" : "destructive"}>
        {a.rating}: {RATING_LABELS[a.rating]}
      </Badge>
      <Badge variant="outline">Evaluator rating</Badge>
    </div>
  );
}

/** Capability and references (controls, document sections, injects). Control references drive the control mapping. */
function References({ afi, base, editable, actions }: { afi: Afi; base: string; editable: boolean; actions: ReportActions }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"control" | "doc_section" | "inject">("control");
  const [ref, setRef] = useState("");
  if (afi.references.length === 0 && !afi.capabilityKey && !editable) return null;
  async function add(e: React.FormEvent) {
    e.preventDefault();
    const v = ref.trim();
    if (!v) return;
    if (await actions.save("analysis", `${base}.references.${afi.references.length}`, { type, ref: v.slice(0, 120) })) {
      setRef("");
      setOpen(false);
    }
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {afi.capabilityKey && <Badge variant="secondary">{afi.capabilityKey}</Badge>}
        {afi.references.map((r, k) => (
          <Badge key={`${r.type}:${r.ref}`} variant="outline" title={r.label ?? undefined} className="gap-1">
            {r.type === "control" ? r.ref.replace(":", " ") : (r.label ?? r.ref)}
            {editable && (
              <button type="button" aria-label="Remove reference" onClick={() => actions.remove("analysis", `${base}.references.${k}`, "this reference")}>
                <X className="size-3" />
              </button>
            )}
          </Badge>
        ))}
        {editable && !open && (
          <Button size="xs" variant="ghost" onClick={() => setOpen(true)}>
            <Plus />
            Add reference
          </Button>
        )}
      </div>
      {editable && open && (
        <form onSubmit={(e) => void add(e)} className="flex flex-wrap items-center gap-2">
          <FieldSelect
            aria-label="Reference type"
            value={type}
            onChange={(v) => setType(v as typeof type)}
            options={[
              { value: "control", label: "Control" },
              { value: "doc_section", label: "Document section" },
              { value: "inject", label: "Inject" },
            ]}
            className="h-8 w-44"
          />
          <Input
            aria-label="Reference"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder={type === "control" ? "nist-csf:RS.MA-01" : type === "inject" ? "Inject number or title" : "Section heading"}
            maxLength={120}
            className="h-8 w-64"
          />
          <Button type="submit" size="xs" disabled={!ref.trim()}>
            Add
          </Button>
          <Button type="button" size="xs" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </form>
      )}
    </div>
  );
}

/** Evidence chips for one finding, with remove and add while the report is in draft. */
function EvidenceList({ items, path, editable, actions, timezone }: { items: Evidence[]; path: string; editable: boolean; actions: ReportActions; timezone: string }) {
  if (items.length === 0 && !(editable && actions.evidence)) return null;
  return (
    <div className="space-y-1.5">
      {items.length > 0 && (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {items.map((e, k) => (
            <EvidenceChip
              key={`${e.sourceId}-${k}`}
              e={e}
              timezone={timezone}
              onRemove={editable ? () => actions.remove("analysis", `${path}.${k}`, "this evidence") : undefined}
            />
          ))}
        </div>
      )}
      {editable && actions.evidence && (
        <EvidencePicker options={actions.evidence} cited={items} onPick={(e) => actions.save("analysis", `${path}.${items.length}`, e)} />
      )}
    </div>
  );
}

function AfiBlock({ afi, base, editable, actions, timezone }: { afi: Afi; base: string; editable: boolean; actions: ReportActions; timezone: string }) {
  const save = (field: string) => (v: string) => actions.save("analysis", `${base}.${field}`, v);
  return (
    <div className="space-y-3 rounded-md border border-[color:var(--color-border)] p-3" data-testid="afi">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 font-semibold">
          <EditableText value={afi.title} editable={editable} multiline={false} onSave={save("title")} label={F.title} maxLength={300} />
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <FieldLabel>{F.observation}</FieldLabel>
          <EditableText value={afi.observation} editable={editable} onSave={save("observation")} label={F.observation} maxLength={3000} />
        </div>
        <div>
          <FieldLabel>{F.analysis}</FieldLabel>
          <EditableText value={afi.analysis} editable={editable} onSave={save("analysis")} label={F.analysis} maxLength={3000} />
        </div>
        <div>
          <FieldLabel>{F.recommendation}</FieldLabel>
          <EditableText value={afi.recommendation} editable={editable} onSave={save("recommendation")} label={F.recommendation} maxLength={2000} />
        </div>
      </div>
      <References afi={afi} base={base} editable={editable} actions={actions} />
      {followUpText(afi) && <p className="text-[13px] text-[color:var(--color-muted-foreground)]">{followUpText(afi)}</p>}
      <EvidenceList items={afi.evidence} path={`${base}.evidence`} editable={editable} actions={actions} timezone={timezone} />
    </div>
  );
}

function ObjectiveBlock({ a, i, editable, actions, timezone }: { a: ObjectiveAnalysis; i: number; editable: boolean; actions: ReportActions; timezone: string }) {
  return (
    <div className="space-y-4 border-t border-[color:var(--color-border)] pt-4 first:border-t-0 first:pt-0" data-testid="objective-analysis">
      <div className="space-y-1.5">
        <h3 className="font-semibold">
          Objective {i + 1}. {a.objectiveText}
        </h3>
        {a.capabilityKeys.length > 0 && <p className="text-[12px] text-[color:var(--color-muted-foreground)]">Capabilities: {a.capabilityKeys.join(", ")}</p>}
        <RatingLine a={a} />
        {(a.ratingRationale || editable) && (
          <EditableText
            value={a.notEvaluated ? `Reason: ${a.ratingRationale}` : a.ratingRationale}
            editable={editable && a.ratingSource !== "evaluator"}
            onSave={(v) => actions.save("analysis", `${i}.ratingRationale`, v)}
            label="Rating rationale"
            placeholder="No rationale."
            maxLength={2000}
          />
        )}
      </div>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h4 className="flex-1 text-[13px] font-semibold">{F.strengths}</h4>
          {editable && (
            <Button size="xs" variant="ghost" onClick={() => actions.save("analysis", `${i}.strengths.${a.strengths.length}`, { id: newId("str"), text: "New strength", evidence: [] })}>
              <Plus />
              Add strength
            </Button>
          )}
        </div>
        {a.strengths.length === 0 && <p className="text-[13px] text-[color:var(--color-muted-foreground)]">None recorded.</p>}
        {a.strengths.map((s, j) => (
          <div key={s.id} className="space-y-1.5" data-testid="strength">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <EditableText value={s.text} editable={editable} onSave={(v) => actions.save("analysis", `${i}.strengths.${j}.text`, v)} label={F.strength} maxLength={2000} />
              </div>
              {editable && (
                <Button size="icon-xs" variant="ghost" aria-label="Remove strength" onClick={() => actions.remove("analysis", `${i}.strengths.${j}`, "this strength")}>
                  <Trash2 />
                </Button>
              )}
            </div>
            <EvidenceList items={s.evidence} path={`${i}.strengths.${j}.evidence`} editable={editable} actions={actions} timezone={timezone} />
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <h4 className="text-[13px] font-semibold">{F.afis}</h4>
        {!a.afis.some((afi) => afi.status === "accepted") && (
          <p className="text-[13px] text-[color:var(--color-muted-foreground)]">{editable ? "None accepted. Decide findings on the Findings tab." : "None recorded."}</p>
        )}
        {a.afis.map((afi, j) =>
          afi.status === "accepted" ? <AfiBlock key={afi.id} afi={afi} base={`${i}.afis.${j}`} editable={editable} actions={actions} timezone={timezone} /> : null,
        )}
      </div>
    </div>
  );
}

export function ReportView({
  sections,
  origins,
  editable,
  actions,
  timezone,
  regenerating,
  scenarioStart,
  overviewExtra,
  modeType,
}: {
  sections: AarSections;
  origins: Record<AarSectionKey, SectionOrigin | null>;
  editable: boolean;
  actions: ReportActions;
  timezone: string;
  regenerating: boolean;
  scenarioStart: string | null;
  /** Rendered at the end of the overview card (after-action meeting record). */
  overviewExtra?: ReactNode;
  /** HSEEP exercise type for the mode. */
  modeType?: string;
}) {
  const card = (key: AarSectionKey) => ({
    id: key,
    title: SECTION_LABELS[key],
    origin: origins[key],
    onRefresh: editable && RECORD_SECTIONS.includes(key) ? () => actions.refresh(key) : undefined,
    refreshing: regenerating,
    note: editable && key === "executiveSummary" ? <CloudSeam feature="aar-drafting" /> : undefined,
  });
  const o = sections.overview;
  return (
    <div className="space-y-6">
      <SectionCard {...card("overview")}>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Fact label="Exercise" value={o.name} />
          <Fact label="Type" value={modeType ? `${o.mode}. ${modeType}` : o.mode} />
          <Fact label="Started" value={when(o.startedAt, timezone)} />
          <Fact label="Duration" value={o.durationMin !== null ? `${o.durationMin} min` : ""} />
        </dl>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <FieldLabel>Sponsor</FieldLabel>
            <EditableText value={o.sponsor} editable={editable} multiline={false} onSave={(v) => actions.save("overview", "sponsor", v)} label="Sponsor" maxLength={200} />
          </div>
          <div>
            <FieldLabel>Threat or hazard</FieldLabel>
            <EditableText value={o.hazard} editable={editable} onSave={(v) => actions.save("overview", "hazard", v)} label="Hazard" maxLength={1000} />
          </div>
          <div>
            <FieldLabel>Scope</FieldLabel>
            <EditableText value={o.scope} editable={editable} onSave={(v) => actions.save("overview", "scope", v)} label="Scope" maxLength={3000} />
          </div>
          <div>
            <FieldLabel>Scenario</FieldLabel>
            <EditableText value={o.scenarioSummary} editable={editable} onSave={(v) => actions.save("overview", "scenarioSummary", v)} label="Scenario" maxLength={6000} />
          </div>
        </div>
        <dl className="grid gap-4 md:grid-cols-2">
          <Fact label="Participating organizations" value={o.participatingOrganizations.join(", ")} />
          <Fact label="Points of contact" value={o.pointsOfContact.join("; ")} />
          {o.sourceDocument && <Fact label="Source document" value={`${o.sourceDocument.title}, SHA-256 ${o.sourceDocument.sha256.slice(0, 16)}`} />}
          <Fact label="Time zone" value={o.timezone} />
          <Fact label="Mission areas" value={o.missionAreas.join(", ")} />
          <Fact
            label="Plans exercised"
            value={o.plansExercised
              .map((d) => [d.title, d.version ? `v${d.version.replace(/^v/i, "")}` : "", d.date, d.owner ? `owner ${d.owner}` : "", d.sha256 ? `SHA-256 ${d.sha256.slice(0, 16)}` : ""].filter(Boolean).join(", "))
              .join("; ")}
          />
        </dl>
        <div data-testid="requirements">
          <FieldLabel>Requirements this exercise is meant to satisfy</FieldLabel>
          {o.requirements.length ? (
            <ul className="mt-1 space-y-0.5 text-[14px]">
              {o.requirements.map((r) => (
                <li key={`${r.framework}:${r.controlId}`}>
                  <span className="font-mono text-[12px]">{r.framework} {r.controlId}</span> {r.title}
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-0.5 text-[14px]">None set in the exercise plan.</div>
          )}
        </div>
        {overviewExtra}
      </SectionCard>

      <SectionCard {...card("executiveSummary")}>
        <EditableText
          value={sections.executiveSummary}
          editable={editable}
          onSave={(v) => actions.save("executiveSummary", null, v)}
          label={F.executiveSummary}
          placeholder="Not written yet."
          maxLength={6000}
        />
      </SectionCard>

      <SectionCard {...card("analysis")}>
        {sections.analysis.length === 0 && <p className="text-[13px] text-[color:var(--color-muted-foreground)]">The exercise has no objectives.</p>}
        {sections.analysis.map((a, i) => (
          <ObjectiveBlock key={a.objectiveId} a={a} i={i} editable={editable} actions={actions} timezone={timezone} />
        ))}
      </SectionCard>

      <SectionCard {...card("decisionLog")}>
        {sections.decisionLog.length === 0 ? (
          <p className="text-[13px] text-[color:var(--color-muted-foreground)]">No decisions recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="text-[11px] uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Inject</th>
                  <th className="py-1.5 pr-3 font-medium">Scenario time</th>
                  <th className="py-1.5 pr-3 font-medium">Team</th>
                  <th className="py-1.5 pr-3 font-medium">Owner</th>
                  <th className="py-1.5 pr-3 font-medium">Decision</th>
                  <th className="py-1.5 font-medium">Split</th>
                </tr>
              </thead>
              <tbody>
                {sections.decisionLog.map((d, k) => (
                  <tr key={k} className="border-t border-[color:var(--color-border)] align-top">
                    <td className="py-2 pr-3">{d.seq || ""}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{scenarioLabel(d.scenarioTime, scenarioStart, timezone) ?? ""}</td>
                    <td className="py-2 pr-3">{d.team ?? ""}</td>
                    <td className="py-2 pr-3">{d.owner ?? ""}</td>
                    <td className="py-2 pr-3">
                      {d.question && <p className="text-[color:var(--color-muted-foreground)]">{d.question}</p>}
                      <p>{d.decision ?? "No decision"}</p>
                      {d.kind === "materiality" && <Badge variant="warning">Materiality</Badge>}
                    </td>
                    <td className="py-2">
                      {Object.entries(d.split)
                        .map(([k2, v]) => `${k2}: ${v}`)
                        .join("; ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard {...card("clocks")}>
        {sections.clocks.length === 0 && <p className="text-[13px] text-[color:var(--color-muted-foreground)]">No regulatory clocks.</p>}
        {sections.clocks.map((c, k) => (
          <div key={c.key} className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold">{c.label}</span>
              <Badge variant={c.status === "met" ? "success" : c.status === "missed" ? "destructive" : "outline"}>
                {c.status === "met" ? "Met" : c.status === "missed" ? "Missed" : c.status === "running" ? "Open" : c.status === "not_applicable" ? "Not applicable" : "Not started"}
              </Badge>
            </div>
            <EditableText value={c.statement} editable={editable} multiline={false} onSave={(v) => actions.save("clocks", `${k}.statement`, v)} label="Clock statement" maxLength={600} />
          </div>
        ))}
      </SectionCard>

      <SectionCard {...card("controlMapping")}>
        {sections.controlMapping.length === 0 ? (
          <p className="text-[13px] text-[color:var(--color-muted-foreground)]">No controls or techniques mapped.</p>
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="text-[11px] uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">
              <tr>
                <th className="py-1.5 pr-3 font-medium">Framework</th>
                <th className="py-1.5 pr-3 font-medium">Control</th>
                <th className="py-1.5 pr-3 font-medium">Title</th>
                <th className="py-1.5 font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {sections.controlMapping.map((c) => (
                <tr key={`${c.framework}:${c.controlId}`} className="border-t border-[color:var(--color-border)]">
                  <td className="py-2 pr-3">{c.framework}</td>
                  <td className="py-2 pr-3 font-mono text-[12px]">{c.controlId}</td>
                  <td className="py-2 pr-3">{c.title}</td>
                  <td className="py-2">
                    <Badge variant={c.status === "gap" ? "warning" : "success"}>{controlResultLabel(c)}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>

      <SectionCard {...card("methodology")}>
        <EditableText value={sections.methodology.text} editable={editable} onSave={(v) => actions.save("methodology", "text", v)} label="Methodology" maxLength={3000} />
      </SectionCard>

      <SectionCard {...card("roster")}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="text-[11px] uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">
              <tr>
                <th className="py-1.5 pr-3 font-medium">Name</th>
                <th className="py-1.5 pr-3 font-medium">Title</th>
                <th className="py-1.5 pr-3 font-medium">Organization</th>
                <th className="py-1.5 pr-3 font-medium">Team</th>
                <th className="py-1.5 pr-3 font-medium">Roles</th>
                <th className="py-1.5 pr-3 font-medium">Joined</th>
                <th className="py-1.5 font-medium">Attendance</th>
              </tr>
            </thead>
            <tbody>
              {sections.roster.map((p) => (
                <tr key={p.participantId} className="border-t border-[color:var(--color-border)]">
                  <td className="py-2 pr-3">
                    {p.name}
                    {p.guest && <span className="text-[color:var(--color-muted-foreground)]"> (guest)</span>}
                  </td>
                  <td className="py-2 pr-3">{p.title ?? ""}</td>
                  <td className="py-2 pr-3">{p.organization ?? ""}</td>
                  <td className="py-2 pr-3">{p.team ?? ""}</td>
                  <td className="py-2 pr-3">{p.roles.map((r) => ROLE_LABELS[r] ?? r).join(", ")}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{p.joinedAt ? formatInZone(new Date(p.joinedAt), timezone) : ""}</td>
                  <td className="py-2">{p.attendance ? ATTENDANCE_LABELS[p.attendance] : "Not confirmed"}{p.noDevice ? ", no device" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard {...card("requiredRoles")}>
        {sections.requiredRoles.length === 0 ? (
          <p className="text-[13px] text-[color:var(--color-muted-foreground)]">No required roles are set in the organization policy.</p>
        ) : (
          <ul className="space-y-1 text-[14px]">
            {sections.requiredRoles.map((r) => (
              <li key={r.role} className="flex items-center gap-2">
                <Badge variant={r.present ? "success" : "destructive"}>{r.present ? "Present" : "Absent"}</Badge>
                {r.role}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard {...card("parkingLot")}>
        <EditableText
          value={sections.parkingLot.map((p) => `- ${p}`).join("\n")}
          editable={editable}
          onSave={(v) =>
            actions.save(
              "parkingLot",
              null,
              v
                .split("\n")
                .map((l) => l.replace(/^\s*[-*]\s*/, "").trim())
                .filter(Boolean),
            )
          }
          label="Parking lot"
          placeholder="No parking lot items."
        />
      </SectionCard>
    </div>
  );
}
