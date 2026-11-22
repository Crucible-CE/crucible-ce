import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getAdminContext } from "@/lib/auth/admin-guard";
import { computeIncidentMetrics } from "@/lib/metrics/incident-metrics";

// Incident-command metrics for the org over a rolling window: volume by
// severity/status, MTTA/MTTC/MTTR, FP rate, bucketed time-series, impact
// rollup, and optional group-by.
const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(90),
  bucket: z.enum(["day", "week", "month"]).optional(),
  groupBy: z.enum(["assignee", "category", "asset", "severity", "status"]).optional(),
});

export async function GET(req: Request) {
  const ctx = await getAdminContext();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query", details: parsed.error.flatten() }, { status: 400 });
  }
  const { days, bucket, groupBy } = parsed.data;

  // Funnels through accessibleIncidentsWhere with the caller's real role:
  // administrators see every incident, locked ones included (lock rules).
  const result = await computeIncidentMetrics(
    { id: session.user.id, organizationId: ctx.organizationId, role: session.user.role },
    { windowDays: days, bucket, groupBy },
  );
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
