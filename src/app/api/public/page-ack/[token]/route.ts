import { db } from "@/lib/db";
import { verifyAckToken } from "@/lib/delivery/ack-token";
import { acknowledgePage } from "@/lib/escalation/engine";
import { escapeHtml } from "@/lib/email/transport";
import { RESTRICTED_INCIDENT_TITLE, isRedactedTarget } from "@/lib/delivery/redaction";
import { ackTestPage, findTestPage, testPageStateMessage, type TestPageRecord } from "@/lib/onboarding/test-page-ack";
import { ackBroadcastRecipient, findBroadcastRecipient, type BroadcastAckRecord } from "@/lib/broadcast/ack";

// Out-of-band acknowledge link carried in every page (email / SMS / webhook).
//
// GET  shows a confirmation page and changes NOTHING: mail scanners, link
//      previewers and chat unfurlers prefetch links, and must not be able to
//      ack a page on the responder's behalf.
// POST (the page's button) redeems the token: a guarded sent -> acked
//      transition pinned to the token's escalation level, so the link works
//      exactly once and dies when the page escalates, is acked any other way,
//      or the incident closes.
// No session needed: the signed token is the credential (docs/paging.md).

interface RouteContext {
  params: Promise<{ token: string }>;
}

function htmlPage(title: string, body: string, status = 200): Response {
  const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;background:#f6f7f9;color:#111;margin:0;padding:24px}main{max-width:480px;margin:10vh auto;background:#fff;border:1px solid #e3e5e8;border-radius:10px;padding:28px}h1{font-size:19px;margin:0 0 12px}p{font-size:14px;line-height:1.55;color:#333}.sev{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:2px 8px;border-radius:4px;background:#fee2e2;color:#991b1b}button{margin-top:16px;width:100%;padding:12px;font-size:15px;font-weight:600;color:#fff;background:#dc2626;border:0;border-radius:8px;cursor:pointer}@media (prefers-color-scheme:dark){body{background:#0f1115;color:#eee}main{background:#171a21;border-color:#2a2f3a}p{color:#c9ccd3}}</style>
</head><body><main>${body}</main></body></html>`;
  return new Response(doc, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
      // /api/* gets no page CSP from the middleware (lib/security/csp-scope),
      // so this self-contained page carries its own: no script at all.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

const INVALID: Record<string, string> = {
  malformed: "This link isn't valid.",
  bad_signature: "This link isn't valid.",
  expired: "This link expired. Open Crucible to acknowledge.",
};

async function lookup(token: string) {
  const t = verifyAckToken(token);
  if (!t.ok) return { error: INVALID[t.reason] ?? "This link isn't valid." } as const;
  const page = await db.incidentPage.findUnique({
    where: { id: t.pageId },
    select: {
      id: true,
      status: true,
      escalationLevel: true,
      organizationId: true,
      incidentId: true,
      targetUserId: true,
      targetContactId: true,
      targetLabel: true,
      incident: { select: { title: true, severity: true, status: true, restricted: true, deletedAt: true } },
    },
  });
  if (!page) {
    // Not an incident page: maybe the onboarding self test page (same link,
    // same confirm-then-POST flow; lib/onboarding/test-page).
    const test = await findTestPage(t.pageId);
    if (test) return { t, test } as const;
    // Or a broadcast recipient (lib/broadcast): level 0, same flow.
    const broadcast = t.level === 0 ? await findBroadcastRecipient(t.pageId) : null;
    if (broadcast) return { t, broadcast } as const;
    return { error: "This page no longer exists." } as const;
  }
  if (page.incident.deletedAt) return { error: "This page no longer exists." } as const;
  // Locked incident + a target the lock excludes: the link holder was sent a
  // redacted page, so this landing page never shows the incident title either.
  const redacted = await isRedactedTarget(page).catch(() => true);
  const title = redacted ? RESTRICTED_INCIDENT_TITLE : page.incident.title;
  return { t, page, title } as const;
}

function stateMessage(page: { status: string; escalationLevel: number; incident: { status: string } }, level: number): string | null {
  if (page.incident.status === "closed") return "The incident is closed. Nothing to acknowledge.";
  if (page.status === "acked") return "This page has already been acknowledged.";
  if (page.status === "cancelled") return "This page was cancelled.";
  if (page.status === "expired") return "This page expired.";
  if (page.escalationLevel !== level) return "This page escalated to someone else. This link no longer works.";
  return null;
}

const TEST_HEADING = `<span class="sev">Test</span><h1 style="margin-top:10px">Test page</h1>`;

function testPageGet(test: TestPageRecord, level: number): Response {
  const state = testPageStateMessage(test.state, level);
  if (state) return htmlPage("Acknowledge test page", `${TEST_HEADING}<p>${escapeHtml(state)}</p>`);
  return htmlPage(
    "Acknowledge test page",
    `${TEST_HEADING}<p>${test.userName ? `${escapeHtml(test.userName)}, this` : "This"} is a test page you sent yourself.</p>
<form method="post"><button type="submit">Acknowledge</button></form>`,
  );
}

async function testPagePost(test: TestPageRecord, level: number): Promise<Response> {
  const state = testPageStateMessage(test.state, level);
  if (state) return htmlPage("Acknowledge test page", `<h1>Nothing to acknowledge</h1><p>${escapeHtml(state)}</p>`, 409);
  const won = await ackTestPage(test, "link", level);
  if (!won) return htmlPage("Acknowledge test page", `<h1>Nothing to acknowledge</h1><p>This test page was already handled.</p>`, 409);
  return htmlPage(
    "Test page acknowledged",
    `<h1>Acknowledged</h1><p>Test page acknowledged. You can close this tab.</p>`,
  );
}

function broadcastGet(b: BroadcastAckRecord): Response {
  const heading = `<h1>${escapeHtml(b.title)}</h1>`;
  if (b.acknowledgedAt) return htmlPage("Acknowledge message", `${heading}<p>Already acknowledged.</p>`);
  return htmlPage(
    "Acknowledge message",
    `${heading}<p>${escapeHtml(b.name)}, acknowledge that you got this message.</p>
<form method="post"><button type="submit">Acknowledge</button></form>`,
  );
}

async function broadcastPost(b: BroadcastAckRecord): Promise<Response> {
  const won = await ackBroadcastRecipient(b.recipientId, "link");
  if (!won) return htmlPage("Acknowledge message", `<h1>Nothing to acknowledge</h1><p>Already acknowledged.</p>`, 409);
  return htmlPage("Message acknowledged", `<h1>Acknowledged</h1><p>You can close this tab.</p>`);
}

export async function GET(_req: Request, context: RouteContext) {
  const { token } = await context.params;
  const r = await lookup(token);
  if ("error" in r) return htmlPage("Acknowledge page", `<h1>Link not valid</h1><p>${escapeHtml(r.error ?? "")}</p>`, 410);
  if ("test" in r && r.test) return testPageGet(r.test, r.t.level);
  if ("broadcast" in r && r.broadcast) return broadcastGet(r.broadcast);
  const { page, t, title } = r;
  const state = stateMessage(page, t.level);
  const heading = `<span class="sev">${escapeHtml(page.incident.severity)}</span><h1 style="margin-top:10px">${escapeHtml(title)}</h1>`;
  if (state) return htmlPage("Acknowledge page", `${heading}<p>${escapeHtml(state)}</p>`);
  return htmlPage(
    "Acknowledge page",
    `${heading}<p>${page.targetLabel ? `${escapeHtml(page.targetLabel)}, you` : "You"} have been paged to this incident. Acknowledge to stop escalation.</p>
<form method="post"><button type="submit">Acknowledge</button></form>`,
  );
}

export async function POST(_req: Request, context: RouteContext) {
  const { token } = await context.params;
  const r = await lookup(token);
  if ("error" in r) return htmlPage("Acknowledge page", `<h1>Link not valid</h1><p>${escapeHtml(r.error ?? "")}</p>`, 410);
  if ("test" in r && r.test) return testPagePost(r.test, r.t.level);
  if ("broadcast" in r && r.broadcast) return broadcastPost(r.broadcast);
  const { page, t, title } = r;
  const state = stateMessage(page, t.level);
  if (state) return htmlPage("Acknowledge page", `<h1>Nothing to acknowledge</h1><p>${escapeHtml(state)}</p>`, 409);
  const won = await acknowledgePage(page.id, { userId: page.targetUserId, via: "link", level: t.level });
  if (!won) return htmlPage("Acknowledge page", `<h1>Nothing to acknowledge</h1><p>This page was already handled.</p>`, 409);
  return htmlPage(
    "Page acknowledged",
    `<h1>Acknowledged</h1><p>Escalation for <strong>${escapeHtml(title)}</strong> has stopped. Open Crucible to join the response.</p>`,
  );
}
