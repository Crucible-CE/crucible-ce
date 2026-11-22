"use client";

// ---------------------------------------------------------------------------
// SideRail — the app-frame navigation (replaces the top-bar tab row).
//
// Desktop (lg+): fixed left rail, 232px expanded / 56px collapsed (state
// persisted in localStorage). Collapsed mode shows icons with tooltips;
// group headers become hairline dividers.
//
// Mobile (<lg): the rail is hidden; the top bar's menu button opens this
// same content as a full-label overlay drawer (no icon-guessing on any
// viewport). Drawer closes on navigation.
//
// Grouped list: daily surfaces ungrouped on top (incl. live Incidents), then
// Incident Response and the Crucible Cloud pointer. Labels are single-line;
// collapsed items show the label as a tooltip.
// ---------------------------------------------------------------------------

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useRef } from "react";
import { useOverlayA11y } from "@/hooks/use-overlay-a11y";
import {
  ChevronsLeft,
  ChevronsRight,
  CalendarDays,
  ClipboardCheck,
  Cloud,
  FileCheck,
  FileText,
  LayoutDashboard,
  LayoutTemplate,
  ListChecks,
  PieChart,
  Swords,
  Phone,
  RadioTower,
  Rocket,
  Siren,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const RAIL_WIDTH_EXPANDED = 248;
export const RAIL_WIDTH_COLLAPSED = 56;

interface RailItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Readers cannot open it, so it is left out for them (as in nav search). */
  hideForReader?: boolean;
}

interface RailGroup {
  /** null = ungrouped top section (no header, no divider). */
  label: string | null;
  items: RailItem[];
}

export const RAIL_GROUPS: RailGroup[] = [
  {
    label: null,
    items: [
      { href: "/dashboard", label: "Ops Room", icon: LayoutDashboard },
      // Onboarding checklist (Organization setup + Your setup), as in Cloud.
      { href: "/onboarding", label: "Onboarding", icon: Rocket },
    ],
  },
  {
    label: "Incident response",
    items: [
      { href: "/incidents", label: "Incidents", icon: Siren },
      { href: "/escalation-matrix", label: "Escalation matrix", icon: Phone },
      { href: "/messaging", label: "Messaging", icon: RadioTower, hideForReader: true },
    ],
  },
  {
    label: "Exercises",
    items: [
      { href: "/exercises", label: "Exercises", icon: Swords },
      { href: "/templates", label: "Templates", icon: LayoutTemplate, hideForReader: true },
      { href: "/documents", label: "Documents", icon: FileText },
      { href: "/schedule", label: "Schedule", icon: CalendarDays },
    ],
  },
  {
    label: "Improvement",
    items: [
      { href: "/executive-dashboard", label: "Executive dashboard", icon: PieChart, hideForReader: true },
      { href: "/reports", label: "Program report", icon: ClipboardCheck, hideForReader: true },
      // Readers see the final reports of their exercises and their own work items.
      { href: "/after-action-reports", label: "After-action reports", icon: FileCheck },
      { href: "/action-items", label: "Work items", icon: ListChecks },
    ],
  },
  {
    // The one Cloud pointer in the app chrome: a page of screenshots, not a
    // wall of locked buttons.
    label: "More",
    items: [
      { href: "/cloud", label: "Crucible Cloud", icon: Cloud },
    ],
  },
];

