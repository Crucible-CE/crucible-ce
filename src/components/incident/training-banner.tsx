"use client";

// Persistent banner inside a training incident's war room (lib/incident/training),
// so a drill is never read as a real event, with a short guide. Opening the
// room records presence, which the onboarding step counts as "opened".
// The guide's collapsed state is remembered per incident in localStorage.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, GraduationCap, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";

const GUIDE: { title: string; detail: string; seg: string }[] = [
  { title: "Tasks", detail: "Take a task or add one of your own.", seg: "" },
  { title: "Actions", detail: "Approve the containment action or propose another.", seg: "scope" },
  { title: "Status update", detail: "Post one from Comms.", seg: "comms" },
  { title: "Postmortem", detail: "Draft one for practice.", seg: "postmortem" },
];

export function TrainingBanner({ incidentId }: { incidentId: string }) {
  const router = useRouter();
  const confirm = useConfirm();
  const base = `/incidents/${incidentId}`;
  const storageKey = `training-guide-collapsed:${incidentId}`;
  const [collapsed, setCollapsed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(storageKey) === "1");
    } catch {
      /* storage unavailable */
    }
    void fetch(`/api/incidents/${incidentId}/presence`, { method: "POST" }).catch(() => {});
  }, [incidentId, storageKey]);

  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(storageKey, c ? "0" : "1");
      } catch {
        /* storage unavailable */
      }
      return !c;
    });
  };

  const reset = async () => {
    const ok = await confirm({ title: "Reset the training incident?", description: "Your work in it is deleted.", confirmLabel: "Reset", destructive: true });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch("/api/onboarding/training/reset", { method: "POST" });
      if (!res.ok) {
        toast.error("The reset did not go through. Try again.");
        return;
      }
      toast.success("Training incident reset");
      router.push("/onboarding?tab=you");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="training-banner"
      className="overflow-hidden rounded-[var(--radius-md)] border-2 border-[color:var(--mist-amber)] bg-[color:var(--mist-amber)]/10"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--mist-amber)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
          <GraduationCap className="h-3.5 w-3.5" /> Training incident
        </span>
        <p className="text-[12.5px] font-medium">Practice only. Nothing here pages, notifies or reaches anyone outside this room.</p>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          className="ml-auto inline-flex items-center gap-1 text-[12px] font-medium text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]"
        >
          {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          {collapsed ? "Show guide" : "Hide guide"}
        </button>
      </div>
      {!collapsed && (
        <div className="border-t border-[color:var(--mist-amber)]/40 bg-[color:var(--color-card)] px-4 py-3">
          <ol className="space-y-1.5">
            {GUIDE.map((g, i) => (
              <li key={g.title} className="flex items-start gap-2.5 text-[12.5px]">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[color:var(--mist-amber)]/20 text-[10px] font-bold">
                  {i + 1}
                </span>
                <span>
                  <Link href={g.seg ? `${base}/${g.seg}` : base} className="font-semibold hover:underline">
                    {g.title}.
                  </Link>{" "}
                  <span className="text-[color:var(--color-muted-foreground)]">{g.detail}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Link
              href="/onboarding?tab=you"
              className="inline-flex h-8 items-center rounded-[var(--radius-md)] bg-[color:var(--color-primary)] px-3 text-[12px] font-semibold text-[color:var(--color-primary-foreground)] hover:bg-[color:var(--mist-navy-hi)]"
            >
              Back to onboarding
            </Link>
            <button
              type="button"
              onClick={() => void reset()}
              disabled={busy}
              className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] px-3 text-[12px] font-medium text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
