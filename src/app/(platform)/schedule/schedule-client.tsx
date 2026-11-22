"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, CalendarPlus, Copy, Download, Loader2, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { FieldSelect } from "@/components/form/field-select";
import { api } from "@/components/exercise/api";
import { formatInZone } from "@/lib/exercise/time";
import { RECURRENCES, RECURRENCE_LABELS, type Recurrence } from "@/lib/exercise/schedule/recurrence";
import type { ScheduleView } from "@/lib/exercise/schedule/service";

export interface TemplateOption {
  id: string;
  mode: string;
  title: string;
  status: string;
  briefMd: string | null;
}

interface Option {
  key: string;
  label: string;
}

interface Props {
  initial: ScheduleView[];
  canEdit: boolean;
  feedEnabled: boolean;
  timezone: string;
  templates: TemplateOption[];
  documents: Array<{ id: string; title: string }>;
  frameworks: Option[];
  modes: Option[];
}

interface FormState {
  title: string;
  mode: string;
  templateId: string;
  startDate: string;
  startTime: string;
  durationMin: string;
  recurrence: Recurrence;
  teams: string;
  documentIds: string[];
  frameworkKeys: string[];
  briefMd: string;
}

function emptyForm(): FormState {
  const d = new Date(Date.now() + 7 * 86_400_000);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return {
    title: "",
    mode: "crisissim",
    templateId: "",
    startDate: date,
    startTime: "10:00",
    durationMin: "120",
    recurrence: "none",
    teams: "",
    documentIds: [],
    frameworkKeys: [],
    briefMd: "",
  };
}

function formOf(s: ScheduleView): FormState {
  return {
    title: s.title,
    mode: s.mode,
    templateId: s.templateId ?? "",
    startDate: s.startDate,
    startTime: s.startTime,
    durationMin: String(s.durationMin),
    recurrence: s.recurrence,
    teams: s.teams.join(", "),
    documentIds: s.documents.map((d) => d.id),
    frameworkKeys: s.frameworks.map((f) => f.key),
    briefMd: s.briefMd ?? "",
  };
}

function toggle(list: string[], key: string): string[] {
  return list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
}

