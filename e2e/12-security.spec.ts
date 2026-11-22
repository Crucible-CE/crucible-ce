// Security assertions: CSRF Origin check, JSON-only bodies, anonymous API.
import { expect, test } from "./support/fixtures";
import { BASE_URL } from "./support/helpers";

test("cross-origin POST is rejected with 403", async ({ as }) => {
  const { context } = await as("admin");
  const res = await context.request.post("/api/incidents", {
    headers: { Origin: "http://evil.example" },
    data: { title: "csrf", description: "csrf" },
  });
  expect(res.status()).toBe(403);
  expect(await res.json()).toMatchObject({ error: "Forbidden", code: "csrf_origin_mismatch" });

  // The same request from the app's own origin is accepted by the CSRF layer
  // (it reaches validation instead).
  const same = await context.request.post("/api/incidents", { headers: { Origin: BASE_URL }, data: {} });
  expect(same.status()).toBe(400);
});

test("a text/plain body is rejected with 415", async ({ as }) => {
  const { context } = await as("admin");
  const res = await context.request.post("/api/incidents", {
    headers: { "Content-Type": "text/plain" },
    data: JSON.stringify({ title: "x", description: "y" }),
  });
  expect(res.status()).toBe(415);
  expect(await res.json()).toMatchObject({ error: "Unsupported media type" });
});

test("anonymous /api calls get a JSON 401", async ({ request }) => {
  for (const path of ["/api/incidents", "/api/org-members", "/api/admin/audit/org", "/api/notifications/preferences"]) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(401);
    expect(res.headers()["content-type"]).toContain("application/json");
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  }
  const post = await request.post("/api/incidents", { data: { title: "x", description: "y" } });
  expect(post.status()).toBe(401);
});
