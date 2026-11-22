"use client";

import { useCallback, useEffect, useState } from "react";
import { Users, UserPlus, X, User } from "lucide-react";
import { toast } from "sonner";
import { AssignUserModal } from "./assign-user-modal";
import { useIncidentShell } from "./incident-shell";
import { apiErrorMessage } from "@/lib/incident/lock-shared";

const ROLES = [
  { key: "incident_commander", label: "Incident Commander" },
  { key: "comms_lead", label: "Comms Lead" },
  { key: "legal_lead", label: "Legal Lead" },
  { key: "tech_lead", label: "Tech Lead" },
  { key: "exec_sponsor", label: "Exec Sponsor" },
  { key: "scribe", label: "Scribe" },
] as const;

// Right-rail card: who's reporting + the full command structure. Each command
// role is assignable to any org member via the shared picker modal; every
// change writes a role_assigned entry to the incident ledger.
export function ResponseTeam({
  incidentId,
  reportedByName,
  onChange,
}: {
  incidentId: string;
  reportedByName: string | null;
  onChange?: () => void;
}) {
  const [assignments, setAssignments] = useState<Record<string, string | null>>({});
  const [memberNames, setMemberNames] = useState<Record<string, string>>({});
  const { readOnly, refresh } = useIncidentShell();
  const [loading, setLoading] = useState(true);
  // M7: only the reporter or an admin fills an empty IC seat; the current IC,
  // the reporter or an admin changes an occupied one (server-decided).
  const [canAssignIc, setCanAssignIc] = useState(false);
  const [modalRole, setModalRole] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [rRes, mRes] = await Promise.all([
      fetch(`/api/incidents/${incidentId}/roles`),
      fetch(`/api/org-members`),
    ]);
    if (rRes.ok) {
      const d = await rRes.json();
      const map: Record<string, string | null> = {};
      for (const r of d.roles ?? []) map[r.role] = r.userId;
      setAssignments(map);
      setCanAssignIc(!!d.canAssignIc);
    }
    if (mRes.ok) {
      const ms = await mRes.json();
      const nm: Record<string, string> = {};
      for (const m of ms) nm[m.id] = m.name ?? m.email;
      setMemberNames(nm);
    }
    setLoading(false);
  }, [incidentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const assign = async (role: string, userId: string | null) => {
    const res = await fetch(`/api/incidents/${incidentId}/roles`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, userId }),
    });
    if (res.ok) {
      await load();
      onChange?.();
      // The IC assignment changes who may edit a locked incident.
      refresh();
    } else toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't assign. Try again."));
  };

  return (
    <div className="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4">
      <div className="mb-3 flex items-center gap-2">
        <Users className="h-4 w-4 text-[color:var(--mist-indigo)]" />
        <h3 className="text-sm font-semibold">Response team</h3>
      </div>

      <div className="mb-3 flex items-center gap-2 border-b border-[color:var(--color-border)] pb-3">
        <User className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted-foreground)]" />
        <div>
          <p className="text-[10px] uppercase tracking-wide text-[color:var(--color-muted-foreground)]">Reported by</p>
          <p className="text-[13px] font-medium">{reportedByName ?? "Unknown"}</p>
        </div>
      </div>

      {loading ? (
        <div className="py-4 text-center text-xs text-[color:var(--color-muted-foreground)]">Loading…</div>
      ) : (
        <ul className="space-y-1">
          {ROLES.map((r) => {
            const uid = assignments[r.key];
            const name = uid ? memberNames[uid] ?? "Assigned" : null;
            return (
              <li key={r.key} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[12px] text-[color:var(--color-muted-foreground)]">{r.label}</p>
                  <p className={`truncate text-[13px] ${name ? "font-medium" : "italic text-[color:var(--color-muted-foreground)]/60"}`}>
                    {name ?? "Unassigned"}
                  </p>
                </div>
                {!readOnly && (r.key !== "incident_commander" || canAssignIc) && <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setModalRole(r.key)}
                    title="Assign user"
                    className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[color:var(--color-border)] px-1.5 py-1 text-[10.5px] hover:border-[color:var(--mist-indigo)]/50"
                  >
                    <UserPlus className="h-3 w-3" />
                    {name ? "Change" : "Assign"}
                  </button>
                  {uid && (
                    <button type="button" onClick={() => assign(r.key, null)} title="Clear" aria-label="Clear" className="text-[color:var(--color-muted-foreground)] hover:text-[color:var(--mist-danger)]">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>}
              </li>
            );
          })}
        </ul>
      )}

      <AssignUserModal
        open={modalRole !== null}
        onClose={() => setModalRole(null)}
        allowUnassign
        title={`Assign ${ROLES.find((r) => r.key === modalRole)?.label ?? "role"}`}
        onSelect={(userId) => {
          if (modalRole) void assign(modalRole, userId);
        }}
      />
    </div>
  );
}
