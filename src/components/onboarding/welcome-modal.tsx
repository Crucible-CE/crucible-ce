"use client";

// First-login welcome (once per member). Rendered by the Ops Room only while
// the member has not dismissed it; "Start setup" and "Skip for now" (and
// closing it any other way) both record the dismissal, so it never returns.

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Network, Rocket, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function WelcomeModal({ isAdmin, orgName }: { isAdmin: boolean; orgName: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [starting, setStarting] = useState(false);

  const dismiss = useCallback(
    () =>
      fetch("/api/onboarding/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss_welcome" }),
      }).catch(() => undefined),
    [],
  );

  const start = useCallback(async () => {
    setStarting(true);
    await dismiss();
    setOpen(false);
    router.push(isAdmin ? "/onboarding?tab=org" : "/onboarding");
  }, [dismiss, isAdmin, router]);

  const onOpenChange = useCallback(
    (next: boolean) => {
      if (!next && open) void dismiss();
      setOpen(next);
    },
    [open, dismiss],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-[var(--radius-md)] bg-[color:var(--mist-indigo-soft)]">
            <Sparkles className="h-5 w-5 text-[color:var(--mist-indigo)]" />
          </div>
          <DialogTitle>Welcome to Crucible CE</DialogTitle>
          <DialogDescription>
            {isAdmin
              ? `${orgName ? `${orgName} is set up. ` : ""}Run incidents, page your team and export case files.`
              : "Run incidents and get paged here."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-[13px] leading-relaxed">
          <div className="flex gap-3 rounded-[var(--radius-md)] bg-[color:var(--color-muted)] p-3">
            <Network className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--mist-indigo)]" />
            <div className="space-y-2 text-[color:var(--color-muted-foreground)]">
              <p>
                <span className="font-semibold text-[color:var(--color-foreground)]">Run it outside your network.</span>{" "}
                {isAdmin ? "How you host it and secure access is up to you." : "Your administrator decides how it is hosted and secured."}
              </p>
              <p>
                <span className="font-semibold text-[color:var(--color-foreground)]">No SSO, on purpose.</span> Use two-factor sign-in.
                {isAdmin ? " You can require it in Org admin." : ""}
              </p>
            </div>
          </div>
          <p className="text-[color:var(--color-muted-foreground)]">
            {isAdmin
              ? "Setup takes about 15 minutes."
              : "Setup takes about 5 minutes."}
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex h-10 w-full items-center justify-center rounded-[var(--radius-md)] bg-[color:var(--color-card)] px-4 text-[13px] font-semibold shadow-[var(--elevation-0)] hover:bg-[color:var(--color-muted)] sm:w-auto"
          >
            Skip for now
          </button>
          <button
            type="button"
            onClick={start}
            disabled={starting}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[color:var(--color-primary)] px-4 text-[13px] font-semibold text-[color:var(--color-primary-foreground)] transition-colors hover:bg-[color:var(--mist-navy-hi)] disabled:opacity-60 sm:w-auto"
          >
            {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
            Start setup
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
