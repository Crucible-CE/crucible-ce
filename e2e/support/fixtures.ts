// Shared fixtures: every page a test opens (in the default context or in a
// per-user context from `as()`) is watched for console errors, uncaught page
// errors and unexpected HTTP 4xx/5xx responses; the test fails at teardown if
// any were seen. A test that EXPECTS an error status (a 404 for a hidden
// incident, a 409 for a reused ack link) declares it with guard.allowHttp().

import { test as base, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import path from "node:path";
import { STATE_DIR } from "../stack";

type Problem = string;

export class Guard {
  private problems: Problem[] = [];
  private httpAllow: RegExp[] = [];
  private consoleAllow: RegExp[] = [
    // A browser-level message for a response the test already allowed via
    // allowHttp (Chromium logs "Failed to load resource: ... 404" for them).
    /Failed to load resource: the server responded with a status of/,
  ];
  private watched = new WeakSet<BrowserContext>();

  allowHttp(re: RegExp): void {
    this.httpAllow.push(re);
  }

  allowConsole(re: RegExp): void {
    this.consoleAllow.push(re);
  }

  watchPage(page: Page): void {
    trackInflight(page);
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const text = msg.text();
      if (this.consoleAllow.some((re) => re.test(text))) return;
      this.problems.push(`console.error on ${page.url()}: ${text}`);
    });
    page.on("pageerror", (err) => {
      this.problems.push(`uncaught page error on ${page.url()}: ${err.message}`);
    });
    page.on("response", (res) => {
      const status = res.status();
      if (status < 400) return;
      const line = `${status} ${res.request().method()} ${res.url()}`;
      if (this.httpAllow.some((re) => re.test(line))) return;
      this.problems.push(`unexpected HTTP ${line}`);
    });
  }

  watch(ctx: BrowserContext): void {
    if (this.watched.has(ctx)) return;
    this.watched.add(ctx);
    for (const p of ctx.pages()) this.watchPage(p);
    ctx.on("page", (p) => this.watchPage(p));
  }

  take(): Problem[] {
    const out = this.problems;
    this.problems = [];
    return out;
  }
}

export type UserKey = "admin" | "contributor" | "reader";

export function storageStatePath(user: UserKey): string {
  return path.join(STATE_DIR, `${user}.storage.json`);
}

type Fixtures = {
  guard: Guard;
  /** A fresh, guarded browser context signed in as `user` (saved storage state). */
  as: (user: UserKey) => Promise<{ context: BrowserContext; page: Page }>;
  /** A fresh, guarded anonymous browser context. */
  anon: () => Promise<{ context: BrowserContext; page: Page }>;
};

async function guardedContext(browser: Browser, guard: Guard, opened: BrowserContext[], storageState?: string) {
  const context = await browser.newContext({ storageState });
  guard.watch(context);
  opened.push(context);
  const page = await context.newPage();
  return { context, page };
}

export const test = base.extend<Fixtures>({
  guard: [
    async ({ context }, provide) => {
      const guard = new Guard();
      guard.watch(context);
      await provide(guard);
      const problems = guard.take();
      expect(problems, "console errors / unexpected HTTP errors seen during the test").toEqual([]);
    },
    { auto: true },
  ],
  as: async ({ browser, guard }, provide) => {
    const opened: BrowserContext[] = [];
    await provide((user) => guardedContext(browser, guard, opened, storageStatePath(user)));
    for (const c of opened) await c.close();
  },
  anon: async ({ browser, guard }, provide) => {
    const opened: BrowserContext[] = [];
    await provide(() => guardedContext(browser, guard, opened));
    for (const c of opened) await c.close();
  },
});

export { expect };

// ---- In-flight API tracking (for settle) ------------------------------------
// Navigating while the app's own fetches are in flight aborts them, and
// next-auth then logs "Failed to fetch" to the console. `settle()` waits for
// the page's /api/* fetches to drain first. (networkidle never fires on the
// platform pages: they hold long-lived connections.)
const inflight = new WeakMap<Page, Set<object>>();

function trackInflight(page: Page): void {
  const set = new Set<object>();
  inflight.set(page, set);
  const tracked = (url: string) => url.includes("/api/") && !url.includes("/socket.io/");
  page.on("request", (r) => {
    if (tracked(r.url())) set.add(r);
  });
  page.on("requestfinished", (r) => set.delete(r));
  page.on("requestfailed", (r) => set.delete(r));
}

/** Wait until the page has had no /api/* request in flight for `quietMs`. */
export async function settle(page: Page, { quietMs = 400, timeoutMs = 10_000 } = {}): Promise<void> {
  const set = inflight.get(page);
  if (!set) return;
  const deadline = Date.now() + timeoutMs;
  let quietSince = set.size === 0 ? Date.now() : 0;
  while (Date.now() < deadline) {
    if (set.size === 0) {
      if (!quietSince) quietSince = Date.now();
      if (Date.now() - quietSince >= quietMs) return;
    } else quietSince = 0;
    await page.waitForTimeout(50);
  }
}
