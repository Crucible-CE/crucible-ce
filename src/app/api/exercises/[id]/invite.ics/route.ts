// GET /api/exercises/{id}/invite.ics   driver: the exercise as a calendar file
// with the join link, the code and the pre-read brief.
import { fileResponse } from "@/lib/http/file-response";
import { ICS_CONTENT_TYPE } from "@/lib/exercise/schedule/ics";
import { requestPrincipal, requireAccess } from "@/lib/exercise/access";
import { withErrors } from "@/lib/exercise/errors";
import { exerciseInviteCalendar } from "@/lib/exercise/invites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function slug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "exercise";
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withErrors(async () => {
    const { id } = await params;
    const principal = await requestPrincipal(req, { allowGuest: false });
    await requireAccess(id, principal, "driver");
    const { title, ics } = await exerciseInviteCalendar(id, new URL(req.url).origin);
    return fileResponse(ics, { filename: `${slug(title)}.ics`, contentType: ICS_CONTENT_TYPE, trustedContentType: true });
  });
}
