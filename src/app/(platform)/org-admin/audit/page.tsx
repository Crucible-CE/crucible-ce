"use client";

import { useCallback, useEffect, useState } from "react";
import { ScrollText, Loader2, Lock, Search, KeyRound } from "lucide-react";

interface AuditEvent {
  id: string;
  actorUserId: string;
  actorName: string | null;
  actorEmail: string | null;
  organizationId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  targetLabel: string | null;
  createdAt: string;
}

interface ActivityEvent {
  id: string;
  userId: string | null;
  organizationId: string | null;
  action: string;
  emailHash: string | null;
  path: string | null;
  statusCode: number | null;
  ipLastOctet: string | null;
  userAgent: string | null;
  createdAt: string;
}

type Tab = "admin" | "activity";

const ACTIVITY_LABEL: Record<string, string> = {
  "login.success": "Signed in",
  "login.failure": "Failed sign-in",
  logout: "Signed out",
  "password.changed": "Password changed",
  "session.revoked": "Sessions revoked",
  "email.verified": "Email verified",
  "mfa.success": "Two-factor passed",
  "mfa.failure": "Two-factor failed",
  "mfa.enabled": "Two-factor method added",
  "mfa.disabled": "Two-factor method removed",
  "mfa.recovery_regenerated": "Recovery codes regenerated",
  "mfa.reset_by_admin": "Two-factor reset by an admin",
};

export default function OrgAuditPage() {
  const [tab, setTab] = useState<Tab>("admin");
  const [events, setEvents] = useState<(AuditEvent | ActivityEvent)[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async (reset: boolean) => {
    const params = new URLSearchParams();
    if (filter.trim()) params.set("action", filter.trim());
    if (!reset && cursor) params.set("cursor", cursor);
    const endpoint = tab === "admin" ? "/api/admin/audit/org" : "/api/admin/audit/activity";
    const res = await fetch(`${endpoint}?${params}`);
    if (res.status === 403) { setForbidden(true); setLoading(false); return; }
    if (res.ok) {
      const d = await res.json();
      setEvents((prev) => (reset ? d.events : [...prev, ...d.events]));
      setCursor(d.nextCursor);
      setHasMore(!!d.nextCursor);
    }
    setLoading(false);
  }, [filter, cursor, tab]);

  useEffect(() => {
    setEvents([]); setCursor(null); setLoading(true);
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  if (forbidden) return (
    <div className="mx-auto max-w-lg rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-8 text-center">
      <Lock className="mx-auto h-8 w-8 text-muted-foreground" />
      <h2 className="mt-3 text-base font-semibold">Restricted</h2>
      <p className="mt-1 text-sm text-muted-foreground">Requires the <span className="font-mono">admin.access</span> permission.</p>
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[color:var(--mist-indigo)]/15 text-[color:var(--mist-indigo)]"><ScrollText className="h-5 w-5" /></div>
        <div>
          <h1 className="text-lg font-semibold">Audit log</h1>
          <p className="text-sm text-muted-foreground">Privileged actions and sign-in activity in your organization.</p>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-[color:var(--color-border)]">
        {([
          { key: "admin", label: "Admin actions", icon: ScrollText },
          { key: "activity", label: "Sign-in activity", icon: KeyRound },
        ] as { key: Tab; label: string; icon: typeof ScrollText }[]).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === key
                ? "border-[color:var(--mist-indigo)] text-[color:var(--mist-indigo)]"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { setEvents([]); setCursor(null); setLoading(true); void load(true); } }}
            placeholder={tab === "admin" ? "Filter by action, like user.update" : "Filter by action, like login.failure"}
            className="w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-background)] py-2 pl-8 pr-3 text-sm"
          />
        </div>
      </div>

      {tab === "activity" && (
        <p
          className="text-[11px] text-muted-foreground"
        >
          Only manual sign-outs are logged, not expired sessions. IPs are stored hashed. Only the last
          octet is shown.
        </p>
      )}

      {loading && events.length === 0 ? (
        <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : events.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[color:var(--color-border)] p-8 text-center text-sm text-muted-foreground">
          {tab === "admin" ? "No audit events yet." : "No sign-in activity yet."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)]">
          {tab === "admin"
            ? (events as AuditEvent[]).map((e) => (
                <div key={e.id} className="flex items-start gap-3 border-b border-[color:var(--color-border)] px-4 py-2.5 last:border-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[12px] font-semibold text-[color:var(--mist-indigo)]">{e.action}</span>
                      <span className="text-xs text-muted-foreground">{e.targetType}{e.targetLabel ? ` · ${e.targetLabel}` : ""}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">{e.actorName ?? e.actorEmail ?? e.actorUserId}</div>
                  </div>
                  <div className="whitespace-nowrap text-[11px] text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</div>
                </div>
              ))
            : (events as ActivityEvent[]).map((e) => (
                <div key={e.id} className="flex items-start gap-3 border-b border-[color:var(--color-border)] px-4 py-2.5 last:border-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`font-mono text-[12px] font-semibold ${e.action === "login.failure" || e.action === "mfa.failure" ? "text-[color:var(--mist-warn)]" : "text-[color:var(--mist-indigo)]"}`}>
                        {ACTIVITY_LABEL[e.action] ?? e.action}
                      </span>
                      {e.ipLastOctet && <span className="text-xs text-muted-foreground">IP …{e.ipLastOctet}</span>}
                      {e.statusCode !== null && <span className="text-xs text-muted-foreground">{e.statusCode}</span>}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {e.userId ?? (e.emailHash ? `unknown email (hash ${e.emailHash.slice(0, 12)}…)` : "unknown user")}
                      {e.userAgent ? ` · ${e.userAgent.slice(0, 80)}` : ""}
                    </div>
                  </div>
                  <div className="whitespace-nowrap text-[11px] text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</div>
                </div>
              ))}
        </div>
      )}

      {hasMore && (
        <div className="flex justify-center">
          <button onClick={() => void load(false)} className="rounded-md border border-[color:var(--color-border)] px-4 py-2 text-sm hover:bg-[color:var(--color-muted)]">Load more</button>
        </div>
      )}
    </div>
  );
}
