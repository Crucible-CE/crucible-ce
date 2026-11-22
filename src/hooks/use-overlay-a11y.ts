"use client";

// focus management for hand-rolled overlays (the non-Radix UserChip menu
// and mobile drawer). Radix surfaces already handle this; this hook gives the
// two custom overlays the same behavior: Escape-to-close, focus trap, and
// focus return, without pulling in a focus-lock dependency.

import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function useOverlayA11y(opts: {
  open: boolean;
  onClose: () => void;
  containerRef: React.RefObject<HTMLElement | null>;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  initialFocus?: boolean;
}): void {
  const { open, onClose, containerRef, returnFocusRef, initialFocus } = opts;
  const capturedReturn = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    // Capture where focus was so we can restore it on close.
    capturedReturn.current =
      returnFocusRef?.current ?? (document.activeElement as HTMLElement | null);

    if (initialFocus && container) {
      const first = container.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !container) return;
      const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!container.contains(active)) {
        e.preventDefault();
        first.focus();
        return;
      }
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      // Restore focus only if the return target still exists AND focus is still
      // inside the (closing) overlay — never steal focus the user moved away.
      const target = capturedReturn.current;
      if (target?.isConnected && containerRef.current?.contains(document.activeElement)) {
        target.focus();
      }
    };
  }, [open, onClose, containerRef, returnFocusRef, initialFocus]);
}
