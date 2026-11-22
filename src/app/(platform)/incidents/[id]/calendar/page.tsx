"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  ChevronLeft, ChevronRight, CalendarDays, ListChecks, Flag, Loader2,
  AlertTriangle, Plus, CalendarPlus, UserPlus, Trash2, Check, X, Pencil,
} from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { AssignUserModal } from "@/components/incident/assign-user-modal";
import { useIncidentShell } from "@/components/incident/incident-shell";
import { apiErrorMessage } from "@/lib/incident/lock-shared";
import { toDatetimeLocalValue, toIsoOrNull, ymdLocal, parseYmdLocal } from "@/lib/datetime/local";

interface CalEvent {
  id: string;
  kind: "milestone" | "task" | "event";
  title: string;
  date: string;
  status: string | null;
  meta?: string | null;
  eventId?: string;
  eventType?: string;
  assigneeId?: string | null;
  assigneeName?: string | null;
  notes?: string | null;
}

const KIND_META: Record<CalEvent["kind"], { icon: React.ElementType; color: string; label: string }> = {
  milestone: { icon: Flag, color: "var(--mist-indigo)", label: "Milestone" },
  task: { icon: ListChecks, color: "var(--mist-amber)", label: "Task due" },
  event: { icon: CalendarPlus, color: "var(--mist-success)", label: "Scheduled item" },
};

const EVENT_TYPES = ["meeting", "deadline", "reminder", "review", "milestone", "other"];

const ymd = ymdLocal;

