"use client";

import { useCallback, useEffect, useState } from "react";
import { Mail, MessageSquare, PhoneCall, Webhook, Plug, BellRing, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

// Recent pages for an incident with an honest per-channel delivery report:
// sent / failed (with retry state) / skipped (not configured, no address,
// rate limited). Polls while any page is still open.

interface Delivery {
  provider: string;
  channel: string;
  level: number;
  attempt: number;
  status: string;
  error: string | null;
  nextRetryAt: string | null;
}

interface PageRow {
  id: string;
  targetLabel: string | null;
  message: string | null;
  status: string;
  escalationLevel: number;
  ackDeadlineAt: string | null;
  acknowledgedAt: string | null;
  acknowledgedVia: string | null;
  createdAt: string;
  deliveries: Delivery[];
}

const CHANNEL_ICON: Record<string, typeof Mail> = {
  email: Mail,
  sms: MessageSquare,
  voice: PhoneCall,
  webhook: Webhook,
  push: BellRing,
  custom: Plug,
};

const PAGE_STATUS: Record<string, { label: string; cls: string }> = {
  sent: { label: "Awaiting ack", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  acked: { label: "Acknowledged", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  expired: { label: "Expired", cls: "bg-red-500/15 text-red-700 dark:text-red-300" },
  cancelled: { label: "Cancelled", cls: "bg-[color:var(--color-muted)] text-[color:var(--color-muted-foreground)]" },
};

function deliveryLabel(d: Delivery): { text: string; cls: string } {
  if (d.status === "sent") return { text: d.attempt > 1 ? `sent (attempt ${d.attempt})` : "sent", cls: "text-emerald-600 dark:text-emerald-400" };
  if (d.status === "pending") return { text: "sending", cls: "text-[color:var(--color-muted-foreground)]" };
  if (d.status === "failed") return { text: d.nextRetryAt ? `failed, retrying (attempt ${d.attempt})` : `failed (attempt ${d.attempt})`, cls: "text-red-600 dark:text-red-400" };
  return { text: `skipped${d.error ? `: ${d.error}` : ""}`, cls: "text-[color:var(--color-muted-foreground)]" };
}

export function PageDeliveries({ incidentId, refreshKey }: { incidentId: string; refreshKey: number }) {
  const [pages, setPages] = useState<PageRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/incidents/${incidentId}/page`, { cache: "no-store" });
      if (res.ok) setPages(((await res.json()) as { pages: PageRow[] }).pages);
    } finally {
      setLoading(false);
    }
  }, [incidentId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const anyOpen = pages?.some((p) => p.status === "sent") ?? false;
  useEffect(() => {
    if (!anyOpen) return;
    const t = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(t);
  }, [anyOpen, load]);

  return (
    <section className="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4 lg:col-span-2">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Pages &amp; delivery</h2>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1 text-[11px] text-[color:var(--mist-indigo)]" aria-label="Refresh pages">
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Refresh
        </button>
      </div>
      {!pages || pages.length === 0 ? (
        <p className="py-4 text-center text-xs text-[color:var(--color-muted-foreground)]">No pages sent.</p>
      ) : (
        <ul className="space-y-2">
          {pages.map((p) => {
            const st = PAGE_STATUS[p.status] ?? { label: p.status, cls: "" };
            const current = p.deliveries.filter((d) => d.level === p.escalationLevel);
            return (
              <li key={p.id} className="rounded-[var(--radius-md)] border border-[color:var(--color-border)] p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 text-[13px] font-medium">
                    {p.targetLabel ?? "Responder"}
                    {p.escalationLevel > 0 && <span className="text-[color:var(--color-muted-foreground)]"> · escalated (level {p.escalationLevel})</span>}
                  </div>
                  <span className={cn("rounded px-1.5 py-0.5 text-[10.5px] font-semibold", st.cls)}>
                    {st.label}
                    {p.status === "acked" && p.acknowledgedVia ? ` via ${p.acknowledgedVia}` : ""}
                  </span>
                </div>
                {p.message && <p className="mt-0.5 text-[11.5px] text-[color:var(--color-muted-foreground)]">{p.message}</p>}
                <ul className="mt-1.5 space-y-0.5">
                  {current.length === 0 ? (
                    <li className="text-[11px] text-[color:var(--color-muted-foreground)]">In-app only.</li>
                  ) : (
                    current.map((d) => {
                      const Icon = CHANNEL_ICON[d.channel] ?? Plug;
                      const l = deliveryLabel(d);
                      return (
                        <li key={`${d.level}:${d.provider}`} className="flex items-start gap-1.5 text-[11.5px]" title={d.error ?? undefined}>
                          <Icon className="mt-0.5 h-3 w-3 shrink-0 text-[color:var(--color-muted-foreground)]" />
                          <span className="font-mono">{d.provider}</span>
                          <span className={cn("min-w-0 break-words", l.cls)}>{l.text}</span>
                        </li>
                      );
                    })
                  )}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
