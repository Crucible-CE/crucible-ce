"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, usePathname } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard,
  BookOpen,
  MessagesSquare,
  Phone,
  Megaphone,
  FolderLock,
  Activity,
  CalendarDays,
  Newspaper,
  ClipboardCheck,
  ArrowLeft,
  FileArchive,
  Crosshair,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ensureSeenBaseline, markSectionSeen, seenQuery, SEEN_SECTIONS } from "@/lib/incident/section-seen";
import { SubscribeToggle } from "@/components/incident/subscribe-toggle";
import { IncidentShellProvider, LockedReadOnlyBanner } from "@/components/incident/incident-shell";
import { TrainingBanner } from "@/components/incident/training-banner";

interface Badge { count: number; kind: "new" | "action" }

// nav segment -> activity-badge section key (Command carries your task count).
const SEG_BADGE: Record<string, string> = {
  "": "tasks", chat: "chat", evidence: "evidence", comms: "comms",
  escalation: "escalation", calendar: "calendar", intel: "intel", sitrep: "sitrep",
};

function NavBadge({ b }: { b?: Badge }) {
  if (!b || b.count <= 0) return null;
  const action = b.kind === "action";
  return (
    <span
      className={cn(
        "ml-auto inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none",
        action ? "bg-[color:var(--mist-danger)] text-white" : "bg-[color:var(--mist-indigo)] text-white",
      )}
      aria-label={`${b.count} ${action ? "needs attention" : "new"}`}
    >
      {b.count > 9 ? "9+" : b.count}
    </span>
  );
}

// War Room Mode navigation. The global rail collapses to icons (platform-shell)
// and these grouped tabs become the war room's own left nav. Status is merged
// into SITREP, Stakeholders into Comms — so they aren't separate destinations.
interface NavItem { seg: string; label: string; icon: LucideIcon }
interface NavGroup { label: string; items: NavItem[] }

const GROUPS: NavGroup[] = [
  {
    label: "Respond",
    items: [
      { seg: "", label: "Command", icon: LayoutDashboard },
      { seg: "scope", label: "Scope", icon: Crosshair },
      { seg: "chat", label: "Chat", icon: MessagesSquare },
      { seg: "playbooks", label: "Playbooks", icon: BookOpen },
      { seg: "evidence", label: "Evidence", icon: FolderLock },
    ],
  },
  {
    label: "Coordinate",
    items: [
      { seg: "comms", label: "Comms", icon: Megaphone },
      { seg: "escalation", label: "Escalation", icon: Phone },
      { seg: "calendar", label: "Calendar", icon: CalendarDays },
      { seg: "intel", label: "Notes", icon: Newspaper },
    ],
  },
  {
    label: "Report",
    items: [
      { seg: "sitrep", label: "SITREP", icon: Activity },
      { seg: "postmortem", label: "Postmortem", icon: ClipboardCheck },
      { seg: "case-file", label: "Case file", icon: FileArchive },
    ],
  },
];

const SEV_COLOR: Record<string, string> = {
  critical: "var(--mist-danger)",
  high: "var(--mist-amber)",
  medium: "var(--mist-indigo)",
  low: "var(--color-muted-foreground)",
};