export function ScheduleClient({ initial, canEdit, feedEnabled, timezone, templates, documents, frameworks, modes }: Props) {
  const router = useRouter();
  const confirm = useConfirm();
  const [rows, setRows] = useState(initial);
  const [editing, setEditing] = useState<{ id: string | null; form: FormState } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedOn, setFeedOn] = useState(feedEnabled);
  const [feedUrl, setFeedUrl] = useState<string | null>(null);

  async function reload() {
    const r = await api<{ schedules: ScheduleView[] }>("/api/schedule");
    if (r.ok) setRows(r.data.schedules);
  }

  async function launch(s: ScheduleView) {
    setBusy(s.id);
    const r = await api<{ id: string }>(`/api/schedule/${s.id}/launch`, { method: "POST", body: {}, fallback: "The exercise was not created. Try again." });
    setBusy(null);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success("Draft exercise created.");
    router.push(`/exercises/${r.data.id}`);
  }

  async function setActive(s: ScheduleView, isActive: boolean) {
    setBusy(s.id);
    const r = await api(`/api/schedule/${s.id}`, { method: "PATCH", body: { isActive } });
    setBusy(null);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    await reload();
  }

  async function remove(s: ScheduleView) {
    const ok = await confirm({ title: "Delete this entry?", description: s.title, confirmLabel: "Delete", destructive: true });
    if (!ok) return;
    setBusy(s.id);
    const r = await api(`/api/schedule/${s.id}`, { method: "DELETE" });
    setBusy(null);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    setRows((prev) => prev.filter((x) => x.id !== s.id));
  }

  async function makeFeed() {
    if (feedOn) {
      const ok = await confirm({ title: "Replace the feed link?", description: "The current link stops working.", confirmLabel: "Replace" });
      if (!ok) return;
    }
    setBusy("feed");
    const r = await api<{ path: string }>("/api/schedule/feed", { method: "POST", body: {} });
    setBusy(null);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    setFeedOn(true);
    setFeedUrl(`${window.location.origin}${r.data.path}`);
  }

  async function stopFeed() {
    const ok = await confirm({ title: "Turn off the feed?", description: "Subscribed calendars stop updating.", confirmLabel: "Turn off", destructive: true });
    if (!ok) return;
    setBusy("feed");
    const r = await api("/api/schedule/feed", { method: "DELETE" });
    setBusy(null);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    setFeedOn(false);
    setFeedUrl(null);
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-4">
        {canEdit && (
          <div className="flex justify-end">
            <Button variant="accent" onClick={() => setEditing({ id: null, form: emptyForm() })}>
              <Plus className="h-4 w-4" />
              Add to schedule
            </Button>
          </div>
        )}
        {rows.length === 0 ? (
          <EmptyState icon={CalendarClock} title="Nothing scheduled." description={canEdit ? "Add an exercise to plan it ahead." : undefined} />
        ) : (
          rows.map((s) => (
            <Card key={s.id} dense className={s.isActive && !s.isPast ? undefined : "opacity-75"}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <h2 className="text-[15px] font-semibold">{s.title}</h2>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="accent">{s.modeLabel}</Badge>
                    {s.recurrence !== "none" && <Badge variant="secondary">{s.recurrenceLabel}</Badge>}
                    {!s.isActive && <Badge variant="outline">Paused</Badge>}
                    {s.isActive && s.isPast && <Badge variant="outline">Past</Badge>}
                    {s.templateStatus === "draft" && <Badge variant="warning">Template not published</Badge>}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {busy === s.id && <Loader2 className="h-4 w-4 animate-spin" />}
                  {canEdit && s.isActive && (
                    <Button size="sm" variant="accent" disabled={busy !== null} onClick={() => void launch(s)}>
                      <Play className="h-4 w-4" />
                      Create exercise
                    </Button>
                  )}
                  {!s.isPast && (
                    <a
                      href={`/api/schedule/${s.id}/ics`}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[color:var(--color-card)] px-3 text-sm font-medium shadow-[var(--elevation-0)] hover:bg-[color:var(--color-muted)]"
                    >
                      <Download className="h-4 w-4" />
                      .ics
                    </a>
                  )}
                  {canEdit && (
                    <>
                      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => setEditing({ id: s.id, form: formOf(s) })}>
                        <Pencil className="h-4 w-4" />
                        Edit
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void setActive(s, !s.isActive)}>
                        {s.isActive ? "Pause" : "Resume"}
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label={`Delete ${s.title}`} disabled={busy !== null} onClick={() => void remove(s)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
              <dl className="grid grid-cols-[110px_1fr] gap-x-4 gap-y-1.5 text-[13px]">
                <dt className="text-[color:var(--color-muted-foreground)]">{s.isPast ? "Was" : "Next"}</dt>
                <dd>
                  {s.nextLabel ?? "No date"} <span className="text-[color:var(--color-muted-foreground)]">for {s.durationMin} min</span>
                </dd>
                {s.recurrence !== "none" && s.upcoming.length > 1 && (
                  <>
                    <dt className="text-[color:var(--color-muted-foreground)]">Then</dt>
                    <dd>{s.upcoming.slice(1).map((d) => formatInZone(new Date(d), s.timezone)).join(", ")}</dd>
                  </>
                )}
                {s.templateTitle && (
                  <>
                    <dt className="text-[color:var(--color-muted-foreground)]">Template</dt>
                    <dd>{s.templateTitle}</dd>
                  </>
                )}
                {s.teams.length > 0 && (
                  <>
                    <dt className="text-[color:var(--color-muted-foreground)]">Teams</dt>
                    <dd>{s.teams.join(", ")}</dd>
                  </>
                )}
                {s.documents.length > 0 && (
                  <>
                    <dt className="text-[color:var(--color-muted-foreground)]">Documents</dt>
                    <dd>{s.documents.map((d) => d.title).join(", ")}</dd>
                  </>
                )}
                {s.frameworks.length > 0 && (
                  <>
                    <dt className="text-[color:var(--color-muted-foreground)]">Frameworks</dt>
                    <dd>{s.frameworks.map((f) => f.label).join(", ")}</dd>
                  </>
                )}
              </dl>
              {s.briefMd && (
                <details className="text-[13px]">
                  <summary className="cursor-pointer text-[color:var(--color-muted-foreground)]">Pre-read brief</summary>
                  <p className="mt-2 whitespace-pre-wrap break-words leading-relaxed">{s.briefMd}</p>
                </details>
              )}
            </Card>
          ))
        )}
      </div>

      <Card className="h-fit">
        <h2 className="text-base font-semibold">Calendar feed</h2>
        <p className="text-[13px] text-[color:var(--color-muted-foreground)]">
          {feedOn ? "A private feed link is active." : "Subscribe a calendar to every upcoming entry."}
        </p>
        {feedUrl && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-md bg-[color:var(--color-muted)] px-3 py-2 font-mono text-[11.5px]">{feedUrl}</code>
              <Button
                size="icon"
                variant="outline"
                aria-label="Copy feed link"
                onClick={() => void navigator.clipboard?.writeText(feedUrl).then(() => toast.success("Copied."))}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-[12px] text-[color:var(--color-muted-foreground)]">Shown once. Anyone with the link can read the schedule.</p>
          </div>
        )}
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy === "feed"} onClick={() => void makeFeed()}>
              <CalendarPlus className="h-4 w-4" />
              {feedOn ? "Replace link" : "Make feed link"}
            </Button>
            {feedOn && (
              <Button variant="ghost" disabled={busy === "feed"} onClick={() => void stopFeed()}>
                Turn off
              </Button>
            )}
          </div>
        )}
      </Card>

      {editing && (
        <ScheduleDialog
          key={editing.id ?? "new"}
          id={editing.id}
          initial={editing.form}
          timezone={timezone}
          templates={templates}
          documents={documents}
          frameworks={frameworks}
          modes={modes}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await reload();
          }}
        />
      )}
    </div>
  );
}

