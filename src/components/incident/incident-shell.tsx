"use client";

// Shared war-room state provided by the incident layout to every incident
// sub-page: whether the viewer may edit (the lock is read-only except for the
// IC and administrators; readers never edit) and a `refresh()` that re-reads
// the incident summary so side cards don't go stale after a status change.

import { createContext, useContext } from "react";
import { Lock } from "lucide-react";
import { INCIDENT_LOCKED_MESSAGE } from "@/lib/incident/lock-shared";

export interface IncidentShell {
  /** The viewer may not change this incident (lock or role). Hide edit controls. */
  readOnly: boolean;
  /** Read-only specifically because the incident is locked. */
  lockReadOnly: boolean;
  /** Re-read the incident summary shown by the layout. */
  refresh: () => void;
}

const IncidentShellContext = createContext<IncidentShell>({
  readOnly: false,
  lockReadOnly: false,
  refresh: () => {},
});

export const IncidentShellProvider = IncidentShellContext.Provider;

export function useIncidentShell(): IncidentShell {
  return useContext(IncidentShellContext);
}

/** "Locked — read-only" banner shown across the war room for non-exempt viewers. */
export function LockedReadOnlyBanner() {
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[color:var(--mist-danger)]/30 bg-[color:var(--mist-danger)]/5 px-3 py-2 text-[12.5px]"
    >
      <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--mist-danger)]" />
      <span>
        <span className="font-semibold text-[color:var(--mist-danger)]">Locked.</span>{" "}
        <span className="text-[color:var(--color-muted-foreground)]">
          {INCIDENT_LOCKED_MESSAGE.replace(/^Locked\.\s*/, "")}
        </span>
      </span>
    </div>
  );
}