function isActiveHref(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

function RailBrand({ collapsed }: { collapsed: boolean }) {
  return (
    <Link
      href="/dashboard"
      aria-label="Crucible CE home"
      className={cn(
        "flex h-[var(--nav-height)] shrink-0 items-center border-b border-[color:var(--color-border)]",
        collapsed ? "justify-center px-0" : "px-4",
      )}
    >
      {collapsed ? (
        <Image
          src="/branding/logos/mark.svg"
          alt="Crucible CE"
          width={32}
          height={32}
          priority
          unoptimized
          className="h-8 w-8"
        />
      ) : (
        <>
          <Image
            src="/branding/logos/wordmark.svg"
            alt="Crucible CE"
            width={206}
            height={32}
            priority
            unoptimized
            className="logo-on-light h-6 w-auto"
          />
          <Image
            src="/branding/logos/wordmark-dark.svg"
            alt="Crucible CE"
            width={206}
            height={32}
            priority
            unoptimized
            className="logo-on-dark h-6 w-auto"
          />
        </>
      )}
    </Link>
  );
}

function RailNav({
  collapsed,
  onNavigate,
  className,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
  className?: string;
}) {
  const pathname = usePathname();
  const isReader = useSession().data?.user?.role === "reader";
  const groups = RAIL_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !(i.hideForReader && isReader)) })).filter((g) => g.items.length > 0);

  return (
    <nav aria-label="Primary" className={className}>
      {groups.map((group, gi) => (
        <div key={group.label ?? "top"} className={cn(gi > 0 && "mt-5")}>
          {group.label ? (
            collapsed ? (
              <div className="mx-2 mb-2 h-px bg-[color:var(--color-border)]" />
            ) : (
              <div className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--color-muted-foreground)]/70">
                {group.label}
              </div>
            )
          ) : null}
          <div className="flex flex-col gap-1">
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = isActiveHref(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    "flex items-center rounded-[var(--radius-sm)] text-[13px] font-medium transition-colors",
                    collapsed ? "h-9 justify-center px-0" : "gap-2.5 px-2.5 py-2",
                    active
                      ? "bg-[color:var(--mist-indigo-soft)] text-[color:var(--mist-indigo)]"
                      : "text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-muted)] hover:text-[color:var(--color-foreground)]",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {!collapsed && <span className="min-w-0 truncate">{item.label}</span>}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

/** Desktop rail. Hidden below lg — mobile uses <MobileRailDrawer>. */
export function SideRail({
  collapsed,
  onToggleCollapsed,
  forceCollapsed = false,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** War Room Mode forces the collapse — hide the manual toggle. */
  forceCollapsed?: boolean;
}) {
  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-50 hidden flex-col border-r border-[color:var(--color-border)] lg:flex",
        "bg-background/72 backdrop-blur-xl backdrop-saturate-150",
        "transition-[width] duration-[var(--motion-duration)] ease-[var(--motion-ease)]",
      )}
      style={{ width: "var(--rail-w)" }}
    >
      <RailBrand collapsed={collapsed} />
      <div className="flex-1 overflow-y-auto pb-3">
        <RailNav collapsed={collapsed} className="px-2 pt-3" />
        {!forceCollapsed && (
          <div className={cn("mt-2 px-2", collapsed && "flex justify-center")}>
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
              title={collapsed ? "Expand navigation" : "Collapse navigation"}
              className="grid h-9 w-9 place-items-center rounded-[var(--radius-sm)] text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-muted)] hover:text-[color:var(--color-foreground)]"
            >
              {collapsed ? (
                <ChevronsRight className="h-4 w-4" />
              ) : (
                <ChevronsLeft className="h-4 w-4" />
              )}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

/** Mobile drawer — same content, always full labels. */
export function MobileRailDrawer({
  open,
  onClose,
  returnFocusRef,
}: {
  open: boolean;
  onClose: () => void;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Focus into the panel on open, Escape closes, focus returns to the
  // hamburger; the panel is inert when closed so its links leave the tab order.
  useOverlayA11y({ open, onClose, containerRef: panelRef, returnFocusRef, initialFocus: true });
  return (
    <div
      className={cn("fixed inset-0 z-[60] lg:hidden", open ? "" : "pointer-events-none")}
      aria-hidden={!open}
    >
      {/* Scrim */}
      <div
        className={cn(
          "absolute inset-0 bg-black/40 transition-opacity duration-[var(--motion-duration)]",
          open ? "opacity-100" : "opacity-0",
        )}
        onClick={onClose}
      />
      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        {...(open ? {} : { inert: "" as unknown as boolean })}
        className={cn(
          "absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] flex-col border-r border-[color:var(--color-border)] bg-[color:var(--color-card)] shadow-[var(--elevation-3)]",
          "transition-transform duration-[var(--motion-duration)] ease-[var(--motion-ease)]",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-[var(--nav-height)] shrink-0 items-center justify-between border-b border-[color:var(--color-border)] pl-4 pr-2">
          <Link href="/dashboard" aria-label="Crucible CE home" onClick={onClose}>
            <Image
              src="/branding/logos/wordmark.svg"
              alt="Crucible CE"
              width={206}
              height={32}
              unoptimized
              className="logo-on-light h-6 w-auto"
            />
            <Image
              src="/branding/logos/wordmark-dark.svg"
              alt="Crucible CE"
              width={206}
              height={32}
              unoptimized
              className="logo-on-dark h-6 w-auto"
            />
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="grid h-9 w-9 place-items-center rounded-[var(--radius-sm)] text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-muted)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <RailNav
          collapsed={false}
          onNavigate={onClose}
          className="flex-1 overflow-y-auto px-2 py-3"
        />
      </div>
    </div>
  );
}
