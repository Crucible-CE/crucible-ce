"use client";

// Per-browser "last seen" markers for war-room sections, so "new activity"
// badges mean "since YOU last looked". Stored in localStorage (per device); the
// server is sent these timestamps and returns the new-item counts.

// Sections that carry a "new since last seen" badge (action sections — pages,
// tasks — are computed live and don't use last-seen).
export const SEEN_SECTIONS = ["chat", "comms", "evidence", "sitrep", "intel", "decisions", "calendar"] as const;

const KEY = (incidentId: string) => `crucible.seen.${incidentId}`;

function read(incidentId: string): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY(incidentId)) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}
function write(incidentId: string, m: Record<string, string>): void {
  try { localStorage.setItem(KEY(incidentId), JSON.stringify(m)); } catch { /* storage off */ }
}

// First time you enter an incident, baseline every section to "now" so you
// aren't flooded with everything that existed before you arrived. New activity
// after this point is what badges.
export function ensureSeenBaseline(incidentId: string): void {
  if (typeof window === "undefined") return;
  if (localStorage.getItem(KEY(incidentId))) return;
  const now = new Date().toISOString();
  const m: Record<string, string> = {};
  for (const s of SEEN_SECTIONS) m[s] = now;
  write(incidentId, m);
}

export function markSectionSeen(incidentId: string, section: string): void {
  if (typeof window === "undefined") return;
  const m = read(incidentId);
  m[section] = new Date().toISOString();
  write(incidentId, m);
}

// Query string of last-seen timestamps for the badges endpoint.
export function seenQuery(incidentId: string): string {
  if (typeof window === "undefined") return "";
  const m = read(incidentId);
  return Object.entries(m)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
}
