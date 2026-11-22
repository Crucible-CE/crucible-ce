"use client";

// Who sees Cloud notes, and which ones this user dismissed. The platform
// layout provides it for signed-in facilitators and administrators. Pages
// outside the platform shell (play, join, present) have no provider, so a
// note can never render there.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { CloudNoteKey, CloudNotesState } from "@/lib/cloud/notes";

interface CloudNotesContextValue {
  enabled: boolean;
  trial: boolean;
  isDismissed(key: CloudNoteKey): boolean;
  dismiss(key: CloudNoteKey): void;
}

const CloudNotesContext = createContext<CloudNotesContextValue | null>(null);

export function CloudNotesProvider({ state, children }: { state: CloudNotesState; children: ReactNode }) {
  const [dismissed, setDismissed] = useState<Set<CloudNoteKey>>(() => new Set(state.dismissed));
  const dismiss = useCallback((key: CloudNoteKey) => {
    setDismissed((prev) => new Set(prev).add(key));
    void fetch("/api/cloud-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: key }),
    }).catch(() => {});
  }, []);
  const value = useMemo<CloudNotesContextValue>(
    () => ({ enabled: state.enabled, trial: state.trial, isDismissed: (k) => dismissed.has(k), dismiss }),
    [state.enabled, state.trial, dismissed, dismiss],
  );
  return <CloudNotesContext.Provider value={value}>{children}</CloudNotesContext.Provider>;
}

/** The notes context, or null outside the platform shell. */
export function useCloudNotes(): CloudNotesContextValue | null {
  return useContext(CloudNotesContext);
}
