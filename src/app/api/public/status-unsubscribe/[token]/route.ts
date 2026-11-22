import { db } from "@/lib/db";
import { verifyUnsubscribeToken } from "@/lib/incident/status-page";
import { publicHtmlPage, publicMessage } from "@/lib/http/public-html";

interface RouteContext {
  params: Promise<{ token: string }>;
}

const TITLE = "Unsubscribe";
const INVALID = () => publicHtmlPage(TITLE, publicMessage("Link not valid", "This unsubscribe link is not valid."), 410);
const DONE = () => publicHtmlPage(TITLE, publicMessage("Unsubscribed", "You get no more status updates from this page."));

// GET shows a button and changes nothing (mail scanners prefetch links).
export async function GET(_req: Request, context: RouteContext) {
  const { token } = await context.params;
  const id = verifyUnsubscribeToken(token);
  if (!id) return INVALID();
  const sub = await db.statusPageSubscriber.findUnique({ where: { id }, select: { unsubscribedAt: true } });
  if (!sub) return INVALID();
  if (sub.unsubscribedAt) return DONE();
  return publicHtmlPage(TITLE, publicMessage("Unsubscribe", "Stop email updates from this status page.", "Unsubscribe"));
}

// POST unsubscribes. Also the RFC 8058 one-click target of List-Unsubscribe.
export async function POST(_req: Request, context: RouteContext) {
  const { token } = await context.params;
  const id = verifyUnsubscribeToken(token);
  if (!id) return INVALID();
  await db.statusPageSubscriber.updateMany({ where: { id, unsubscribedAt: null }, data: { unsubscribedAt: new Date() } });
  return DONE();
}
