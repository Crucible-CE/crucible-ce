"use client";

// The after-action report page for the control team: status bar, then
// Report, Findings, Improvement plan, Sign-off and Versions. The record
// sections fill from the exercise; evaluators write the narrative; the
// facilitator accepts or rejects each proposed finding.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Circle, FileText, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { CloudSeam } from "@/components/cloud/cloud-seam";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { api } from "@/components/exercise/api";
import { formatInZone } from "@/lib/exercise/time";
import { HSEEP_TYPE_TEXT } from "@/lib/exercise/aar/labels";
import { ImprovementPlanPanel } from "@/components/aar/plan";
import { SignoffPanel } from "@/components/aar/signoff";
import { FindingsPanel } from "@/components/aar/findings";
import { allFindings } from "@/lib/exercise/aar/findings";
import { FINDINGS_LABELS } from "@/lib/exercise/aar/field-labels";
import { AarGuideDialog } from "./aar-guide";
import { ReportView, type ReportActions } from "./report-view";
import { SECTION_LABELS, STATUS_LABELS, type AarPageData, type AarSectionKey, type AarSections, type AarSummary, type AarTracker } from "./types";

const STEPS = [
  { key: "draft", label: "Draft" },
  { key: "review", label: "In review (after-action meeting)" },
  { key: "final", label: "Final" },
];

