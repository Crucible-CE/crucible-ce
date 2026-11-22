// GET /api/exercises/{id}/msel[?format=csv]: Master Scenario Events List (control).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requestPrincipal, requireAccess } from "@/lib/exercise/access";
import { withErrors } from "@/lib/exercise/errors";
import { buildMsel, mselCsv } from "@/lib/exercise/msel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fileName(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "exercise";
  return `msel-${slug}.csv`;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withErrors(async () => {
    const { id } = await params;
    const principal = await requestPrincipal(req, { allowGuest: false });
    await requireAccess(id, principal, "control");
    const msel = await buildMsel(id);
    if (new URL(req.url).searchParams.get("format") === "csv") {
      const ex = await db.exercise.findUnique({ where: { id }, select: { title: true } });
      return new NextResponse(mselCsv(msel.rows, msel.timezone), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${fileName(ex?.title ?? "exercise")}"`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    return NextResponse.json(msel, { headers: { "Cache-Control": "no-store" } });
  });
}
