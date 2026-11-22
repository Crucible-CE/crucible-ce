"use client";

import { useEffect, useRef, useState } from "react";
import { useOverlayA11y } from "@/hooks/use-overlay-a11y";
import Image from "next/image";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { signOutAndRedirect } from "@/lib/auth/sign-out-client";
import {
  LogOut,
  Menu,
  Settings,
  Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SOURCE_CODE_URL } from "@/lib/source-code";
import { NavSearch } from "./nav-search";
import { NotificationBell } from "./notification-bell";
import { UnderAttackButton } from "@/components/incident/under-attack-button";
import {
  ActiveIncidentPill,
  EnvironmentBadge,
  SocketStatusDot,
} from "./top-bar-status";

// ---------------------------------------------------------------------------
// Top utility strip (rail app-frame).
//
// Primary navigation lives in the SideRail (side-rail.tsx); this bar only
// carries utilities: environment badge, active-session pill, search,
// socket dot, approvals, notifications, and the user chip.
//
// Two variants via the `withRail` prop:
//   - withRail (default, platform shell): on lg+ the bar sits to the right
//     of the rail (offset by --rail-w) and shows no brand (the rail has
//     it). Below lg it spans full width with a menu button that opens the
//     mobile nav drawer + the brand wordmark.
//   - withRail={false} (war rooms): full-width standalone bar with the
//     brand and no menu button — war-room routes have no rail by design.
// ---------------------------------------------------------------------------

function Brand({ className }: { className?: string }) {
  return (
    <Link
      href="/dashboard"
      className={cn("flex shrink-0 items-center pr-2", className)}
      aria-label="Crucible CE home"
    >
      {/* Theme-aware: dark-ink wordmark on Mist (default), light-ink on
          Carbon. Visibility is gated by `.logo-on-light` / `.logo-on-dark`
          rules in globals.css that key off `<html data-theme>`. Below sm
          only the square mark shows, so the bar fits a 360-390px phone. */}
      <Image
        src="/branding/logos/mark.svg"
        alt="Crucible CE"
        width={28}
        height={28}
        priority
        unoptimized
        className="h-7 w-7 sm:hidden"
      />
      <Image
        src="/branding/logos/wordmark.svg"
        alt="Crucible CE"
        width={206}
        height={32}
        priority
        unoptimized
        className="logo-on-light hidden h-7 w-auto sm:block"
      />
      <Image
        src="/branding/logos/wordmark-dark.svg"
        alt="Crucible CE"
        width={206}
        height={32}
        priority
        unoptimized
        className="logo-on-dark hidden h-7 w-auto sm:block"
      />
    </Link>
  );
}

interface TopBarProps {
  /** False on war-room routes — full-width standalone bar with brand. */
  withRail?: boolean;
  /** Opens the mobile nav drawer (rail variant, < lg only). */
  onMenuClick?: () => void;
}

export function TopBar({ withRail = true, onMenuClick }: TopBarProps) {
  const { data: session } = useSession();

  const role = session?.user?.role;
  const isReader = role === "reader";
  const userAdmin = role === "administrator";
  const userName = session?.user?.name ?? undefined;
  const orgName = session?.user?.organizationName ?? undefined;

  return (
    <header
      className={cn(
        "fixed top-0 right-0 z-50 flex h-[var(--nav-height)] items-center gap-3 border-b border-[color:var(--color-border)] px-4 sm:px-6",
        "bg-background/72 backdrop-blur-xl backdrop-saturate-150",
        withRail ? "left-0 lg:left-[var(--rail-w)]" : "left-0",
      )}
    >
      {withRail ? (
        <>
          <button
            type="button"
            onClick={onMenuClick}
            aria-label="Open navigation"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] lg:hidden"
          >
            <Menu className="h-4 w-4" />
          </button>
          <Brand className="lg:hidden" />
        </>
      ) : (
        <Brand />
      )}

      <UnderAttackButton />

      <div className="flex flex-1 items-center justify-end gap-2">
        <EnvironmentBadge />
        <ActiveIncidentPill />
        <div className="hidden md:block">
          <NavSearch isReader={isReader} userAdmin={userAdmin} />
        </div>
        <SocketStatusDot />
        {session?.user?.id && (
          <NotificationBell
            userId={session.user.id}
            triggerClassName="h-9 w-9 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] text-[color:var(--color-muted-foreground)] hover:border-[color:var(--mist-indigo)]/60 hover:text-[color:var(--mist-indigo)]"
          />
        )}
        <UserChip
          userName={userName}
          orgName={orgName}
          userAdmin={userAdmin}
        />
      </div>
    </header>
  );
}

