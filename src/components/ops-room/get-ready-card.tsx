"use client";

// Compact "Onboarding · 3 of 9 done" card at the top of the Ops Room while
// onboarding is incomplete. "Hide" is per member (it can be brought back from
// /onboarding); the full checklist lives on /onboarding.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Rocket, X } from "lucide-react";
import type { GetReadyCard as Card } from "@/lib/onboarding/steps";

export function GetReadyCard({ card }: { card: Card }) {
  const router = useRouter();
  const [hiding, setHiding] = useState(false);
  const { primary, secondary } = card;
  const isOrg = primary.key === "org";
  const href = isOrg ? "/onboarding?tab=org" : "/onboarding";

  const hide = async () => {
    setHiding(true);
    try {
      await fetch("/api/onboarding/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "hide_card" }),
      });
      router.refresh();
    } finally {
      setHiding(false);
    }
  };

  return (
    <section
      aria-label="Onboarding"
      data-testid="get-ready-card"
      className="rounded-[var(--radius-lg)] border border-[color:var(--mist-indigo)]/25 bg-[color:var(--mist-indigo-softer)] p-4 shadow-[var(--elevation-1)]"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[color:var(--mist-indigo-soft)]">
          <Rocket className="h-4 w-4 text-[color:var(--mist-indigo)]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h2 className="text-[14px] font-semibold">
              Onboarding <span className="font-normal text-[color:var(--color-muted-foreground)]">·</span>{" "}
              <span className="tabular-nums">
                {primary.done} of {primary.total} done
              </span>
            </h2>
            <span className="text-[12px] text-[color:var(--color-muted-foreground)]">
              {isOrg ? "Organization setup" : "Your setup"}
              {secondary ? ` · Your setup ${secondary.done}/${secondary.total}` : ""}
            </span>
          </div>
          <div
            className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--color-muted)]"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={primary.pct}
            aria-label="Setup progress"
          >
            <div className="h-full rounded-full bg-[color:var(--mist-indigo)] transition-all" style={{ width: `${primary.pct}%` }} />
          </div>
          {primary.next && (
            <p className="mt-2 truncate text-[12.5px] text-[color:var(--color-muted-foreground)]">
              Next: <span className="font-medium text-[color:var(--color-foreground)]">{primary.next.label}</span>
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Link
              href={href}
              className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-md)] bg-[color:var(--color-primary)] px-3 text-[12.5px] font-semibold text-[color:var(--color-primary-foreground)] hover:bg-[color:var(--mist-navy-hi)]"
            >
              Continue setup
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
            <button
              type="button"
              onClick={hide}
              disabled={hiding}
              className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-md)] px-2.5 text-[12.5px] font-medium text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-muted)] hover:text-[color:var(--color-foreground)] disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" />
              Hide
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
