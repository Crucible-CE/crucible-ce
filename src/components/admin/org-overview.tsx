"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Users, MailPlus, Bell, ScrollText, Activity, AlertTriangle, Phone, Check, Building2, Timer, Gauge } from "lucide-react";
import { cn } from "@/lib/utils";

interface Overview {
  stats: { members: number; activeMembers: number; pendingInvites: number; openIncidents: number; recentAudit: number };
}

const QUICK = [
  { href: "/org-admin/organization", label: "Organization", icon: Building2 },
  { href: "/org-admin/members", label: "Members", icon: Users },
  { href: "/org-admin/notification-policy", label: "Notification policy", icon: Bell },
  { href: "/escalation-matrix", label: "Escalation matrix", icon: Phone },
  { href: "/org-admin/incident-slas", label: "Response SLAs", icon: Timer },
  { href: "/org-admin/incident-metrics", label: "Metrics", icon: Gauge },
  { href: "/org-admin/audit", label: "Audit log", icon: ScrollText },
];

export function OrgOverview() {
  const [d, setD] = useState<Overview | null>(null);

  useEffect(() => {
    fetch("/api/org-admin/overview").then((r) => (r.ok ? r.json() : null)).then(setD).catch(() => {});
  }, []);

  if (!d) return null;

  const stat = (label: string, value: number, icon: typeof Users, href?: string, warn?: boolean) => {
    const Icon = icon;
    const body = (
      <div className={cn("rounded-lg border bg-[color:var(--color-card)] p-3", warn ? "border-[color:var(--mist-amber)]/40" : "border-[color:var(--color-border)]")}>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className="h-3.5 w-3.5" /> {label}</div>
        <div className={cn("mt-1 text-2xl font-semibold", warn && "text-[color:var(--mist-amber)]")}>{value}</div>
      </div>
    );
    return href ? <Link key={label} href={href} className="transition hover:opacity-80">{body}</Link> : <div key={label}>{body}</div>;
  };

  return (
    <div className="mb-6 space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stat("Members", d.stats.members, Users, "/org-admin/members")}
        {stat("Active", d.stats.activeMembers, Check)}
        {stat("Pending invites", d.stats.pendingInvites, MailPlus, "/org-admin/members", d.stats.pendingInvites > 0)}
        {stat("Open incidents", d.stats.openIncidents, AlertTriangle, "/incidents", d.stats.openIncidents > 0)}
        {stat("Audit (7d)", d.stats.recentAudit, Activity, "/org-admin/audit")}
      </div>

      {/* Quick actions */}
      <div className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4">
        <span className="text-sm font-medium">Quick actions</span>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {QUICK.map((q) => {
            const Icon = q.icon;
            return (
              <Link key={q.href} href={q.href} className="flex flex-col items-center gap-1.5 rounded-md border border-[color:var(--color-border)] p-3 text-center text-xs transition hover:bg-[color:var(--color-muted)]">
                <Icon className="h-4 w-4 text-[color:var(--mist-indigo)]" />
                {q.label}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