function UserChip({
  userName,
  orgName,
  userAdmin,
}: {
  userName?: string;
  orgName?: string;
  userAdmin?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  // Escape-to-close + focus trap/return for the hand-rolled menu.
  useOverlayA11y({ open, onClose: () => setOpen(false), containerRef: menuRef, returnFocusRef: triggerRef, initialFocus: true });

  const initials = (userName ?? "U")
    .split(" ")
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  function close() {
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        ref={triggerRef}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "flex items-center gap-2.5 rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] pl-1 pr-3 py-1",
          "hover:border-[color:var(--mist-indigo)]/60 hover:shadow-[var(--elevation-1)]",
        )}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] bg-[color:var(--color-primary)] text-[11px] font-semibold text-[color:var(--color-primary-foreground)]">
          {initials}
        </span>
        <span className="hidden text-left sm:block">
          {userName && (
            <span className="block text-[12.5px] font-medium leading-none text-[color:var(--color-foreground)]">
              {userName}
            </span>
          )}
          {orgName && (
            <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.18em] leading-none text-[color:var(--color-muted-foreground)]">
              {orgName}
            </span>
          )}
        </span>
      </button>

      <div
        ref={menuRef}
        role="menu"
        aria-hidden={!open}
        {...(open ? {} : { inert: "" as unknown as boolean })}
        className={cn(
          "absolute right-0 top-full z-50 mt-2 w-64 rounded-[var(--radius-lg)] bg-[color:var(--color-popover)] p-1.5",
          "border border-[color:var(--color-border)] shadow-[var(--elevation-3)]",
          "transition-[opacity,transform] duration-[var(--motion-duration)] ease-[var(--motion-ease)]",
          open ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-2 opacity-0",
        )}
      >
        {(userName || orgName) && (
          <div className="border-b border-[color:var(--color-border)] px-3 py-2.5">
            {userName && (
              <p className="truncate text-sm font-medium text-[color:var(--color-foreground)]">{userName}</p>
            )}
            {orgName && (
              <p className="truncate text-xs text-[color:var(--color-muted-foreground)]">{orgName}</p>
            )}
          </div>
        )}

        <DropdownGroup label="Settings">
          <DropdownItem href="/settings" icon={<Settings className="h-4 w-4" />} onClick={close}>
            Account
          </DropdownItem>
          <DropdownItem href="/org-profile" icon={<Building2 className="h-4 w-4" />} onClick={close}>
            Organization profile
          </DropdownItem>
        </DropdownGroup>

        {userAdmin && (
          <DropdownGroup label="Administration">
            <DropdownItem href="/org-admin" icon={<Building2 className="h-4 w-4" />} onClick={close}>
              Org admin
            </DropdownItem>
          </DropdownGroup>
        )}

        <div className="my-1 h-px bg-[color:var(--color-border)]" />

        <div className="py-1">
          <button
            onClick={() => void signOutAndRedirect()}
            className="flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-3 py-2 text-sm text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--mist-danger)]/10 hover:text-[color:var(--mist-danger)]"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>

        <div className="border-t border-[color:var(--color-border)] px-3 pb-1 pt-2">
          <a
            href={SOURCE_CODE_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={close}
            className="text-[11px] text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] hover:underline"
          >
            Source code
          </a>
        </div>
      </div>
    </div>
  );
}

function DropdownGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="py-1">
      <div className="px-3 pb-1 pt-1.5 text-[10.5px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-muted-foreground)]/80">
        {label}
      </div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

function DropdownItem({
  href,
  icon,
  onClick,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="flex items-center gap-2.5 rounded-[var(--radius-sm)] px-3 py-1.5 text-sm text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-muted)] hover:text-[color:var(--color-foreground)]"
    >
      {icon}
      {children}
    </Link>
  );
}
