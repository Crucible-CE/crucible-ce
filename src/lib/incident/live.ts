// Soft-deleted incidents (M6: admin-only DELETE sets deletedAt/deletedById)
// are invisible everywhere. This is the ONE place that spells the filter.
//
//   db.incident.findMany({ where: liveIncidentWhere({ status: "open" }) })
//   db.incident.findUnique({ where: { id, ...NOT_DELETED } })
//   db.incidentPage.findMany({ where: { incident: liveIncidentWhere({ ... }) } })
//
// User-facing reads should normally go through lib/incident/access
// (findAccessibleIncident / accessibleIncidentsWhere), which already apply it.
// src/lib/incident/live-filter.test.ts scans the codebase and fails on any
// `db.incident.*` / `tx.incident.*` call that neither uses these helpers nor
// sits on its commented allowlist.

import type { Prisma } from "@prisma/client";

/** Spread into an Incident where (unique or not) to exclude soft-deleted rows. */
export const NOT_DELETED = { deletedAt: null } as const;

/** `extra` AND not soft-deleted. */
export function liveIncidentWhere(extra: Prisma.IncidentWhereInput = {}): Prisma.IncidentWhereInput {
  return { ...extra, ...NOT_DELETED };
}
