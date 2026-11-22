"use client";

import { useEffect } from "react";

/** Call `load` now and every `ms` while the page is visible. */
export function usePoll(load: () => void | Promise<void>, ms: number, deps: unknown[] = []): void {
  useEffect(() => {
    void load();
    const t = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") void load();
    }, ms);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, ms, ...deps]);
}