export default function IncidentWarRoomLayout({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const base = `/incidents/${id}`;
  const [incident, setIncident] = useState<{
    title: string;
    severity: string;
    status: string;
    lockReadOnly: boolean;
    viewerCanEdit: boolean;
    isTraining: boolean;
  } | null>(null);
  const [badges, setBadges] = useState<Record<string, Badge>>({});
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Re-read on navigation and whenever a page calls refresh() (e.g. after a
  // status change) so the side card never shows a stale status.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/incidents/${id}`, { cache: "no-store" });
        if (res.ok && !cancelled) {
          const d = await res.json();
          setIncident({
            title: d.title,
            severity: d.severity,
            status: d.status,
            lockReadOnly: d.lockReadOnly === true,
            viewerCanEdit: d.viewerCanEdit !== false,
            isTraining: d.isTraining === true,
          });
        }
      } catch { /* transient */ }
    })();
    return () => { cancelled = true; };
  }, [id, pathname, refreshKey]);

  const shell = useMemo(
    () => ({
      readOnly: incident ? !incident.viewerCanEdit : false,
      lockReadOnly: incident?.lockReadOnly ?? false,
      refresh,
    }),
    [incident, refresh],
  );

  // Baseline last-seen on first entry so old content doesn't flood the badges.
  useEffect(() => { ensureSeenBaseline(id); }, [id]);

  // Opening a "new"-type section marks it seen (clears its badge). Runs before
  // the badge fetch below so the cleared timestamp is sent.
  useEffect(() => {
    const seg = pathname === base ? "" : pathname.slice(base.length + 1).split("/")[0];
    const section = SEG_BADGE[seg];
    if (section && (SEEN_SECTIONS as readonly string[]).includes(section)) {
      markSectionSeen(id, section);
    }
  }, [pathname, id, base]);

  // Fetch + poll the activity badges (also refetches on navigation).
  useEffect(() => {
    let cancelled = false;
    const fetchBadges = async () => {
      try {
        const res = await fetch(`/api/incidents/${id}/badges?${seenQuery(id)}`);
        if (res.ok && !cancelled) {
          const d = await res.json();
          setBadges(d.badges ?? {});
        }
      } catch { /* transient */ }
    };
    void fetchBadges();
    const t = setInterval(fetchBadges, 20000);
    return () => { cancelled = true; clearInterval(t); };
  }, [id, pathname]);

  return (
    <IncidentShellProvider value={shell}>
    <div className="space-y-4">
      <div className="flex gap-6">
      {/* War-room left nav */}
      <aside className="sticky top-[calc(var(--nav-height)+1rem)] hidden h-fit w-52 shrink-0 self-start md:block">
        <Link href="/incidents" className="mb-3 inline-flex items-center gap-1.5 text-[12px] text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]">
          <ArrowLeft className="h-3.5 w-3.5" /> Incidents
        </Link>
        {incident && (
          <div className="mb-3 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-2.5">
            <div className="mb-1 flex items-center gap-1.5">
              <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase" style={{ backgroundColor: `${SEV_COLOR[incident.severity] ?? "var(--color-muted-foreground)"}22`, color: SEV_COLOR[incident.severity] ?? "var(--color-muted-foreground)" }}>
                {incident.severity}
              </span>
              <span className="text-[10px] uppercase tracking-wide text-[color:var(--color-muted-foreground)]">{incident.status}</span>
            </div>
            <p className="line-clamp-2 text-[12px] font-semibold leading-snug">{incident.title}</p>
            <SubscribeToggle incidentId={id} />
          </div>
        )}

        <nav className="space-y-4">
          {GROUPS.map((group) => (
            <div key={group.label}>
              <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--color-muted-foreground)]/70">{group.label}</p>
              <div className="space-y-0.5">
                {group.items.map((t) => {
                  const href = t.seg ? `${base}/${t.seg}` : base;
                  const active = t.seg ? pathname === href || pathname.startsWith(href + "/") : pathname === base;
                  const Icon = t.icon;
                  return (
                    <Link
                      key={t.seg || "command"}
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                        active
                          ? "bg-[color:var(--mist-indigo)]/10 text-[color:var(--mist-indigo)]"
                          : "text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-muted)] hover:text-[color:var(--color-foreground)]",
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {t.label}
                      {SEG_BADGE[t.seg] ? <NavBadge b={badges[SEG_BADGE[t.seg]]} /> : null}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      {/* Mobile: horizontal scroll nav (md:hidden) */}
      <div className="min-w-0 flex-1">
        <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-[color:var(--color-border)] pb-px md:hidden">
          {GROUPS.flatMap((g) => g.items).map((t) => {
            const href = t.seg ? `${base}/${t.seg}` : base;
            const active = t.seg ? pathname === href || pathname.startsWith(href + "/") : pathname === base;
            const Icon = t.icon;
            return (
              <Link key={t.seg || "command"} href={href} className={cn("flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2 text-[12.5px] font-medium", active ? "border-[color:var(--mist-indigo)] text-[color:var(--mist-indigo)]" : "border-transparent text-[color:var(--color-muted-foreground)]")}>
                <Icon className="h-3.5 w-3.5" /> {t.label}
                {SEG_BADGE[t.seg] ? <NavBadge b={badges[SEG_BADGE[t.seg]]} /> : null}
              </Link>
            );
          })}
        </nav>
        {incident?.isTraining && (
          <div className="mb-4">
            <TrainingBanner incidentId={id} />
          </div>
        )}
        {shell.lockReadOnly && (
          <div className="mb-4">
            <LockedReadOnlyBanner />
          </div>
        )}
        {children}
      </div>
      </div>
    </div>
    </IncidentShellProvider>
  );
}
