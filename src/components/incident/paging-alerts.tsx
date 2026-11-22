"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Siren } from "lucide-react";
import { useNotificationSocket } from "@/lib/socket/client";
import type { NotificationPayload } from "@/lib/socket/events";

// Two short attention pulses via the Web Audio API — no asset needed.
function beep() {
  try {
    const Ctx = window.AudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.08;
    osc.start();
    window.setTimeout(() => (osc.frequency.value = 660), 200);
    window.setTimeout(() => {
      osc.stop();
      void ctx.close();
    }, 450);
  } catch {
    // Audio may be blocked before a user gesture — non-fatal.
  }
}

// Global, intrusive "you've been paged" popup. Listens on the per-user
// notification socket; an incident_page notification arrives within ~1s of being
// sent, well inside the 10–15s target, with a polling-backed fallback via the
// NotificationBell. Acknowledging records a page_acked ledger entry.
export function PagingAlerts() {
  const { data: session } = useSession();
  const userId = session?.user?.id ?? "";
  const router = useRouter();
  const [page, setPage] = useState<NotificationPayload | null>(null);

  useNotificationSocket(userId, (n) => {
    if (n.type === "incident_page") {
      setPage(n);
      beep();
    }
  });

  if (!page) return null;

  const incidentId = typeof page.metadata?.incidentId === "string" ? page.metadata.incidentId : "";
  const link = page.link ?? (incidentId ? `/incidents/${incidentId}` : "/incidents");
  // A page for a LOCKED incident the user can't see carries no incident id:
  // its link is the signed ack landing page (a full navigation, not a route).
  const restricted = page.metadata?.restricted === true;

  const ack = async () => {
    if (restricted) {
      window.location.assign(link);
      return;
    }
    if (incidentId) {
      try {
        await fetch(`/api/incidents/${incidentId}/page/ack`, { method: "POST" });
      } catch {
        // best-effort
      }
    }
    setPage(null);
  };

  const open = async () => {
    if (restricted) {
      window.location.assign(link);
      return;
    }
    await ack();
    router.push(link);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center p-4 pt-24" role="alertdialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative w-full max-w-md overflow-hidden rounded-[var(--radius-lg)] border-2 border-[color:var(--mist-danger)] bg-[color:var(--color-card)] shadow-[var(--elevation-3)]">
        <div className="flex items-center gap-2 bg-[color:var(--mist-danger)] px-4 py-2.5 text-white">
          <Siren className="h-5 w-5 animate-pulse" />
          <span className="text-sm font-bold uppercase tracking-wide">You&apos;ve been paged</span>
        </div>
        <div className="p-4">
          <p className="text-sm font-semibold">{page.title}</p>
          <p className="mt-1 text-[13px] text-[color:var(--color-muted-foreground)]">{page.body}</p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={ack} className="rounded-[var(--radius-md)] border border-[color:var(--color-border)] px-3 py-1.5 text-[13px]">
              Acknowledge
            </button>
            <button type="button" onClick={open} className="rounded-[var(--radius-md)] bg-[color:var(--mist-danger)] px-3 py-1.5 text-[13px] font-semibold text-white">
              Open incident
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
