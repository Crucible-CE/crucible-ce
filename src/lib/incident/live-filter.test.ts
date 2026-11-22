// Guard (M6 soft delete): every Incident read/update in src/ must exclude
// soft-deleted incidents. A `db|tx.incident.<op>(...)` call passes when its
// argument uses one of the filter helpers:
//   - lib/incident/access: accessibleIncidentsWhere / findAccessibleIncident
//   - lib/incident/live:   liveIncidentWhere / NOT_DELETED
// Anything else must be on ALLOWLIST below, with the reason it is safe. The
// count is the maximum number of unfiltered calls of that op in that file, so
// a NEW unfiltered call in an allowlisted file still fails. If you add a call,
// use the helper; only extend the allowlist with a real reason.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");

const ALLOWLIST: Record<string, { max: number; reason: string }> = {
  // Lookups by id whose result is fed to decideIncidentAccess, which itself
  // rejects deletedAt (the gate selects deletedAt).
  "src/lib/incident/access.ts|findUnique": { max: 2, reason: "access gate; decideIncidentAccess rejects deletedAt" },
  "src/lib/socket/access.ts|findUnique": { max: 2, reason: "war-room gate; decideIncidentAccess rejects deletedAt" },
  // Only ever called after the route's own access check (which 404s deleted).
  "src/lib/incident/lock.ts|findUnique": { max: 1, reason: "isIncidentReadOnlyFor: caller-gated lock lookup" },
  // Ledger internals must work on a deleted incident (incident_deleted is
  // itself a ledger entry; verification of a preserved ledger).
  "src/lib/ledger/append.ts|update": { max: 1, reason: "ledger head bump inside appendLedger" },
  "src/lib/ledger/append.ts|findUnique": { max: 1, reason: "ledger anchor verification" },
  // `where` is built from accessibleIncidentsWhere a few lines above.
  "src/app/api/incidents/route.ts|findMany": { max: 1, reason: "where = accessibleIncidentsWhere(...) + filters" },
  // Updates by id AFTER the route's access check in the same handler.
  "src/app/api/incidents/[id]/route.ts|update": { max: 1, reason: "PATCH after accessibleIncidentsWhere lookup" },
  "src/app/api/incidents/[id]/business-impact/route.ts|update": { max: 1, reason: "after accessibleIncidentsWhere lookup" },
  "src/app/api/incidents/[id]/declare/route.ts|update": { max: 1, reason: "after accessibleIncidentsWhere lookup" },
  "src/lib/incident/false-positive.ts|update": { max: 1, reason: "after the liveIncidentWhere lookup above it" },
  // Egress guard: reads only isTraining; a deleted training incident is still training.
  "src/lib/incident/training-guard.ts|findUnique": { max: 1, reason: "training egress guard reads isTraining only" },
  // Deleting a user must clear assignments on ALL incidents, deleted included.
  "src/app/api/admin/users/[id]/route.ts|updateMany": { max: 1, reason: "FK cleanup on user delete" },
};

const CALL = /\b(?:db|tx|client|prisma)\.incident\.(findMany|findFirst|findUnique|findFirstOrThrow|findUniqueOrThrow|count|update|updateMany|groupBy|aggregate)\(/g;
const FILTERED = /accessibleIncidentsWhere|findAccessibleIncident|liveIncidentWhere|NOT_DELETED/;

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

/** The full `db.incident.op( ... )` call text (balanced parentheses). */
function callText(src: string, start: number, openIdx: number): string {
  let depth = 1;
  let i = openIdx;
  while (i < src.length && depth > 0) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") depth--;
    i++;
  }
  return src.slice(start, i);
}

function unfilteredCalls(): Map<string, string[]> {
  const files = [...walk(path.join(ROOT, "src")), path.join(ROOT, "server.ts"), path.join(ROOT, "server-socket.ts")].filter((f) =>
    fs.existsSync(f),
  );
  const found = new Map<string, string[]>();
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    for (const m of src.matchAll(CALL)) {
      const text = callText(src, m.index!, m.index! + m[0].length);
      if (FILTERED.test(text)) continue;
      const key = `${rel}|${m[1]}`;
      const line = src.slice(0, m.index).split("\n").length;
      found.set(key, [...(found.get(key) ?? []), `${rel}:${line}`]);
    }
  }
  return found;
}

describe("soft-deleted incidents are filtered on every Incident query", () => {
  it("every db/tx.incident call uses a filter helper or is allowlisted with a reason", () => {
    const problems: string[] = [];
    for (const [key, sites] of unfilteredCalls()) {
      const allowed = ALLOWLIST[key];
      if (!allowed || sites.length > allowed.max) {
        problems.push(`${sites.join(", ")} — use liveIncidentWhere/NOT_DELETED (lib/incident/live) or an access helper`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("the allowlist has no stale entries", () => {
    const found = unfilteredCalls();
    const stale = Object.keys(ALLOWLIST).filter((k) => !found.has(k));
    expect(stale).toEqual([]);
  });
});
