import { db } from "@/lib/db";
import { sha256Hex } from "@/lib/crypto/hash";
import { isWellFormedToken } from "@/lib/incident/guest";
import { publicHtmlPage, publicMessage } from "@/lib/http/public-html";

interface RouteContext {
  params: Promise<{ token: string }>;
}

const TITLE = "Confirm status updates";
const INVALID = () => publicHtmlPage(TITLE, publicMessage("Link not valid", "Subscribe again from the status page."), 410);

async function find(token: string) {
  if (!isWellFormedToken(token)) return null;
  return db.statusPageSubscriber.findUnique({
    where: { confirmTokenHash: sha256Hex(token) },
    select: { id: true, confirmedAt: true, unsubscribedAt: true, statusPage: { select: { title: true } } },
  });
}

// GET shows a button and changes nothing (mail scanners prefetch links).
export async function GET(_req: Request, context: RouteContext) {
  const { token } = await context.params;
  const sub = await find(token);
  if (!sub || sub.unsubscribedAt) return INVALID();
  if (sub.confirmedAt) return publicHtmlPage(TITLE, publicMessage("Confirmed", `You get updates for ${sub.statusPage.title}.`));
  return publicHtmlPage(TITLE, publicMessage("Confirm status updates", `Get email updates for ${sub.statusPage.title}.`, "Confirm"));
}

// POST confirms, once.
export async function POST(_req: Request, context: RouteContext) {
  const { token } = await context.params;
  const sub = await find(token);
  if (!sub || sub.unsubscribedAt) return INVALID();
  await db.statusPageSubscriber.updateMany({ where: { id: sub.id, confirmedAt: null, unsubscribedAt: null }, data: { confirmedAt: new Date() } });
  return publicHtmlPage(TITLE, publicMessage("Confirmed", `You get updates for ${sub.statusPage.title}.`));
}
