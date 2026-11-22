// GET /api/schedule/{id}/ics   signed-in users: the entry's upcoming dates as a calendar file
import { requireUser } from "@/lib/exercise/auth/session";
import { withErrors } from "@/lib/exercise/errors";
import { fileResponse } from "@/lib/http/file-response";
import { ICS_CONTENT_TYPE } from "@/lib/exercise/schedule/ics";
import { scheduleIcs } from "@/lib/exercise/schedule/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function slug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "exercise";
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await requireUser();
  if (!a.ok) return a.response;
  const { id } = await params;
  return withErrors(async () => {
    const { title, ics } = await scheduleIcs(id);
    return fileResponse(ics, { filename: `${slug(title)}.ics`, contentType: ICS_CONTENT_TYPE, trustedContentType: true });
  });
}
