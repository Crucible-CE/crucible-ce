"use client";

// Roster grouped by team. With `manage` (drivers), each person can be moved
// to another team, given roles, made decision maker, excused or removed.
// Changes go through PATCH /api/exercises/{id}/participants.
// Attendance (live and after ENDEX): drivers confirm attended, partial or
// absent per person, and after ENDEX add people who took part without a
// device. Through /api/exercises/{id}/participants/attendance.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { FieldSelect } from "@/components/form/field-select";
import { cn } from "@/lib/utils";
import { api } from "./api";
import { ALL_ROLES, GUEST_ROLES, RolePicker, excusedRoles } from "./role-picker";
import { ROLE_LABELS, type RosterEntry } from "./types";

export interface RosterManage {
  exerciseId: string;
  /** Called after a change is saved. */
  onChanged: () => void;
}

function ManageRow({ p, teams, manage }: { p: RosterEntry; teams: Array<{ id: string; name: string }>; manage: RosterManage }) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);

  async function patch(body: Record<string, unknown>, success: string) {
    setBusy(true);
    const r = await api(`/api/exercises/${manage.exerciseId}/participants`, {
      method: "PATCH",
      body: { participantId: p.id, ...body },
      fallback: "The change was not saved. Try again.",
    });
    setBusy(false);
    if (!r.ok) toast.error(r.error);
    else toast.success(success);
    manage.onChanged();
  }

  async function excuse() {
    const ok = await confirm({
      title: `Excuse ${p.displayName}?`,
      description: "They stay as an observer and no longer count as a voter.",
      confirmLabel: "Excuse",
    });
    if (ok) await patch({ roles: excusedRoles(p.roles) }, `${p.displayName} excused.`);
  }

  return (
    <div className="space-y-2 border-t border-[color:var(--color-border)] pt-2">
      <RolePicker
        value={p.roles}
        allowed={p.isGuest ? GUEST_ROLES : ALL_ROLES}
        label={`Roles for ${p.displayName}`}
        disabled={busy}
        onChange={(next) => {
          if (next.length === 0) {
            toast.error("Keep at least one role.");
            return;
          }
          void patch({ roles: next }, "Roles saved.");
        }}
      />
      <div className="flex flex-wrap items-center gap-3">
        {teams.length > 0 && (
          <FieldSelect
            aria-label={`Team for ${p.displayName}`}
            value={p.teamId ?? ""}
            disabled={busy}
            onChange={(v) => void patch({ teamId: v || null }, "Team saved.")}
            options={[{ value: "", label: "No team" }, ...teams.map((t) => ({ value: t.id, label: t.name }))]}
            className="h-8 w-40 text-[12.5px]"
          />
        )}
        <label className="flex items-center gap-2 text-[12.5px]">
          <Switch
            checked={p.isDecisionMaker}
            disabled={busy}
            aria-label={`Decision maker ${p.displayName}`}
            onCheckedChange={(on) => void patch({ isDecisionMaker: on }, "Saved.")}
          />
          Decision maker
        </label>
        {p.roles.includes("player") && (
          <Button size="xs" variant="outline" disabled={busy} onClick={() => void excuse()}>
            Excuse
          </Button>
        )}
      </div>
    </div>
  );
}

interface AttendanceRow {
  id: string;
  displayName: string;
  title: string | null;
  organization: string | null;
  roles: string[];
  noDevice: boolean;
  joinedAt: string | null;
  attendance: "attended" | "partial" | "absent" | null;
}

const ATTENDANCE_OPTIONS = [
  { value: "", label: "Not confirmed" },
  { value: "attended", label: "Attended" },
  { value: "partial", label: "Partial" },
  { value: "absent", label: "Absent" },
];

