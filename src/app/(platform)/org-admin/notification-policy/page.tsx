"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ShieldCheck, Loader2, Lock, Check, X, Minus, Users, Zap } from "lucide-react";
import { toast } from "sonner";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { cn } from "@/lib/utils";

type Channel = "in_app" | "push" | "email" | "sms";
// "push" stays in the type (the catalog and API carry it) but is not shown:
// mobile push is a Crucible Cloud feature and a no-op in CE (src/lib/push).
const CHANNELS: { key: Channel; label: string }[] = [
  { key: "in_app", label: "In-app" },
  { key: "email", label: "Email" },
  { key: "sms", label: "SMS" },
];
type Lock = "user_choice" | "force_on" | "force_off";
const NEXT: Record<Lock, Lock> = { user_choice: "force_on", force_on: "force_off", force_off: "user_choice" };

interface Cell { available: boolean; lock: Lock; default: boolean }
interface Category { code: string; group: string; label: string; description: string; urgency: string; channels: Record<Channel, Cell> }

const URGENCY_STYLE: Record<string, string> = {
  critical: "bg-[color:var(--mist-danger)]/15 text-[color:var(--mist-danger)]",
  high: "bg-[color:var(--mist-amber)]/15 text-[color:var(--mist-amber)]",
  normal: "bg-[color:var(--mist-indigo)]/15 text-[color:var(--mist-indigo)]",
  low: "bg-[color:var(--color-muted)] text-[color:var(--color-muted-foreground)]",
};

function LockGlyph({ lock }: { lock: Lock }) {
  if (lock === "force_on") return <span title="Forced on. Users can't turn it off."><Lock className="h-3 w-3 text-[color:var(--mist-emerald)]" /></span>;
  if (lock === "force_off") return <span title="Forced off. Users can't turn it on."><X className="h-3.5 w-3.5 text-[color:var(--mist-danger)]" /></span>;
  return <span title="User decides"><Minus className="h-3.5 w-3.5 text-muted-foreground/40" /></span>;
}

export default function NotificationPolicyPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [criticalBreaksDnd, setCriticalBreaksDnd] = useState(true);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  useUnsavedChangesGuard(dirty, { message: "You have unsaved changes." });

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/notification-policy");
    if (res.status === 403) { setForbidden(true); setLoading(false); return; }
    if (res.ok) {
      const d = await res.json();
      setCategories(d.categories);
      setCriticalBreaksDnd(d.criticalBreaksDnd);
    }
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const cycle = (code: string, ch: Channel) => {
    setCategories((cats) => cats.map((c) => {
      if (c.code !== code) return c;
      const cell = c.channels[ch];
      if (!cell.available) return c;
      return { ...c, channels: { ...c.channels, [ch]: { ...cell, lock: NEXT[cell.lock] } } };
    }));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    const policies = categories.flatMap((c) =>
      CHANNELS.filter(({ key }) => c.channels[key].available).map(({ key }) => ({ categoryCode: c.code, channel: key, lock: c.channels[key].lock })),
    );
    const res = await fetch("/api/admin/notification-policy", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ policies, criticalBreaksDnd }),
    });
    setSaving(false);
    if (res.ok) { const d = await res.json(); setCategories(d.categories); setCriticalBreaksDnd(d.criticalBreaksDnd); setDirty(false); toast.success("Policy saved"); }
    else toast.error("Couldn't save. Try again.");
  };

  if (loading) return <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  if (forbidden) return (
    <div className="mx-auto max-w-lg rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-8 text-center">
      <Lock className="mx-auto h-8 w-8 text-muted-foreground" />
      <h2 className="mt-3 text-base font-semibold">Restricted</h2>
      <p className="mt-1 text-sm text-muted-foreground">Requires the <span className="font-mono">admin.access</span> permission.</p>
    </div>
  );

  const groups = [...new Set(categories.map((c) => c.group))];

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-24">
      <div>
        <a href="/org-profile" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Organization</a>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[color:var(--mist-indigo)]/15 text-[color:var(--mist-indigo)]"><ShieldCheck className="h-5 w-5" /></div>
          <div>
            <h1 className="text-lg font-semibold">Notification policy</h1>
            <p className="text-sm text-muted-foreground">Lock channels for everyone. Locks override personal settings.</p>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)] px-4 py-3 text-xs">
        <span className="font-semibold text-muted-foreground">Click a cell to change it:</span>
        <span className="inline-flex items-center gap-1"><Minus className="h-3.5 w-3.5 text-muted-foreground/40" /> User decides</span>
        <span className="inline-flex items-center gap-1"><Lock className="h-3 w-3 text-[color:var(--mist-emerald)]" /> Forced on</span>
        <span className="inline-flex items-center gap-1"><X className="h-3.5 w-3.5 text-[color:var(--mist-danger)]" /> Forced off</span>
      </div>

      {/* Matrix — horizontal scroll on narrow viewports so the dense
          channel columns don't crush the labels on a phone/tablet. */}
      <div className="overflow-x-auto rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)]">
       <div className="min-w-[520px]">
        <div className="flex items-center gap-2 border-b border-[color:var(--color-border)] px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <div className="flex-1">Activity</div>
          {CHANNELS.map((c) => <div key={c.key} className="w-12 text-center">{c.label}</div>)}
        </div>
        {groups.map((group) => (
          <div key={group}>
            <div className="bg-[color:var(--color-muted)]/40 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{group}</div>
            {categories.filter((c) => c.group === group).map((c) => (
              <div key={c.code} className="flex items-center gap-2 border-t border-[color:var(--color-border)] px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{c.label}</span>
                    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase", URGENCY_STYLE[c.urgency])}>{c.urgency}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{c.description}</p>
                </div>
                {CHANNELS.map(({ key }) => {
                  const cell = c.channels[key];
                  return (
                    <div key={key} className="flex w-12 justify-center">
                      {!cell.available ? <span className="text-muted-foreground/30">n/a</span> : (
                        <button onClick={() => cycle(c.code, key)} className="flex h-7 w-7 items-center justify-center rounded-md border border-[color:var(--color-border)] hover:bg-[color:var(--color-muted)]">
                          <LockGlyph lock={cell.lock} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ))}
       </div>
      </div>

      {/* Floors */}
      <div className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-[color:var(--mist-amber)]" />
            <div>
              <p className="text-sm font-medium">Critical pages break Do-Not-Disturb</p>
              <p className="text-xs text-muted-foreground">Critical pages ignore quiet hours.</p>
            </div>
          </div>
          <button
            onClick={() => { setCriticalBreaksDnd((v) => !v); setDirty(true); }}
            role="switch" aria-checked={criticalBreaksDnd}
            className={cn("h-5 w-9 shrink-0 rounded-full transition-colors", criticalBreaksDnd ? "bg-[color:var(--mist-indigo)]" : "bg-[color:var(--color-muted)]")}
          >
            <span className={cn("block h-4 w-4 translate-x-0.5 rounded-full bg-white transition-transform", criticalBreaksDnd && "translate-x-[18px]")} />
          </button>
        </div>
      </div>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Users className="h-3.5 w-3.5" /> Forced cells show as locked in each member&apos;s settings.</p>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-[color:var(--color-border)] bg-[color:var(--color-background)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-end px-4 py-3">
          <button onClick={save} disabled={!dirty || saving} className="inline-flex items-center gap-1.5 rounded-md bg-[color:var(--mist-indigo)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {saving ? "Saving…" : dirty ? "Save policy" : "Saved"}
          </button>
        </div>
      </div>
    </div>
  );
}
