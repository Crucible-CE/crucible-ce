"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, BellRing } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Mode = "none" | "watch" | "mute";

// Compact follow/mute control for an incident. Cycles none -> watch -> mute.
// "watch" pulls in collaboration-level activity even off-roster; "mute"
// silences everything but critical pages.
export function SubscribeToggle({ incidentId }: { incidentId: string }) {
  const [mode, setMode] = useState<Mode>("none");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/incidents/${incidentId}/subscription`);
      if (res.ok) setMode((await res.json()).mode ?? "none");
    } catch { /* transient */ }
  }, [incidentId]);
  useEffect(() => { void load(); }, [load]);

  const set = async (next: Mode) => {
    setBusy(true);
    const prev = mode;
    setMode(next);
    try {
      const res = await fetch(`/api/incidents/${incidentId}/subscription`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: next }),
      });
      if (!res.ok) throw new Error();
      toast.success(next === "watch" ? "Following" : next === "mute" ? "Muted. Critical pages still reach you." : "Default notifications");
    } catch {
      setMode(prev);
      toast.error("Couldn't update. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const next: Mode = mode === "none" ? "watch" : mode === "watch" ? "mute" : "none";
  const Icon = mode === "watch" ? BellRing : mode === "mute" ? BellOff : Bell;
  const label = mode === "watch" ? "Following" : mode === "mute" ? "Muted" : "Follow";

  return (
    <button
      onClick={() => set(next)}
      disabled={busy}
      title={`Notifications: ${mode}. Click for ${next === "none" ? "default" : next}.`}
      className={cn(
        "mt-2 flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-60",
        mode === "watch"
          ? "border-[color:var(--mist-indigo)]/40 bg-[color:var(--mist-indigo)]/10 text-[color:var(--mist-indigo)]"
          : mode === "mute"
            ? "border-[color:var(--color-border)] bg-[color:var(--color-muted)] text-[color:var(--color-muted-foreground)]"
            : "border-[color:var(--color-border)] text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-muted)]",
      )}
    >
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );
}