function StatusBar({ status }: { status: string }) {
  const at = STEPS.findIndex((s) => s.key === status);
  return (
    <ol className="flex flex-wrap items-center gap-2 text-[13px]" aria-label="Report status" data-testid="aar-status">
      {STEPS.map((s, i) => (
        <li key={s.key} className="flex items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-0.5 ${
              i === at
                ? "bg-[color:var(--mist-navy)] text-white"
                : i < at
                  ? "bg-[color:var(--mist-navy-soft)] text-[color:var(--mist-navy)]"
                  : "text-[color:var(--color-muted-foreground)]"
            }`}
            aria-current={i === at ? "step" : undefined}
          >
            {s.label}
          </span>
          {i < STEPS.length - 1 && <span className="text-[color:var(--color-muted-foreground)]">/</span>}
        </li>
      ))}
    </ol>
  );
}

/** After-action steps at a glance: hotwash, ratings, feedback, draft, meeting, final. */
function TrackerStrip({ t }: { t: AarTracker }) {
  const steps = [
    { label: `Hotwash ${t.hotwash} items`, done: t.hotwash > 0 },
    { label: `Ratings ${t.ratings.done} of ${t.ratings.total}`, done: t.ratings.total > 0 && t.ratings.done === t.ratings.total },
    { label: `Attendance ${t.attendance.confirmed} of ${t.attendance.total}`, done: t.attendance.total > 0 && t.attendance.confirmed === t.attendance.total },
    { label: `Feedback ${t.feedback.responses} of ${t.feedback.participants}`, done: t.feedback.responses > 0 },
    { label: "Draft", done: t.draft },
    { label: "After-action meeting", done: t.meeting },
    { label: "Final", done: t.final },
  ];
  return (
    <ol className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]" aria-label="After-action tracker" data-testid="aar-tracker">
      {steps.map((s) => (
        <li key={s.label} className={`inline-flex items-center gap-1 ${s.done ? "" : "text-[color:var(--color-muted-foreground)]"}`}>
          {s.done ? <Check className="size-3.5 text-[color:var(--mist-ok)]" /> : <Circle className="size-3" />}
          {s.label}
        </li>
      ))}
    </ol>
  );
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** After-action meeting record: date, attendees, when the improvement plan was agreed. Required before signing. */
function MeetingBlock({ aar, canEdit, timezone, exerciseId, onSaved }: { aar: AarSummary; canEdit: boolean; timezone: string; exerciseId: string; onSaved: () => void }) {
  const m = aar.meeting;
  const [editing, setEditing] = useState(false);
  const [at, setAt] = useState(toLocalInput(m.aamAt));
  const [attendees, setAttendees] = useState(m.aamAttendees);
  const [agreed, setAgreed] = useState(toLocalInput(m.ipAgreedAt));
  const [busy, setBusy] = useState(false);
  const fmt = (iso: string | null) => (iso ? formatInZone(new Date(iso), timezone) : "Not recorded");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await api(`/api/exercises/${exerciseId}/aar/meeting`, {
      method: "PATCH",
      body: { aamAt: fromLocalInput(at), aamAttendees: attendees.trim(), ipAgreedAt: fromLocalInput(agreed) },
      fallback: "The meeting record was not saved. Try again.",
    });
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success("Meeting record saved.");
    setEditing(false);
    onSaved();
  }
  return (
    <div className="space-y-2 rounded-md border border-[color:var(--color-border)] p-3" data-testid="aam">
      <div className="flex items-center gap-2">
        <h3 className="flex-1 text-[14px] font-semibold">After-action meeting</h3>
        {canEdit && !editing && (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              setAt(toLocalInput(m.aamAt));
              setAttendees(m.aamAttendees);
              setAgreed(toLocalInput(m.ipAgreedAt));
              setEditing(true);
            }}
          >
            Edit
          </Button>
        )}
      </div>
      {editing ? (
        <form onSubmit={save} className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="aam-at">Meeting date</Label>
            <Input id="aam-at" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="aam-ip">Improvement plan agreed</Label>
            <Input id="aam-ip" type="datetime-local" value={agreed} onChange={(e) => setAgreed(e.target.value)} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="aam-attendees">Meeting attendees</Label>
            <Textarea id="aam-attendees" rows={2} maxLength={4000} value={attendees} onChange={(e) => setAttendees(e.target.value)} placeholder="Names and roles" />
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" size="sm" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              Save meeting record
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <dl className="grid gap-2 text-[13px] sm:grid-cols-3">
          <div>
            <dt className="text-[11px] uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">Meeting date</dt>
            <dd>{fmt(m.aamAt)}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">Attendees</dt>
            <dd className="whitespace-pre-wrap">{m.aamAttendees || "Not recorded"}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">Improvement plan agreed</dt>
            <dd>{fmt(m.ipAgreedAt)}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}

function getAt(sections: AarSections, section: AarSectionKey, path: string): unknown {
  let cur: unknown = sections[section];
  for (const seg of path.split(".").filter(Boolean)) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

export function AarWorkspace({ exerciseId }: { exerciseId: string }) {
  const confirm = useConfirm();
  const [data, setData] = useState<AarPageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("report");
  const [viewVersion, setViewVersion] = useState<number | null>(null);
  const [versionData, setVersionData] = useState<AarPageData | null>(null);

  const load = useCallback(async () => {
    const res = await api<AarPageData>(`/api/exercises/${exerciseId}/aar`);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setData(res.data);
  }, [exerciseId]);

  useEffect(() => {
    void load();
  }, [load]);

  // The sign-off panel announces finalize and amend; reload so status and lock state follow.
  useEffect(() => {
    const onChanged = (e: Event) => {
      const detail = (e as CustomEvent<{ exerciseId?: string }>).detail;
      if (!detail?.exerciseId || detail.exerciseId === exerciseId) void load();
    };
    window.addEventListener("aar:changed", onChanged);
    return () => window.removeEventListener("aar:changed", onChanged);
  }, [exerciseId, load]);

  useEffect(() => {
    if (viewVersion === null) {
      setVersionData(null);
      return;
    }
    void api<AarPageData>(`/api/exercises/${exerciseId}/aar?version=${viewVersion}`).then((r) => {
      if (r.ok) setVersionData(r.data);
      else toast.error(r.error);
    });
  }, [viewVersion, exerciseId]);

  const aar = data?.aar ?? null;
  // Content changes need draft; review freezes the report for signing.
  const editable = Boolean(aar?.contentEditable);

  const create = async () => {
    setBusy(true);
    const res = await api(`/api/exercises/${exerciseId}/aar`, { method: "POST", body: {} });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    await load();
  };

  const refresh = useCallback(
    async (sections?: AarSectionKey[]) => {
      if (!aar) return;
      let force = false;
      const human = (sections ?? []).filter((k) => aar.origins[k] === "human");
      if (sections && human.length) {
        const ok = await confirm({
          title: `Refresh ${SECTION_LABELS[human[0]].toLowerCase()} from the record?`,
          description: "This section was edited. Refreshing replaces the edits.",
          confirmLabel: "Refresh",
          destructive: true,
        });
        if (!ok) return;
        force = true;
      }
      setBusy(true);
      const res = await api<{ changed: string[] }>(`/api/exercises/${exerciseId}/aar/refresh`, { method: "POST", body: { ...(sections ? { sections } : {}), force } });
      setBusy(false);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.data.changed.length ? "Refreshed from the record." : "Already up to date.");
      await load();
    },
    [aar, confirm, exerciseId, load],
  );

  const save = useCallback(
    async (section: AarSectionKey, path: string | null, value: unknown) => {
      const res = await api(`/api/exercises/${exerciseId}/aar/sections`, { method: "PATCH", body: { section, path, value } });
      if (!res.ok) {
        toast.error(res.error);
        return false;
      }
      await load();
      return true;
    },
    [exerciseId, load],
  );

  const actions: ReportActions = useMemo(
    () => ({
      save,
      evidence: data?.evidence ?? [],
      refresh: (key) => void refresh([key]),
      remove: async (section, path, label) => {
        const sections = aar?.sections;
        if (!sections) return;
        const segs = path.split(".");
        const index = Number(segs.pop());
        const parentPath = segs.join(".");
        const parent = parentPath ? getAt(sections, section, parentPath) : sections[section];
        if (!Array.isArray(parent)) return;
        const ok = await confirm({ title: `Remove ${label}?`, confirmLabel: "Remove", destructive: true });
        if (!ok) return;
        await save(section, parentPath || null, parent.filter((_, i) => i !== index));
      },
    }),
    [save, refresh, confirm, aar?.sections, data?.evidence],
  );

  const setStatus = async (status: "draft" | "review") => {
    setBusy(true);
    const res = await api(`/api/exercises/${exerciseId}/aar`, { method: "PATCH", body: { status } });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(status === "review" ? "The report is in review." : "The report is back in draft.");
    await load();
  };

  if (error && !data) {
    return <EmptyState title="The report could not be loaded." description={error} action={<Button onClick={() => void load()}>Try again</Button>} />;
  }
  if (!data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const tz = data.exercise.timezone;
  const proposedCount = aar?.sections ? allFindings(aar.sections).filter((f) => f.afi.status === "proposed").length : 0;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link href={`/exercises/${exerciseId}`} className="inline-flex items-center gap-1 text-[13px] text-[color:var(--mist-indigo)] underline-offset-4 hover:underline">
          <ArrowLeft className="size-3.5" />
          Back to the exercise
        </Link>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="headline">After-action report</h1>
            <p className="mt-1 truncate text-[13px] text-[color:var(--color-muted-foreground)]">
              {data.exercise.title}
              {aar ? `, version ${aar.version}` : ""}
            </p>
          </div>
          {aar && (
            <div className="flex flex-wrap items-center gap-2">
              <AarGuideDialog exerciseId={exerciseId} />
              {aar.contentEditable && (
                <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={busy}>
                  <RefreshCw />
                  Refresh from the record
                </Button>
              )}
              {aar.editable && data.canDrive && aar.status === "draft" && (
                <Button size="sm" onClick={() => void setStatus("review")} disabled={busy}>
                  Move to review
                </Button>
              )}
              {aar.editable && data.canDrive && aar.status === "review" && (
                <Button size="sm" variant="outline" onClick={() => void setStatus("draft")} disabled={busy}>
                  Move back to draft
                </Button>
              )}
            </div>
          )}
        </div>
        {aar && <StatusBar status={aar.status} />}
        <TrackerStrip t={data.tracker} />
        {aar?.editable && <CloudSeam feature="transcript-matching" />}
        {aar?.status === "review" && aar.editable && (
          <p className="text-[13px] text-[color:var(--color-muted-foreground)]">In review the report is frozen for signing. Move it back to draft to change it.</p>
        )}
        {aar?.previous && (
          <p className="text-[13px] text-[color:var(--color-muted-foreground)]">
            Amends version {aar.previous.version}. Reason: {aar.amendReason || "Not recorded"}
          </p>
        )}
        {aar?.lastError && <p className="text-[13px] text-[color:var(--mist-danger)]">{aar.lastError}</p>}
        {aar && !aar.editable && aar.status === "final" && <p className="text-[13px] text-[color:var(--color-muted-foreground)]">This report is final and read-only.</p>}
      </div>

      {!aar ? (
        data.reportable ? (
          <EmptyState
            icon={FileText}
            title="No report yet."
            description="Draft one from the exercise record."
            action={
              <Button onClick={() => void create()} disabled={busy}>
                {busy && <Loader2 className="animate-spin" />}
                Create draft
              </Button>
            }
          />
        ) : (
          <EmptyState icon={FileText} title="No report for this exercise." description={data.blockedReason ?? undefined} />
        )
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full overflow-x-auto">
            <TabsTrigger value="report">Report</TabsTrigger>
            <TabsTrigger value="findings">
              {FINDINGS_LABELS.tab}
              {proposedCount > 0 && (
                <Badge variant="warning" className="ml-1.5" aria-label={`${proposedCount} proposed`}>
                  {proposedCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="plan">Improvement plan</TabsTrigger>
            <TabsTrigger value="signoff">Sign-off</TabsTrigger>
            <TabsTrigger value="versions">Versions</TabsTrigger>
          </TabsList>

          <TabsContent value="report" className="pt-4">
            {aar.sections ? (
              <ReportView
                sections={aar.sections}
                origins={aar.origins}
                editable={editable}
                actions={actions}
                timezone={tz}
                regenerating={busy}
                scenarioStart={data.exercise.scenarioStartAt}
                modeType={HSEEP_TYPE_TEXT[data.exercise.mode]}
                overviewExtra={
                  <MeetingBlock
                    key={aar.id}
                    aar={aar}
                    canEdit={aar.editable && data.canDrive && aar.signatureCount === 0}
                    timezone={tz}
                    exerciseId={exerciseId}
                    onSaved={() => void load()}
                  />
                }
              />
            ) : (
              <Card>
                <p className="text-[14px]">The report content could not be read. Refresh it from the record.</p>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="findings" className="pt-4">
            {aar.sections ? (
              <FindingsPanel
                exerciseId={exerciseId}
                aarId={aar.id}
                sections={aar.sections}
                contentEditable={editable}
                followUpEditable={aar.editable}
                canDrive={data.canDrive}
                timezone={tz}
                actions={actions}
                onChanged={load}
              />
            ) : (
              <Card>
                <p className="text-[14px]">The report content could not be read. Refresh it from the record.</p>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="plan" className="pt-4">
            <ImprovementPlanPanel exerciseId={exerciseId} aarId={aar.id} editable={aar.editable} />
          </TabsContent>

          <TabsContent value="signoff" className="pt-4">
            <SignoffPanel exerciseId={exerciseId} aarId={aar.id} />
          </TabsContent>

          <TabsContent value="versions" className="space-y-4 pt-4">
            <Card dense>
              <ul className="divide-y divide-[color:var(--color-border)]">
                {data.versions.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center gap-3 py-2 text-[14px]">
                    <span className="font-semibold">Version {v.version}</span>
                    <Badge variant={v.status === "final" ? "success" : "outline"}>{STATUS_LABELS[v.status] ?? v.status}</Badge>
                    <span className="min-w-0 flex-1 text-[13px] text-[color:var(--color-muted-foreground)]">
                      Created {formatInZone(new Date(v.createdAt), tz)}
                      {v.finalizedAt ? `. Final ${formatInZone(new Date(v.finalizedAt), tz)}` : ""}
                    </span>
                    <Button size="sm" variant={viewVersion === v.version ? "secondary" : "ghost"} onClick={() => setViewVersion(viewVersion === v.version ? null : v.version)}>
                      {viewVersion === v.version ? "Hide" : "View"}
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
            {viewVersion !== null &&
              (versionData?.aar?.sections ? (
                <ReportView
                  sections={versionData.aar.sections}
                  origins={versionData.aar.origins}
                  editable={false}
                  actions={actions}
                  timezone={tz}
                  regenerating={false}
                  scenarioStart={data.exercise.scenarioStartAt}
                />
              ) : (
                <Skeleton className="h-40 w-full" />
              ))}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
