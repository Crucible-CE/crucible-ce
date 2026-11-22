"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Shield, Settings, AlertTriangle, Phone, LayoutDashboard,
  ScrollText, Cloud, Inbox, Timer, ChartNoAxesCombined,
  UserCog, Building2, Rocket, Swords, LayoutTemplate, FileText,
  CalendarDays, ClipboardCheck, FileCheck, ListChecks, SlidersHorizontal, RadioTower, TrendingUp,
} from "lucide-react";
import { PieChart, type LucideIcon } from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Search index — mirrors the top-nav destinations (single ice-tone monochrome)
// ---------------------------------------------------------------------------

interface SearchItem {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  group: string;
  adminOnly?: boolean;
  hideForReader?: boolean;
}

const SEARCH_INDEX: SearchItem[] = [
  { href: "/dashboard", label: "Ops Room", description: "Your pages, your tasks, open incidents", icon: LayoutDashboard, group: "Overview" },
  { href: "/inbox", label: "Inbox", description: "Your notifications", icon: Inbox, group: "Overview" },
  { href: "/onboarding", label: "Onboarding", description: "Setup steps", icon: Rocket, group: "Overview" },

  // Incident Response — mirrors the rail's Incident Response group.
  { href: "/incidents", label: "Incidents", description: "All incidents", icon: AlertTriangle, group: "Incident response" },
  { href: "/escalation-matrix", label: "Escalation matrix", description: "Escalation contacts", icon: Phone, group: "Incident response" },
  { href: "/messaging", label: "Messaging", description: "Broadcast to members and contacts", icon: RadioTower, group: "Incident response", hideForReader: true },

  // Exercises: mirrors the rail's Exercises group.
  { href: "/exercises", label: "Exercises", description: "Tabletop exercises", icon: Swords, group: "Exercises" },
  { href: "/templates", label: "Templates", description: "Scenarios to run", icon: LayoutTemplate, group: "Exercises", hideForReader: true },
  { href: "/documents", label: "Documents", description: "Playbooks and plans", icon: FileText, group: "Exercises" },
  { href: "/schedule", label: "Schedule", description: "Planned exercises and the calendar feed", icon: CalendarDays, group: "Exercises" },

  // Improvement: mirrors the rail's Improvement group.
  { href: "/executive-dashboard", label: "Executive dashboard", description: "Readiness score and program at a glance", icon: PieChart, group: "Improvement", hideForReader: true },
  { href: "/reports", label: "Program report", description: "Exercise program and cadence", icon: ClipboardCheck, group: "Improvement", hideForReader: true },
  { href: "/after-action-reports", label: "After-action reports", description: "Reports from ended exercises", icon: FileCheck, group: "Improvement" },
  { href: "/after-action-reports/maturity", label: "Capability maturity", description: "Objective ratings over time", icon: TrendingUp, group: "Improvement", hideForReader: true },
  { href: "/action-items", label: "Work items", description: "Corrective actions from reports", icon: ListChecks, group: "Improvement" },

  // Settings
  { href: "/settings", label: "Settings", description: "Profile, security and notifications", icon: Settings, group: "Settings" },
  { href: "/cloud", label: "Crucible Cloud", description: "The hosted version", icon: Cloud, group: "Settings" },

  // Org Admin (admin)
  { href: "/org-admin/organization", label: "Organization", description: "Name and profile", icon: Building2, group: "Org admin", adminOnly: true },
  { href: "/org-admin/members", label: "Members", description: "Members and roles", icon: UserCog, group: "Org admin", adminOnly: true },
  { href: "/org-admin/notification-policy", label: "Notification policy", description: "Lock notification channels", icon: Shield, group: "Org admin", adminOnly: true },
  { href: "/org-admin/incident-slas", label: "Response SLAs", description: "Response time targets", icon: Timer, group: "Org admin", adminOnly: true },
  { href: "/org-admin/incident-metrics", label: "Metrics", description: "MTTA, MTTR and trends", icon: ChartNoAxesCombined, group: "Org admin", adminOnly: true },
  { href: "/org-admin/exercises", label: "Exercise settings", description: "Policy, signing keys and Cloud notes", icon: SlidersHorizontal, group: "Org admin", adminOnly: true },
  { href: "/org-admin/audit", label: "Audit log", description: "Admin actions", icon: ScrollText, group: "Org admin", adminOnly: true },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface NavSearchProps {
  isReader: boolean;
  userAdmin: boolean;
}

export function NavSearch({ isReader, userAdmin }: NavSearchProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // Open on "/" keypress when not in a text input
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "/") return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable) return;
      e.preventDefault();
      setOpen(true);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const navigate = useCallback((href: string) => {
    setOpen(false);
    router.push(href);
  }, [router]);

  const visible = SEARCH_INDEX.filter((item) => {
    if (item.hideForReader && isReader) return false;
    if (item.adminOnly && !userAdmin) return false;
    return true;
  });

  // Group items
  const groups = visible.reduce<Record<string, SearchItem[]>>((acc, item) => {
    (acc[item.group] ??= []).push(item);
    return acc;
  }, {});

  return (
    <>
      {/* Trigger */}
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-[12px] text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 111 11a6 6 0 0116 0z" />
        </svg>
        <span>Search</span>
        <kbd className="ml-1 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">/</kbd>
      </button>

      {/* Palette */}
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search"
        description="Search pages"
        showCloseButton={false}
        className="max-w-lg border-border bg-popover shadow-2xl shadow-black/60 backdrop-blur-xl"
      >
        <CommandInput placeholder="Search pages" className="text-[13px]" />
        <CommandList className="max-h-[420px] p-1">
          <CommandEmpty className="py-10 text-[13px] text-muted-foreground">
            No results.
          </CommandEmpty>

          {Object.entries(groups).map(([group, items]) => (
            <CommandGroup
              key={group}
              heading={group}
              className="[&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.16em] [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
            >
              {items.map((item) => (
                <CommandItem
                  key={item.href}
                  value={`${item.label} ${item.description} ${group}`}
                  onSelect={() => navigate(item.href)}
                  className="flex items-center gap-3 rounded-md px-2 py-2 cursor-pointer data-[selected=true]:bg-primary/10 data-[selected=true]:text-foreground"
                >
                  <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-primary bg-primary/10 text-accent")}>
                    <item.icon className="h-[15px] w-[15px]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-foreground">{item.label}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{item.description}</p>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>

        {/* Footer */}
        <div className="flex items-center gap-3 border-t border-border px-3 py-2">
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">↑↓</kbd> navigate
          </span>
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">↵</kbd> open
          </span>
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">esc</kbd> close
          </span>
        </div>
      </CommandDialog>
    </>
  );
}
