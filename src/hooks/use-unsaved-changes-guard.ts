"use client";

// shared unsaved-changes guard.
//
// Next 15 App Router has no router-events API (that was Pages Router), so
// in-app protection is DOM-level: a capture-phase <a> click interceptor plus
// a popstate (browser Back) sentinel, both confirmed through the shared C4
// dialog. Hard navigation (reload/close/external) gets the native
// beforeunload prompt — browsers ignore custom text there by spec.
//
// Programmatic router.push() while dirty CANNOT be intercepted globally —
// callers doing that must gate on the returned confirmIfDirty() themselves.
// (The guarded surfaces' own pushes all fire after a successful save, when
// isDirty is already false.)

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ui/confirm-dialog";

export interface UnsavedGuardOptions {
  /** Shown in the in-app discard dialog (native prompt text is browser-fixed). */
  message?: string;
  /** Default true. Set false to fully disarm (e.g. finalized documents). */
  enabled?: boolean;
}

const SENTINEL = "__unsaved_guard__";

export function useUnsavedChangesGuard(
  isDirty: boolean,
  opts: UnsavedGuardOptions = {},
): { confirmIfDirty: () => Promise<boolean> } {
  const confirm = useConfirm();
  const router = useRouter();
  const enabled = opts.enabled ?? true;
  const message = opts.message ?? "Your changes haven't been saved.";

  // Refs so the document-level listeners read fresh state without re-binding.
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty && enabled;
  const messageRef = useRef(message);
  messageRef.current = message;
  const confirmingRef = useRef(false); // re-entrancy: one dialog at a time
  const leavingRef = useRef(false); // set once the user confirmed a Back nav

  const openDiscardDialog = useCallback(async (): Promise<boolean> => {
    if (confirmingRef.current) return false;
    confirmingRef.current = true;
    try {
      return await confirm({
        title: "Discard unsaved changes?",
        description: messageRef.current,
        confirmLabel: "Discard",
        destructive: true,
      });
    } finally {
      confirmingRef.current = false;
    }
  }, [confirm]);

  useEffect(() => {
    if (!enabled) return;

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = ""; // browsers show their own generic prompt
    };

    const onClickCapture = (e: MouseEvent) => {
      if (!dirtyRef.current) return;
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      const anchor = (e.target as Element | null)?.closest?.("a[href]");
      if (!anchor) return;
      const a = anchor as HTMLAnchorElement;
      if (a.target === "_blank" || a.hasAttribute("download") || a.hasAttribute("data-bypass-guard")) return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return; // external → beforeunload covers it
      if (url.pathname === window.location.pathname && url.search === window.location.search) return; // hash-only

      e.preventDefault();
      e.stopPropagation();
      void openDiscardDialog().then((ok) => {
        if (ok) {
          dirtyRef.current = false;
          router.push(url.pathname + url.search + url.hash);
        }
      });
    };

    // Browser Back guard: push a sentinel so the first Back lands on it, then
    // ask; on confirm, actually go back (with a flag so we don't re-trigger).
    const alreadySentinel = window.history.state?.[SENTINEL];
    if (!alreadySentinel) {
      window.history.pushState({ ...(window.history.state ?? {}), [SENTINEL]: true }, "");
    }
    const onPopState = () => {
      if (leavingRef.current) return;
      if (!dirtyRef.current) return;
      // Re-arm the sentinel, then ask.
      window.history.pushState({ ...(window.history.state ?? {}), [SENTINEL]: true }, "");
      void openDiscardDialog().then((ok) => {
        if (ok) {
          leavingRef.current = true;
          dirtyRef.current = false;
          window.history.go(-2); // past the re-armed sentinel AND the original entry
        }
      });
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClickCapture, true);
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClickCapture, true);
      window.removeEventListener("popstate", onPopState);
    };
  }, [enabled, openDiscardDialog, router]);

  const confirmIfDirty = useCallback(async (): Promise<boolean> => {
    if (!dirtyRef.current) return true;
    const ok = await openDiscardDialog();
    if (ok) dirtyRef.current = false;
    return ok;
  }, [openDiscardDialog]);

  return { confirmIfDirty };
}
