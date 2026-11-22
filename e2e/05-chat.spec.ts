// 5. War-room chat: a contributor's message reaches the admin LIVE over the
// Socket.io websocket (not the 5 s history poll), and presence shows both.
import type { WebSocket } from "@playwright/test";
import { expect, test } from "./support/fixtures";
import { go, need } from "./support/helpers";

test("chat message arrives live over the websocket; presence shows both responders", async ({ as }) => {
  const id = need("incidentId");
  const admin = need("admin");
  const contributor = need("contributor");

  // Contributor enters the room first so the admin's first presence read sees them.
  const { page: c } = await as("contributor");
  await go(c, `/incidents/${id}/chat`);
  await expect(c.getByText("Live", { exact: true })).toBeVisible();

  const { page: a } = await as("admin");
  const frames: string[] = [];
  let joined = false;
  a.on("websocket", (ws: WebSocket) => {
    if (!ws.url().includes("/socket.io/") || !ws.url().includes("transport=websocket")) return;
    ws.on("framesent", (f) => {
      if (typeof f.payload === "string" && f.payload.includes('"join-incident"') && f.payload.includes(id)) joined = true;
    });
    ws.on("framereceived", (f) => {
      if (typeof f.payload === "string") frames.push(f.payload);
    });
  });
  await go(a, `/incidents/${id}/chat`);
  await expect(a.getByText("Live", { exact: true })).toBeVisible();
  await expect.poll(() => joined, { message: "admin joined the incident room over a websocket" }).toBe(true);
  await expect.poll(() => frames.some((f) => f.startsWith("40/war-room"))).toBe(true);

  // Presence: both responders are in the room.
  await expect(a.getByText("2 in the room")).toBeVisible();
  await expect(a.locator(`span[title="${admin.name}"]`)).toBeVisible();
  await expect(a.locator(`span[title="${contributor.name}"]`)).toBeVisible();

  // The contributor posts; the admin must see it within ~3 s, delivered as a
  // chat:message websocket frame (the history poll runs only every 5 s).
  const text = `Contributor here: VPN logs pulled ${Date.now()}`;
  await c.getByPlaceholder("Message the team").fill(text);
  const sentAt = Date.now();
  await c.getByPlaceholder("Message the team").press("Enter");
  await expect(a.getByText(text)).toBeVisible({ timeout: 3_000 });
  const elapsed = Date.now() - sentAt;
  expect(
    frames.some((f) => f.startsWith("42/war-room") && f.includes('"chat:message"') && f.includes(text)),
    "message arrived as a chat:message websocket frame",
  ).toBe(true);
  expect(elapsed).toBeLessThan(3_000);
  await expect(a.getByText("Live", { exact: true })).toBeVisible();
});
