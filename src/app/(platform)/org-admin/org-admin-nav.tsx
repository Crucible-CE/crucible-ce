"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard,
  Users,
  Phone,
  Bell,
  ScrollText,
  Building2,
  Timer,
  ChartNoAxesCombined,
  RadioTower,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Org admin panel — manage your own organization. Every destination here is
// org-scoped.
interface NavItem { href: string; label: string; icon: LucideIcon }
interface NavGroup { label: string; items: NavItem[] }

const GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/org-admin", label: "Dashboard", icon: LayoutDashboard },
      { href: "/org-admin/organization", label: "Organization", icon: Building2 },
    ],
  },
  {
    label: "Incident response",
    items: [
      { href: "/org-admin/incident-slas", label: "Response SLAs", icon: Timer },
      { href: "/org-admin/incident-metrics", label: "Metrics", icon: ChartNoAxesCombined },
    ],
  },
  {
    label: "Exercises",
    items: [
      { href: "/org-admin/exercises", label: "Exercise settings", icon: SlidersHorizontal },
    ],
  },
  {
    label: "People",
    items: [
      { href: "/org-admin/members", label: "Members", icon: Users },
      { href: "/escalation-matrix", label: "Escalation matrix", icon: Phone },
    ],
  },
  {
    label: "Governance",
    items: [
      { href: "/org-admin/notification-policy", label: "Notification policy", icon: Bell },
      { href: "/org-admin/delivery", label: "Delivery settings", icon: RadioTower },
      { href: "/org-admin/audit", label: "Audit log", icon: ScrollText },
    ],
  },
];

export function OrgAdminNav({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/org-admin" ? pathname === "/org-admin" : pathname === href || pathname.startsWith(href + "/"));

  return (
    <div className="flex gap-6">
      <aside className="sticky top-[calc(var(--nav-height)+1rem)] hidden h-fit w-52 shrink-0 self-start md:block">
        <div className="mb-3 flex items-center gap-2 px-2 text-[color:var(--color-muted-foreground)]">
          <Building2 className="h-4 w-4 text-[color:var(--mist-indigo)]" />
          <span className="text-[12px] font-semibold uppercase tracking-[0.12em]">Org admin</span>
        </div>
        <nav className="space-y-4">
          {GROUPS.map((group) => (
            <div key={group.label}>
              <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--color-muted-foreground)]/70">{group.label}</p>
              <div className="space-y-0.5">
                {group.items.map((t) => {
                  const Icon = t.icon;
                  const active = isActive(t.href);
                  return (
                    <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                        active ? "bg-[color:var(--mist-indigo)]/10 text-[color:var(--mist-indigo)]" : "text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-muted)] hover:text-[color:var(--color-foreground)]",
                      )}>
                      <Icon className="h-4 w-4 shrink-0" />
                      {t.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 flex-1">
        <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-[color:var(--color-border)] pb-px md:hidden">
          {GROUPS.flatMap((g) => g.items).map((t) => {
            const Icon = t.icon;
            const active = isActive(t.href);
            return (
              <Link key={t.href} href={t.href}
                className={cn("flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-t-[var(--radius-sm)] px-2.5 py-2 text-[12px] font-medium", active ? "border-b-2 border-[color:var(--mist-indigo)] text-[color:var(--mist-indigo)]" : "text-[color:var(--color-muted-foreground)]")}>
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </Link>
            );
          })}
        </nav>
        {children}
      </div>
    </div>
  );
}