function ScheduleDialog({
  id,
  initial,
  timezone,
  templates,
  documents,
  frameworks,
  modes,
  onClose,
  onSaved,
}: {
  id: string | null;
  initial: FormState;
  timezone: string;
  templates: TemplateOption[];
  documents: Array<{ id: string; title: string }>;
  frameworks: Option[];
  modes: Option[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [f, setF] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<FormState>) => setF((prev) => ({ ...prev, ...patch }));
  const forMode = useMemo(() => templates.filter((t) => t.mode === f.mode), [templates, f.mode]);
  const briefOf = (templateId: string) => templates.find((t) => t.id === templateId)?.briefMd ?? "";

  function pickTemplate(templateId: string) {
    // Replace the brief only when it is empty or still the old template's brief.
    const keep = f.briefMd.trim() && f.briefMd !== briefOf(f.templateId);
    const t = templates.find((x) => x.id === templateId);
    set({ templateId, briefMd: keep ? f.briefMd : briefOf(templateId), title: f.title || t?.title || "" });
  }

  async function save() {
    setSaving(true);
    setError(null);
    const body = {
      title: f.title,
      mode: f.mode,
      templateId: f.templateId || null,
      startDate: f.startDate,
      startTime: f.startTime,
      durationMin: Number.parseInt(f.durationMin, 10) || 0,
      recurrence: f.recurrence,
      teams: f.teams
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      documentIds: f.documentIds,
      frameworkKeys: f.frameworkKeys,
      briefMd: f.briefMd.trim() ? f.briefMd : null,
    };
    const r = await api(id ? `/api/schedule/${id}` : "/api/schedule", { method: id ? "PATCH" : "POST", body, fallback: "The entry was not saved. Try again." });
    setSaving(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    toast.success("Saved.");
    await onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{id ? "Edit entry" : "Add to schedule"}</DialogTitle>
          <DialogDescription>Times are in {timezone}.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="s-mode">Type</Label>
              <FieldSelect
                id="s-mode"
                value={f.mode}
                onChange={(mode) => set({ mode, templateId: "", briefMd: f.briefMd === briefOf(f.templateId) ? "" : f.briefMd })}
                options={modes.map((m) => ({ value: m.key, label: m.label }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-template">Template</Label>
              <FieldSelect
                id="s-template"
                value={f.templateId}
                onChange={pickTemplate}
                options={[
                  { value: "", label: "No template" },
                  ...forMode.map((t) => ({ value: t.id, label: t.status === "draft" ? `${t.title} (draft)` : t.title })),
                ]}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-title">Title</Label>
            <Input id="s-title" value={f.title} maxLength={200} onChange={(e) => set({ title: e.target.value })} />
          </div>
          <div className="grid gap-4 sm:grid-cols-4">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="s-date">{f.recurrence === "none" ? "Date" : "First date"}</Label>
              <Input id="s-date" type="date" value={f.startDate} onChange={(e) => set({ startDate: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-time">Start</Label>
              <Input id="s-time" type="time" value={f.startTime} onChange={(e) => set({ startTime: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-dur">Minutes</Label>
              <Input id="s-dur" type="number" min={15} max={1440} step={15} value={f.durationMin} onChange={(e) => set({ durationMin: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-rec">Repeats</Label>
            <FieldSelect
              id="s-rec"
              value={f.recurrence}
              onChange={(v) => set({ recurrence: v as Recurrence })}
              options={RECURRENCES.map((r) => ({ value: r, label: RECURRENCE_LABELS[r] }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-teams">Teams</Label>
            <Input id="s-teams" value={f.teams} placeholder="Executive, Technical" onChange={(e) => set({ teams: e.target.value })} />
            <p className="text-[12px] text-[color:var(--color-muted-foreground)]">Separate names with commas. Used when the template has no teams.</p>
          </div>
          {documents.length > 0 && (
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">Documents</legend>
              <div className="flex max-h-32 flex-col gap-1 overflow-y-auto text-[13px]">
                {documents.map((d) => (
                  <label key={d.id} className="flex items-center gap-2">
                    <input type="checkbox" checked={f.documentIds.includes(d.id)} onChange={() => set({ documentIds: toggle(f.documentIds, d.id) })} />
                    {d.title}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Frameworks it satisfies</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
              {frameworks.map((fw) => (
                <label key={fw.key} className="flex items-center gap-2">
                  <input type="checkbox" checked={f.frameworkKeys.includes(fw.key)} onChange={() => set({ frameworkKeys: toggle(f.frameworkKeys, fw.key) })} />
                  {fw.label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="space-y-1.5">
            <Label htmlFor="s-brief">Pre-read brief</Label>
            <Textarea id="s-brief" rows={6} maxLength={6000} value={f.briefMd} onChange={(e) => set({ briefMd: e.target.value })} />
            <p className="text-[12px] text-[color:var(--color-muted-foreground)]">Goes in the calendar invite. Markdown is sent as plain text.</p>
          </div>
          {error && <p className="text-[13px] text-[color:var(--mist-danger)]">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="accent" disabled={saving} onClick={() => void save()}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
