"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Siren, Loader2 } from "lucide-react";
import { toast } from "sonner";

// Top-bar emergency action. One click opens a CRITICAL incident and drops the
// responder straight into its command center (the war room). From that point on,
// every action — declaration, status changes, decisions, tasks, notes — is
// written to the incident's tamper-evident, hash-chained ledger.
export function UnderAttackButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function declareAttack() {
    if (busy) return;
    setBusy(true);
    try {
      const now = new Date();
      const res = await fetch("/api/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Active attack (${now.toLocaleString()})`,
          description:
            'Opened with "I am under attack". Suspected active compromise. Replace this with what you know.',
          severity: "critical",
          category: "active_attack",
        }),
      });
      if (res.status === 403) {
        toast.error("You don't have permission to open incidents.");
        return;
      }
      if (!res.ok) throw new Error();
      const incident = await res.json();

      toast.success("Critical incident opened");
      router.push(`/incidents/${incident.id}`);
    } catch {
      toast.error("Couldn't open the incident. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex shrink-0">
      <button
        type="button"
        onClick={() => declareAttack()}
        disabled={busy}
        aria-label="I am under attack. Open a critical incident."
        title="Open a critical incident"
        className="flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[color:var(--mist-danger)] px-2.5 py-1.5 text-[12px] font-bold uppercase tracking-wide text-white shadow-[var(--elevation-1)] transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--mist-danger)]/50 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Siren className="h-4 w-4" />}
        <span className="hidden sm:inline">I am under attack</span>
      </button>
    </div>
  );
}
