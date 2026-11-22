// GET /api/action-items/export?<same filters as the list>   improvement plan matrix as CSV
import { db } from "@/lib/db";
import { fileResponse } from "@/lib/http/file-response";
import { withErrors } from "@/lib/exercise/errors";
import { assertPlanRead, planUser } from "@/lib/exercise/improvement/access";
import { actionItemsCsv, filtersFromSearch, listActionItems } from "@/lib/exercise/improvement/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return withErrors(async () => {
    const user = await planUser();
    const filters = filtersFromSearch(new URL(req.url).searchParams);
    let exerciseId = filters.exerciseId ?? null;
    if (!exerciseId && filters.aarId) {
      exerciseId = (await db.afterActionReport.findUnique({ where: { id: filters.aarId }, select: { exerciseId: true } }))?.exerciseId ?? null;
    }
    await assertPlanRead(user, exerciseId);
    const items = await listActionItems(filters);
    const day = new Date().toISOString().slice(0, 10);
    return fileResponse(actionItemsCsv(items), {
      filename: `improvement-plan-${day}.csv`,
      contentType: "text/csv; charset=utf-8",
      trustedContentType: true,
    });
  });
}