function AddAttendee({ exerciseId, teams, onAdded }: { exerciseId: string; teams: Array<{ id: string; name: string }>; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [org, setOrg] = useState("");
  const [teamId, setTeamId] = useState("");
  const [roles, setRoles] = useState<string[]>(["player"]);
  const [attendance, setAttendance] = useState("attended");
  const [busy, setBusy] = useState(false);
  if (!open) {
    return (
      <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
        Add attendee without a device
      </Button>
    );
  }
  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await api(`/api/exercises/${exerciseId}/participants/attendance`, {
      body: { displayName: name.trim(), title: title.trim() || null, organization: org.trim() || null, teamId: teamId || null, roles, attendance },
      fallback: "The attendee was not added. Try again.",
    });
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success(`${name.trim()} added.`);
    setName("");
    setTitle("");
    setOrg("");
    setOpen(false);
    onAdded();
  }
  return (
    <form onSubmit={add} className="space-y-2 rounded-md bg-[color:var(--color-muted)]/60 p-3" data-testid="add-attendee">
      <div className="grid gap-2 sm:grid-cols-2">
        <Input aria-label="Attendee name" placeholder="Name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} required />
        <Input aria-label="Attendee title" placeholder="Title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        <Input aria-label="Attendee organization" placeholder="Organization" value={org} maxLength={200} onChange={(e) => setOrg(e.target.value)} />
        {teams.length > 0 && (
          <FieldSelect aria-label="Attendee team" value={teamId} onChange={setTeamId} options={[{ value: "", label: "No team" }, ...teams.map((t) => ({ value: t.id, label: t.name }))]} />
        )}
        <FieldSelect
          aria-label="Attendee attendance"
          value={attendance}
          onChange={setAttendance}
          options={[
            { value: "attended", label: "Attended" },
            { value: "partial", label: "Partial" },
          ]}
        />
      </div>
      <RolePicker value={roles} allowed={ALL_ROLES} label="Attendee roles" disabled={busy} onChange={(next) => next.length && setRoles(next)} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy || !name.trim()}>
          Add attendee
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Facilitator-confirmed attendance per person. Counts for required roles in the report. */
export function AttendancePanel({ exerciseId, teams }: { exerciseId: string; teams: Array<{ id: string; name: string }> }) {
  const [data, setData] = useState<{ participants: AttendanceRow[]; canEdit: boolean; ended: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api<{ participants: AttendanceRow[]; canEdit: boolean; ended: boolean }>(`/api/exercises/${exerciseId}/participants/attendance`);
    if (r.ok) setData(r.data);
  }, [exerciseId]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!data) return null;
  async function set(p: AttendanceRow, value: string) {
    setBusy(p.id);
    const r = await api(`/api/exercises/${exerciseId}/participants/attendance`, {
      method: "PATCH",
      body: { participantId: p.id, attendance: value || null },
      fallback: "Attendance was not saved. Try again.",
    });
    setBusy(null);
    if (!r.ok) toast.error(r.error);
    void load();
  }
  return (
    <section aria-label="Attendance" className="space-y-2" data-testid="attendance">
      <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">Attendance</h3>
      <p className="text-[12px] text-[color:var(--color-muted-foreground)]">Only people confirmed as attended or partial count toward required roles.</p>
      <ul className="space-y-1.5">
        {data.participants.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="min-w-0 flex-1 truncate">
              {p.displayName}
              {p.noDevice && <span className="text-[color:var(--color-muted-foreground)]"> (no device)</span>}
            </span>
            {data.canEdit ? (
              <FieldSelect
                aria-label={`Attendance for ${p.displayName}`}
                value={p.attendance ?? ""}
                disabled={busy === p.id}
                onChange={(v) => void set(p, v)}
                options={ATTENDANCE_OPTIONS}
                className="h-8 w-40 text-[12.5px]"
              />
            ) : (
              <Badge variant="outline">{ATTENDANCE_OPTIONS.find((o) => o.value === (p.attendance ?? ""))?.label}</Badge>
            )}
          </li>
        ))}
      </ul>
      {data.canEdit && data.ended && <AddAttendee exerciseId={exerciseId} teams={teams} onAdded={() => void load()} />}
    </section>
  );
}

export function RosterPanel({
  roster,
  teams,
  onRemove,
  busyId,
  manage,
  attendanceFor,
}: {
  roster: RosterEntry[];
  teams: Array<{ id: string; name: string }>;
  onRemove?: (p: RosterEntry) => void;
  busyId?: string | null;
  manage?: RosterManage;
  /** Show attendance for this exercise (control team). Defaults to manage.exerciseId. */
  attendanceFor?: string;
}) {
  const attendanceId = attendanceFor ?? manage?.exerciseId;
  const [open, setOpen] = useState<string | null>(null);
  const groups = [
    ...teams.map((t) => ({ key: t.id, name: t.name, people: roster.filter((p) => p.teamId === t.id) })),
    { key: "none", name: "No team", people: roster.filter((p) => !p.teamId || !teams.some((t) => t.id === p.teamId)) },
  ].filter((g) => g.people.length > 0);

  if (roster.length === 0 && !attendanceId) return <p className="py-6 text-center text-[13px] text-[color:var(--color-muted-foreground)]">Nobody has joined yet.</p>;

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <section key={g.key} aria-label={g.name}>
          <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">
            {g.name} <span className="font-normal">({g.people.length})</span>
          </h3>
          <ul className="space-y-1.5">
            {g.people.map((p) => (
              <li key={p.id} className="space-y-2 rounded-md bg-[color:var(--color-muted)]/60 px-3 py-2 text-[13px]">
                <div className="flex items-center gap-2">
                  <span
                    className={cn("h-2 w-2 shrink-0 rounded-full", p.online ? "bg-[color:var(--mist-ok)]" : "bg-[color:var(--mist-line-2)]")}
                    title={p.online ? "Joined" : "Not joined yet"}
                    aria-label={p.online ? "Joined" : "Not joined yet"}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{p.displayName}</div>
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {p.roles.map((r) => (
                        <Badge key={r} variant="outline">
                          {ROLE_LABELS[r] ?? r}
                        </Badge>
                      ))}
                      {p.isDecisionMaker && <Badge variant="accent">Decision maker</Badge>}
                      {p.isGuest && <Badge variant="secondary">Guest</Badge>}
                    </div>
                  </div>
                  {manage && (
                    <Button
                      size="xs"
                      variant="ghost"
                      aria-expanded={open === p.id}
                      aria-label={`Edit ${p.displayName}`}
                      onClick={() => setOpen(open === p.id ? null : p.id)}
                    >
                      {open === p.id ? "Done" : "Edit"}
                    </Button>
                  )}
                  {onRemove && !p.roles.includes("lead_facilitator") && (
                    <Button size="xs" variant="ghost" disabled={busyId === p.id} onClick={() => onRemove(p)} aria-label={`Remove ${p.displayName}`}>
                      Remove
                    </Button>
                  )}
                </div>
                {manage && open === p.id && <ManageRow p={p} teams={teams} manage={manage} />}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {attendanceId && <AttendancePanel exerciseId={attendanceId} teams={teams} />}
    </div>
  );
}
