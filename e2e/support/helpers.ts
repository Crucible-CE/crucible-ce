// Run state shared between specs, plus small clients for Mailpit and the
// webhook receiver.

import { expect, type APIRequestContext, type APIResponse } from "@playwright/test";
import { settle } from "./fixtures";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { BASE_URL, MAILPIT_URL, STATE_DIR, WEBHOOK_URL, readState } from "../stack";

export type User = { name: string; email: string; password: string; id?: string };

export type RunState = {
  admin?: User;
  contributor?: User;
  reader?: User;
  contactId?: string;
  contactEmail?: string;
  outsiderContactId?: string;
  outsiderEmail?: string;
  incidentId?: string;
  incidentTitle?: string;
  [k: string]: unknown;
};

const RUN_FILE = path.join(STATE_DIR, "run.json");

export function loadRun(): RunState {
  if (!existsSync(RUN_FILE)) return {};
  return JSON.parse(readFileSync(RUN_FILE, "utf8")) as RunState;
}

export function saveRun(patch: Partial<RunState>): RunState {
  mkdirSync(STATE_DIR, { recursive: true });
  const next = { ...loadRun(), ...patch };
  writeFileSync(RUN_FILE, JSON.stringify(next, null, 2));
  return next;
}

export function need<K extends keyof RunState>(key: K): NonNullable<RunState[K]> {
  const v = loadRun()[key];
  if (v === undefined || v === null) throw new Error(`run state "${String(key)}" missing: an earlier spec failed`);
  return v as NonNullable<RunState[K]>;
}

export const stack = () => readState();
export { BASE_URL };

/** JSON body of a response after asserting its status. */
export async function expectJson<T = Record<string, unknown>>(res: APIResponse, status: number | number[]): Promise<T> {
  const statuses = Array.isArray(status) ? status : [status];
  const text = await res.text();
  expect(statuses, `${res.url()} -> ${res.status()}: ${text.slice(0, 500)}`).toContain(res.status());
  return (text ? JSON.parse(text) : {}) as T;
}

// ---- Mailpit ---------------------------------------------------------------

export type MailSummary = { ID: string; Subject: string; To: { Address: string }[]; Created: string };
export type MailMessage = MailSummary & { Text: string; HTML: string };

export async function mailpitSearch(request: APIRequestContext, query: string): Promise<MailSummary[]> {
  const res = await request.get(`${MAILPIT_URL}/api/v1/search`, { params: { query } });
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { messages: MailSummary[] };
  return body.messages;
}

export async function mailpitMessage(request: APIRequestContext, id: string): Promise<MailMessage> {
  const res = await request.get(`${MAILPIT_URL}/api/v1/message/${id}`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as MailMessage;
}

/** Wait for the newest mail to `to` (optionally matching a subject regex) that arrived after `since`. */
export async function waitForMail(
  request: APIRequestContext,
  to: string,
  opts: { since?: Date; subject?: RegExp; timeout?: number } = {},
): Promise<MailMessage> {
  let found: MailSummary | undefined;
  await expect
    .poll(
      async () => {
        const msgs = await mailpitSearch(request, `to:"${to}"`);
        found = msgs.find(
          (m) =>
            (!opts.since || new Date(m.Created).getTime() >= opts.since.getTime() - 2000) &&
            (!opts.subject || opts.subject.test(m.Subject)),
        );
        return !!found;
      },
      { timeout: opts.timeout ?? 45_000, intervals: [500, 1000, 2000] },
    )
    .toBe(true);
  return mailpitMessage(request, found!.ID);
}

export function firstLink(text: string, pathPart: string): string {
  const re = new RegExp(`https?://[^\\s"'<>]*${pathPart.replace(/[/]/g, "\\/")}[^\\s"'<>]*`);
  const m = text.match(re);
  if (!m) throw new Error(`no link containing ${pathPart} in:\n${text.slice(0, 2000)}`);
  return m[0].replace(/&amp;/g, "&");
}

// ---- Webhook receiver ------------------------------------------------------

export type Hook = {
  at: string;
  path: string;
  valid: boolean;
  signature: string | null;
  raw: string;
  body: Record<string, unknown> | null;
};

export async function webhookReceived(request: APIRequestContext): Promise<Hook[]> {
  const res = await request.get(`${WEBHOOK_URL}/received`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as Hook[];
}

export const uniq = (prefix: string) => `${prefix}-${Date.now().toString(36)}`;

/** Navigate and let the page's own fetches settle (navigating away mid-fetch
 * makes next-auth log an aborted "Failed to fetch", which the guard reports). */
export async function go(page: import("@playwright/test").Page, url: string): Promise<void> {
  await settle(page); // let the current page finish its own fetches first
  await page.goto(url);
  await page.waitForLoadState("load");
  await settle(page);
}

/** Pick an option in a Radix Select (role=combobox trigger, role=option items). */
export async function pickOption(
  trigger: import("@playwright/test").Locator,
  option: string | RegExp,
): Promise<void> {
  await trigger.click();
  await trigger.page().getByRole("option", { name: option }).click();
}

/** A sonner toast containing `text`. */
export function toast(page: import("@playwright/test").Page, text: string | RegExp) {
  return page.locator("[data-sonner-toast]").filter({ hasText: text }).first();
}
