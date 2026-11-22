"use client";

import { useCallback, useEffect, useState } from "react";
import { Lock, LockOpen, UserPlus, X, ShieldCheck, Globe } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { AssignUserModal } from "./assign-user-modal";
import { GuestInvites } from "./guest-invites";
import { apiErrorMessage } from "@/lib/incident/lock-shared";

interface Participant {
  id: string;
  userId: string | null;
  userName: string;
  userEmail: string | null;
  role: string;
  addedByName: string | null;
  createdAt: string;
}

// Right-rail card: incident access control. Shows whether the incident is open
// to the org or locked to an allowlist. A lock has two effects: only the listed
// participants, the incident commander and administrators can see the
// incident, and it becomes read-only for everyone except the incident
// commander and administrators. The reporter and assignee are ordinary,
// removable participants (auto-added at creation, assignment and lock). The
// reporter, IC, or an admin may lock an open incident; once locked, the IC or
// an admin manages participants, and only an admin — or the IC who locked it,
// while still in the seat — may unlock it.
export function AccessPanel({ incidentId, onChange }: { incidentId: string; onChange?: () => void }) {
  const confirm = useConfirm();
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [restricted, setRestricted] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [canUnlock, setCanUnlock] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/incidents/${incidentId}/participants`);
    if (res.ok) {
      const d = await res.json();
      setParticipants(d.participants ?? []);
      setRestricted(!!d.restricted);
      setCanManage(!!d.canManage);
      setCanUnlock(!!d.canUnlock);
    }
    setLoading(false);
  }, [incidentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleLock = async (next: boolean) => {
    if (next) {
      const ok = await confirm({
        title: "Lock this incident?",
        description:
          "Only listed participants, the incident commander and Org admins can see it. The current team is added. Only the incident commander and Org admins can edit it. Only an Org admin, or the incident commander who locked it, can unlock it.",
        confirmLabel: "Lock incident",
        destructive: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    const res = await fetch(`/api/incidents/${incidentId}/restricted`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restricted: next }),
    });
    setBusy(false);
    if (res.ok) {
      toast.success(next ? "Incident locked" : "Incident unlocked");
      await load();
      onChange?.();
    } else {
      const d = await res.json().catch(() => ({}));
      toast.error(apiErrorMessage(d, "Couldn't update the lock. Try again."));
    }
  };

  const addMember = async (userId: string) => {
    const res = await fetch(`/api/incidents/${incidentId}/participants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (res.ok) {
      await load();
      onChange?.();
    } else {
      const d = await res.json().catch(() => ({}));
      toast.error(apiErrorMessage(d, "Couldn't add participant. Try again."));
    }
  };

  const removeMember = async (participantId: string) => {
    const res = await fetch(`/api/incidents/${incidentId}/participants/${participantId}`, { method: "DELETE" });
    if (res.ok) {
      await load();
      onChange?.();
    } else {
      const d = await res.json().catch(() => ({}));
      toast.error(apiErrorMessage(d, "Couldn't remove participant. Try again."));
    }
  };

  return (
    <div className="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {restricted ? (
            <Lock className="h-4 w-4 text-[color:var(--mist-danger)]" />
          ) : (
            <Globe className="h-4 w-4 text-[color:var(--mist-indigo)]" />
          )}
          <h3 className="text-sm font-semibold">Access</h3>
        </div>
        {(restricted ? canUnlock : canManage) && (
          <button
            type="button"
            disabled={busy}
            onClick={() => toggleLock(!restricted)}
            className={`inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-2 py-1 text-[11px] font-medium disabled:opacity-50 ${
              restricted
                ? "border-[color:var(--color-border)] hover:border-[color:var(--mist-indigo)]/50"
                : "border-[color:var(--mist-danger)]/40 text-[color:var(--mist-danger)] hover:bg-[color:var(--mist-danger)]/10"
            }`}
          >
            {restricted ? <LockOpen className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
            {restricted ? "Unlock" : "Lock"}
          </button>
        )}
      </div>

      <p className="mb-3 flex items-start gap-1.5 text-[11.5px] text-[color:var(--color-muted-foreground)]">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {restricted
          ? "Locked. Visible to the participants below, the incident commander and Org admins. Only the incident commander and Org admins can edit."
          : "Open to your organization."}
      </p>

      {loading ? (
        <div className="py-3 text-center text-xs text-[color:var(--color-muted-foreground)]">Loading…</div>
      ) : restricted ? (
        <>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[color:var(--color-muted-foreground)]">
              Participants ({participants.length})
            </p>
            {canManage && (
              <button
                type="button"
                onClick={() => setPickOpen(true)}
                className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[color:var(--color-border)] px-1.5 py-1 text-[10.5px] hover:border-[color:var(--mist-indigo)]/50"
              >
                <UserPlus className="h-3 w-3" /> Add member
              </button>
            )}
          </div>
          <ul className="space-y-1">
            {participants.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium">
                    {p.userName}
                  </p>
                  {p.userEmail && <p className="truncate text-[11px] text-[color:var(--color-muted-foreground)]">{p.userEmail}</p>}
                </div>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => removeMember(p.id)}
                    title="Remove"
                    aria-label={`Remove ${p.userName}`}
                    className="shrink-0 text-[color:var(--color-muted-foreground)] hover:text-[color:var(--mist-danger)]"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
            {participants.length === 0 && (
              <li className="py-2 text-center text-[11px] italic text-[color:var(--color-muted-foreground)]">No participants.</li>
            )}
          </ul>
        </>
      ) : null}

      {!loading && <GuestInvites key={restricted ? "locked" : "open"} incidentId={incidentId} />}

      <AssignUserModal
        open={pickOpen}
        onClose={() => setPickOpen(false)}
        title="Add participant"
        onSelect={(userId) => {
          if (userId) void addMember(userId);
        }}
      />
    </div>
  );
}
