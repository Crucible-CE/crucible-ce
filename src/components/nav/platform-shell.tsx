"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { isSigningOut, signOutAndRedirect } from "@/lib/auth/sign-out-client";
import { confirmSessionState } from "@/components/nav/session-confirm";
import { TopBar } from "@/components/nav/top-bar";
import {
  MobileRailDrawer,
  SideRail,
  RAIL_WIDTH_COLLAPSED,
  RAIL_WIDTH_EXPANDED,
} from "@/components/nav/side-rail";
import { PagingAlerts } from "@/components/incident/paging-alerts";
import { SkipLink } from "@/components/nav/skip-link";
import { DISCLAIMER_HEIGHT_PX, EvidentiaryFooter } from "@/components/nav/evidentiary-footer";

type PlatformShellProps = {
  children: React.ReactNode;
};

const RAIL_COLLAPSED_KEY = "crucible.rail-collapsed";

// App frame: collapsible left rail (primary navigation) + top utility
// strip + content. The rail collapses to a 56px icon strip on demand
// (persisted per browser); below lg it becomes a hamburger-opened drawer.
// War-room routes use their own layout without the rail.
export function PlatformShell({ children }: PlatformShellProps) {
  const pathname = usePathname();

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  // War-room-local override: the global rail defaults collapsed inside a war
  // room, but the user can open it (to jump elsewhere) without losing the room.
  const [warRoomRailOpen, setWarRoomRailOpen] = useState(false);

  // War Room Mode: inside an incident war room (/incidents/{id}/…) the global
  // rail collapses to icons so the war room's own left nav takes over. The
  // incidents *list* (/incidents) stays expanded.
  const inWarRoom = /^\/incidents\/[^/]+/.test(pathname);
  // Org admin also runs in "focus mode": collapse the global rail and use
  // full screen width so its own grouped left nav takes over, exactly like the
  // war room. Keeps the second nav tight against the icon rail.
  const inAdmin = pathname === "/org-admin" || pathname.startsWith("/org-admin/");
  const inFocusMode = inWarRoom || inAdmin;
  const effectiveCollapsed = inFocusMode ? !warRoomRailOpen : collapsed;

  // Each time you leave focus mode, reset the override so the next one starts
  // collapsed again.
  useEffect(() => {
    if (!inFocusMode && warRoomRailOpen) setWarRoomRailOpen(false);
  }, [inFocusMode, warRoomRailOpen]);

  // Hydrate the persisted collapse preference after mount (SSR renders
  // expanded; the swap happens before paint in practice).
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(RAIL_COLLAPSED_KEY) === "1");
    } catch {
      // Storage unavailable — stay expanded.
    }
  }, []);

  function toggleCollapsed() {
    if (inFocusMode) {
      setWarRoomRailOpen((prev) => !prev);
      return;
    }
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(RAIL_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // Non-blocking.
      }
      return next;
    });
  }

  // Close the mobile drawer on navigation.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Self-heal stale session cookies. Edge middleware only verifies the JWT
  // signature (no DB); the full re-validation in the auth.config.ts jwt()
  // callback can still reject the token (deactivated user, tokenVersion
  // bump, deleted org) — which surfaces as status === "unauthenticated"
  // on a page the middleware just let through. In that case force a
  // signOut so the cookie is cleared and the user is returned to /login.
  //
  // next-auth also reports a FAILED session fetch (aborted by a navigation,
  // offline blip, 5xx) as "unauthenticated", so the server is asked first
  // (session-confirm.ts): only a real "no session" answer signs out; a live
  // session resyncs the client; an unreachable server is left alone.
  const { status, update } = useSession();
  const updateRef = useRef(update);
  updateRef.current = update;
  const healingRef = useRef(false);
  useEffect(() => {
    // A user-initiated sign-out also passes through "unauthenticated"; it
    // is already redirecting, so do not start a second, racing sign-out.
    if (status !== "unauthenticated" || healingRef.current || isSigningOut()) return;
    healingRef.current = true;
    let cancelled = false;
    void (async () => {
      const verdict = await confirmSessionState();
      if (cancelled || isSigningOut()) return;
      if (verdict === "signed-out") {
        void signOutAndRedirect();
        return;
      }
      healingRef.current = false;
      if (verdict === "signed-in") void updateRef.current();
    })();
    return () => {
      cancelled = true;
      healingRef.current = false;
    };
  }, [status]);

  return (
    <>
      <SkipLink />
      <PagingAlerts />
      <div
        className="min-h-screen"
        style={
          {
            "--rail-w": `${effectiveCollapsed ? RAIL_WIDTH_COLLAPSED : RAIL_WIDTH_EXPANDED}px`,
            "--disclaimer-h": `${DISCLAIMER_HEIGHT_PX}px`,
          } as React.CSSProperties
        }
      >
        <SideRail
          collapsed={effectiveCollapsed}
          onToggleCollapsed={toggleCollapsed}
        />
        <MobileRailDrawer
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
        />
        <TopBar onMenuClick={() => setMobileOpen(true)} />

        <main
          id="main-content"
          tabIndex={-1}
          className="pt-[var(--nav-height)] pb-[var(--disclaimer-h)] focus:outline-none lg:pl-[var(--rail-w)]"
        >
          <div
            key={pathname}
            className={
              // The war room uses the full screen width (its own left nav +
              // dense panels want the room); other pages stay comfortably capped.
              inFocusMode
                ? "motion-fade-in mx-auto max-w-none px-4 py-6 sm:px-6 lg:px-8"
                : "motion-fade-in mx-auto max-w-[1360px] px-6 py-10 sm:px-10 lg:px-12"
            }
          >
            {children}
          </div>
        </main>
        {/* Standing evidentiary notice — fixed to the viewport bottom on every
            platform page (see EvidentiaryFooter). */}
        <EvidentiaryFooter withRail />
      </div>
    </>
  );
}