export default function IncidentCalendarPage() {
  const params = useParams<{ id: string }>();
  const confirm = useConfirm();
  const { readOnly } = useIncidentShell();
  const incidentId = params.id;
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // Filters
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [hideDone, setHideDone] = useState(false);

  // Add/edit form
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [fTitle, setFTitle] = useState("");
  const [fType, setFType] = useState("meeting");
  const [fStart, setFStart] = useState(toDatetimeLocalValue(new Date()));
  const [fNotes, setFNotes] = useState("");
  const [fAssigneeId, setFAssigneeId] = useState<string | null>(null);
  const [fAssigneeName, setFAssigneeName] = useState<string | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/incidents/${incidentId}/calendar`);
    if (res.ok) setEvents((await res.json()).events ?? []);
    setLoading(false);
  }, [incidentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const assignees = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of events) if (e.assigneeId && e.assigneeName) m.set(e.assigneeId, e.assigneeName);
    return [...m.entries()];
  }, [events]);

  const passesFilters = useCallback(
    (e: CalEvent) => {
      if (kindFilter !== "all" && e.kind !== kindFilter) return false;
      if (assigneeFilter !== "all" && e.assigneeId !== assigneeFilter) return false;
      if (hideDone && (e.status === "done" || e.status === "cancelled")) return false;
      return true;
    },
    [kindFilter, assigneeFilter, hideDone]
  );

  const filtered = useMemo(() => events.filter(passesFilters), [events, passesFilters]);

  const byDay = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const e of filtered) {
      const key = ymd(new Date(e.date));
      const arr = m.get(key) ?? [];
      arr.push(e);
      m.set(key, arr);
    }
    return m;
  }, [filtered]);

  const monthDays = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const startWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: (Date | null)[] = [];
    for (let i = 0; i < startWeekday; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [cursor]);

  const todayKey = ymd(new Date());
  const agenda = useMemo(() => {
    const list = [...filtered].sort((a, b) => a.date.localeCompare(b.date));
    return selectedDay ? list.filter((e) => ymd(new Date(e.date)) === selectedDay) : list;
  }, [filtered, selectedDay]);

  const monthLabel = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const openAdd = (day?: string) => {
    setEditId(null);
    setFTitle("");
    setFType("meeting");
    setFStart(toDatetimeLocalValue(day ? new Date(`${day}T09:00`) : new Date()));
    setFNotes("");
    setFAssigneeId(null);
    setFAssigneeName(null);
    setFormOpen(true);
  };
  const openEdit = (e: CalEvent) => {
    if (!e.eventId) return;
    setEditId(e.eventId);
    setFTitle(e.title);
    setFType(e.eventType ?? "meeting");
    setFStart(toDatetimeLocalValue(new Date(e.date)));
    setFNotes(e.notes ?? "");
    setFAssigneeId(e.assigneeId ?? null);
    setFAssigneeName(e.assigneeName ?? null);
    setFormOpen(true);
  };

  const save = async () => {
    if (!fTitle.trim()) {
      toast.error("Add a title");
      return;
    }
    setSaving(true);
    const body = {
      title: fTitle.trim(),
      eventType: fType,
      startAt: toIsoOrNull(fStart),
      notes: fNotes.trim() || undefined,
      assigneeId: fAssigneeId,
    };
    const res = await fetch(
      editId ? `/api/incidents/${incidentId}/calendar-events/${editId}` : `/api/incidents/${incidentId}/calendar-events`,
      {
        method: editId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    setSaving(false);
    if (res.ok) {
      setFormOpen(false);
      await load();
    } else {
      const d = await res.json().catch(() => ({}));
      toast.error(apiErrorMessage(d, "Couldn't save. Try again."));
    }
  };

  const setStatus = async (e: CalEvent, status: string) => {
    if (!e.eventId) return;
    const res = await fetch(`/api/incidents/${incidentId}/calendar-events/${e.eventId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) await load();
    else toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't update event. Try again."));
  };
  // hand the timeline to real calendars. Export = one-shot .ics
  // download (session-authed); Subscribe = standing feed URL with a derived
  // token — treated like a secret link, so we copy rather than display it.
  const [subscribing, setSubscribing] = useState(false);
  const subscribeToCalendar = async () => {
    setSubscribing(true);
    try {
      const res = await fetch(`/api/incidents/${incidentId}/calendar/subscribe`);
      if (!res.ok) {
        toast.error("Couldn't create the subscribe link. Try again.");
        return;
      }
      const { httpsUrl } = (await res.json()) as { httpsUrl: string; webcalUrl: string };
      await navigator.clipboard.writeText(httpsUrl);
      toast.success("Subscription link copied. Add it in your calendar app as a URL subscription. Keep it private.");
    } catch {
      toast.error("Couldn't copy the subscribe link. Try again.");
    } finally {
      setSubscribing(false);
    }
  };

  const remove = async (e: CalEvent) => {
    if (!e.eventId) return;
    const ok = await confirm({
      title: "Delete this event?",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/incidents/${incidentId}/calendar-events/${e.eventId}`, { method: "DELETE" });
    if (res.ok) await load();
    else toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't delete event. Try again."));
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[color:var(--color-muted-foreground)]" />
      </div>
    );
  }

  return (
    // Compact layout: the month grid is a fixed ~400px column (small
    // fixed-height day cells, not aspect-square) and the agenda gets the rest.
    <div className="grid gap-5 lg:grid-cols-[400px_minmax(0,1fr)]">
      {/* Month grid */}
      <div className="h-fit rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <CalendarDays className="h-4 w-4 text-[color:var(--mist-indigo)]" /> {monthLabel}
          </h2>
          <div className="flex items-center gap-1">
            {!readOnly && (
              <button onClick={() => openAdd(selectedDay ?? undefined)} className="mr-1 inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[color:var(--mist-indigo)] px-2 py-1 text-[11px] font-medium text-white">
                <Plus className="h-3 w-3" /> Add
              </button>
            )}
            <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} aria-label="Previous month" className="rounded border border-[color:var(--color-border)] p-1 hover:bg-[color:var(--color-muted)]">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button onClick={() => { setCursor(new Date()); setSelectedDay(null); }} className="rounded border border-[color:var(--color-border)] px-2 py-1 text-[11px] hover:bg-[color:var(--color-muted)]">Today</button>
            <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} aria-label="Next month" className="rounded border border-[color:var(--color-border)] p-1 hover:bg-[color:var(--color-muted)]">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ICS export + standing subscription */}
        <div className="mb-2 flex items-center gap-1.5">
          <a
            href={`/api/incidents/${incidentId}/calendar/ics`}
            className="inline-flex items-center gap-1 rounded border border-[color:var(--color-border)] px-2 py-1 text-[11px] hover:bg-[color:var(--color-muted)]"
          >
            <CalendarDays className="h-3 w-3" /> Export .ics
          </a>
          <button
            onClick={subscribeToCalendar}
            disabled={subscribing}
            className="inline-flex items-center gap-1 rounded border border-[color:var(--color-border)] px-2 py-1 text-[11px] hover:bg-[color:var(--color-muted)] disabled:opacity-60"
          >
            <CalendarPlus className="h-3 w-3" /> {subscribing ? "Copying…" : "Copy subscribe link"}
          </button>
        </div>

        {/* Filters */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} className="rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] text-[color:var(--color-foreground)] px-2 py-1 text-[11px]">
            <option value="all">All types</option>
            <option value="event">Scheduled items</option>
            <option value="task">Task due dates</option>
            <option value="milestone">Milestones</option>
          </select>
          {assignees.length > 0 && (
            <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)} className="rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] text-[color:var(--color-foreground)] px-2 py-1 text-[11px]">
              <option value="all">Anyone</option>
              {assignees.map(([uid, name]) => (
                <option key={uid} value={uid}>{name}</option>
              ))}
            </select>
          )}
          <label className="flex items-center gap-1 text-[11px] text-[color:var(--color-muted-foreground)]">
            <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} /> Hide done
          </label>
        </div>

        <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] font-medium uppercase text-[color:var(--color-muted-foreground)]">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="py-0.5">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {monthDays.map((day, i) => {
            if (!day) return <div key={`e-${i}`} className="h-9" />;
            const key = ymd(day);
            const dayEvents = byDay.get(key) ?? [];
            const isToday = key === todayKey;
            const isSelected = key === selectedDay;
            return (
              <button
                key={key}
                onClick={() => setSelectedDay(isSelected ? null : key)}
                onDoubleClick={readOnly ? undefined : () => openAdd(key)}
                className={`flex h-9 flex-col items-center justify-start rounded-[var(--radius-sm)] border p-0.5 text-[11px] leading-tight transition ${
                  isSelected ? "border-[color:var(--mist-indigo)] bg-[color:var(--mist-indigo)]/10" : "border-transparent hover:border-[color:var(--color-border)]"
                }`}
              >
                <span className={isToday ? "flex h-4 w-4 items-center justify-center rounded-full bg-[color:var(--mist-indigo)] text-[10px] text-white" : ""}>{day.getDate()}</span>
                <div className="flex flex-wrap justify-center gap-0.5">
                  {dayEvents.slice(0, 3).map((e) => (
                    <span key={e.id} className="h-1 w-1 rounded-full" style={{ backgroundColor: KIND_META[e.kind].color }} />
                  ))}
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-[color:var(--color-border)] pt-2 text-[10.5px] text-[color:var(--color-muted-foreground)]">
          {Object.entries(KIND_META).map(([k, m]) => (
            <span key={k} className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: m.color }} /> {m.label}
            </span>
          ))}
        </div>
      </div>

      {/* Agenda side list */}
      <div className="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            {selectedDay ? parseYmdLocal(selectedDay).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }) : "All scheduled items"}
          </h2>
          {selectedDay && <button onClick={() => setSelectedDay(null)} className="text-[11px] text-[color:var(--mist-indigo)] hover:underline">Show all</button>}
        </div>
        <ul className="space-y-2">
          {agenda.map((e) => {
            const meta = KIND_META[e.kind];
            const Icon = meta.icon;
            const due = new Date(e.date);
            const overdue = e.kind === "task" && e.status !== "done" && due.getTime() < Date.now();
            const isUser = e.kind === "event";
            const done = e.status === "done" || e.status === "cancelled";
            return (
              <li key={e.id} className={`flex items-start gap-2 rounded-[var(--radius-sm)] border border-[color:var(--color-border)] p-2 ${done ? "opacity-55" : ""}`}>
                <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: meta.color }} />
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-[13px] font-medium ${done ? "line-through" : ""}`}>{e.title}</p>
                  <p className="text-[11px] text-[color:var(--color-muted-foreground)]">
                    {due.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {due.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    {e.assigneeName ? ` · ${e.assigneeName}` : ""}
                  </p>
                  {isUser && e.notes && <p className="mt-0.5 line-clamp-2 text-[11px] text-[color:var(--color-muted-foreground)]">{e.notes}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {overdue && (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-[color:var(--mist-danger)]/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[color:var(--mist-danger)]">
                      <AlertTriangle className="h-2.5 w-2.5" /> Overdue
                    </span>
                  )}
                  {isUser && !readOnly ? (
                    <>
                      {e.status !== "done" && (
                        <button onClick={() => setStatus(e, "done")} title="Mark done" aria-label="Mark done" className="text-[color:var(--color-muted-foreground)] hover:text-[color:var(--mist-success)]">
                          <Check className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button onClick={() => openEdit(e)} title="Edit" aria-label="Edit" className="text-[color:var(--color-muted-foreground)] hover:text-[color:var(--mist-indigo)]">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => remove(e)} title="Delete" aria-label="Delete" className="text-[color:var(--color-muted-foreground)] hover:text-[color:var(--mist-danger)]">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  ) : (
                    e.status && !overdue && <span className="text-[10px] capitalize text-[color:var(--color-muted-foreground)]">{e.status.replace(/_/g, " ")}</span>
                  )}
                </div>
              </li>
            );
          })}
          {agenda.length === 0 && (
            <li className="py-6 text-center text-xs text-[color:var(--color-muted-foreground)]">No items{selectedDay ? " on this day" : ""}.</li>
          )}
        </ul>
      </div>

      {/* Add/edit modal */}
      {formOpen && !readOnly && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setFormOpen(false)}>
          <div className="w-full max-w-md rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">{editId ? "Edit event" : "Add event"}</h3>
              <button onClick={() => setFormOpen(false)} aria-label="Close" className="text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3">
              <input value={fTitle} onChange={(e) => setFTitle(e.target.value)} placeholder="Event title" className="w-full rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[color:var(--mist-indigo)]/50" />
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-[10px] uppercase text-[color:var(--color-muted-foreground)]">Type</span>
                  <select value={fType} onChange={(e) => setFType(e.target.value)} className="mt-0.5 w-full rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] text-[color:var(--color-foreground)] px-2 py-1.5 text-[13px] capitalize">
                    {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-[10px] uppercase text-[color:var(--color-muted-foreground)]">When</span>
                  <input type="datetime-local" value={fStart} onChange={(e) => setFStart(e.target.value)} className="mt-0.5 w-full rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-transparent px-2 py-1.5 text-[13px]" />
                </label>
              </div>
              <div className="flex items-center justify-between rounded-[var(--radius-sm)] border border-[color:var(--color-border)] px-3 py-2">
                <div className="text-[13px]">
                  <span className="text-[10px] uppercase text-[color:var(--color-muted-foreground)]">Assignee</span>
                  <p className={fAssigneeName ? "font-medium" : "italic text-[color:var(--color-muted-foreground)]"}>{fAssigneeName ?? "Unassigned"}</p>
                </div>
                <div className="flex items-center gap-1">
                  {fAssigneeId && <button onClick={() => { setFAssigneeId(null); setFAssigneeName(null); }} className="text-[color:var(--color-muted-foreground)] hover:text-[color:var(--mist-danger)]"><X className="h-3.5 w-3.5" /></button>}
                  <button onClick={() => setPickOpen(true)} className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[color:var(--color-border)] px-2 py-1 text-[11px] hover:border-[color:var(--mist-indigo)]/50">
                    <UserPlus className="h-3 w-3" /> {fAssigneeName ? "Change" : "Assign"}
                  </button>
                </div>
              </div>
              <textarea value={fNotes} onChange={(e) => setFNotes(e.target.value)} rows={3} placeholder="Notes (optional)" className="w-full resize-none rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-transparent px-3 py-2 text-[13px] outline-none focus:border-[color:var(--mist-indigo)]/50" />
              <button onClick={save} disabled={saving} className="w-full rounded-[var(--radius-sm)] bg-[color:var(--mist-indigo)] py-2 text-sm font-medium text-white disabled:opacity-50">
                {saving ? "Saving…" : editId ? "Save changes" : "Add event"}
              </button>
            </div>
          </div>
        </div>
      )}

      <AssignUserModal
        open={pickOpen}
        onClose={() => setPickOpen(false)}
        title="Assign event"
        onSelect={(userId, member) => {
          setFAssigneeId(userId);
          setFAssigneeName(member?.name ?? member?.email ?? "Assigned");
        }}
      />
    </div>
  );
}
