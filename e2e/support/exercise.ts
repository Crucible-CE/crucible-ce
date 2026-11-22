// Exercise helpers: drive an exercise through its API, join as a guest with
// an invite code, and watch everything a player receives for hidden fields.

import { expect, type BrowserContext, type Page } from "@playwright/test";

/** POST /api/exercises/{id}/control as the page's user. */
export async function control(page: Page, exerciseId: string, action: string, body: Record<string, unknown> = {}) {
  const res = await page.request.post(`/api/exercises/${exerciseId}/control`, { data: { action, ...body } });
  const json = await res.json().catch(() => ({}));
  expect(res.ok(), `${action}: ${res.status()} ${JSON.stringify(json)}`).toBe(true);
  return json;
}

export async function controlState<T = Record<string, unknown>>(page: Page, exerciseId: string): Promise<T> {
  const res = await page.request.get(`/api/exercises/${exerciseId}/state`);
  expect(res.ok(), `state: ${res.status()}`).toBe(true);
  return (await res.json()) as T;
}

/** Turn on join by code through the API and return the code. */
export async function enableGuestJoin(page: Page, exerciseId: string): Promise<string> {
  const res = await page.request.patch(`/api/exercises/${exerciseId}`, { data: { guestJoin: true } });
  expect(res.ok(), await res.text()).toBe(true);
  const code = await page.request.post(`/api/exercises/${exerciseId}/join-code`);
  expect(code.ok(), await code.text()).toBe(true);
  return ((await code.json()) as { code: string }).code;
}

/** Join with a code in a fresh (guarded) context, as a guest, optionally on a team. */
export async function joinAsGuest(
  open: () => Promise<{ context: BrowserContext; page: Page }>,
  code: string,
  name: string,
  team: string | null,
  watch?: LeakWatch,
): Promise<{ context: BrowserContext; page: Page; exerciseId: string }> {
  const { context, page } = await open();
  watch?.attach(page);
  await page.goto(`/join/${code}`);
  await page.getByLabel("Your name").fill(name);
  if (team) await page.getByLabel("Team").selectOption({ label: team });
  await page.getByRole("button", { name: "Join" }).click();
  await page.waitForURL(/\/play\/c[a-z0-9]+$/, { waitUntil: "commit", timeout: 60_000 });
  const exerciseId = new URL(page.url()).pathname.split("/").pop()!;
  return { context, page, exerciseId };
}

/** Add a CE user to an exercise with exercise roles. Returns the participant id. */
export async function addMember(page: Page, exerciseId: string, name: string, roles: string[]): Promise<string> {
  const found = (await (await page.request.get(`/api/exercises/${exerciseId}/participants?q=${encodeURIComponent(name)}`)).json()) as {
    users: Array<{ id: string }>;
  };
  expect(found.users.length, `no user named ${name}`).toBeGreaterThan(0);
  const added = await page.request.post(`/api/exercises/${exerciseId}/participants`, { data: { userId: found.users[0].id, roles } });
  expect(added.ok(), await added.text()).toBe(true);
  return ((await added.json()) as { participantId: string }).participantId;
}

/**
 * Records every /api response body, play page document and socket frame a
 * page receives, and flags any that contain a hidden field name.
 */
export class LeakWatch {
  readonly leaks: string[] = [];
  frames = 0;
  responses = 0;
  stopped = false;
  constructor(private readonly words: RegExp) {}

  attach(page: Page): void {
    page.on("response", async (res) => {
      if (this.stopped) return;
      const url = res.url();
      const isApi = url.includes("/api/");
      const isPlayDoc = /\/play\/[^/?]+(\?|$)/.test(url) && res.request().resourceType() === "document";
      if (!isApi && !isPlayDoc) return;
      if (url.includes("/exports/")) return; // binary PDF downloads
      const body = await res.text().catch(() => "");
      if (this.stopped) return;
      this.responses++;
      const m = body.match(this.words);
      if (m) this.leaks.push(`${url} [${m[0]}] ${excerpt(body, m.index ?? 0)}`);
    });
    page.on("websocket", (ws) => {
      ws.on("framereceived", (f) => {
        if (this.stopped) return;
        this.frames++;
        const text = typeof f.payload === "string" ? f.payload : f.payload.toString("utf8");
        const m = text.match(this.words);
        if (m) this.leaks.push(`ws [${m[0]}] ${excerpt(text, m.index ?? 0)}`);
      });
    });
  }

  stop(): void {
    this.stopped = true;
  }
}

function excerpt(s: string, at: number): string {
  return s.slice(Math.max(0, at - 120), at + 120).replace(/\s+/g, " ");
}

/** The id at the end of the page URL. */
export function lastSegment(page: Page): string {
  return new URL(page.url()).pathname.split("/").pop()!;
}
