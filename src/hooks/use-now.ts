"use client";

import { useEffect, useState } from "react";

/**
 * Returns the current time, re-rendering every `intervalMs` (default 30s) so
 * ticking-clock UI (e.g. regulatory-notification countdowns) advances without
 * a page reload. Pauses the interval while the tab is hidden (document.hidden)
 * to avoid wasted work/battery in background tabs — it resumes (and refreshes
 * immediately) on visibilitychange back to visible.
 */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (id !== null) return;
      setNow(new Date());
      id = setInterval(() => setNow(new Date()), intervalMs);
    };
    const stop = () => {
      if (id === null) return;
      clearInterval(id);
      id = null;
    };

    const handleVisibility = () => {
      if (document.hidden) stop();
      else start();
    };

    if (typeof document === "undefined" || !document.hidden) start();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      stop();
    };
  }, [intervalMs]);

  return now;
}
