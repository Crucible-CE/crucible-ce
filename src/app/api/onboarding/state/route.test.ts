// @vitest-environment node
// POST /api/onboarding/state — welcome dismissal, hidden card, skipped optional steps.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  db: { onboardingState: { upsert: vi.fn(), deleteMany: vi.fn() } },
}));
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/db", () => ({ db: h.db }));

import { POST } from "./route";

const as = (role: string) => ({ user: { id: "u-1", organizationId: "org-1", role } });
const req = (body: unknown) =>
  new Request("http://x/api/onboarding/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  h.db.onboardingState.upsert.mockResolvedValue({});
  h.db.onboardingState.deleteMany.mockResolvedValue({ count: 1 });
});

describe("onboarding state", () => {
  it("401 without a session", async () => {
    h.auth.mockResolvedValue(null);
    expect((await POST(req({ action: "dismiss_welcome" }))).status).toBe(401);
  });

  it("any member can dismiss the welcome and hide / show their card (per user)", async () => {
    h.auth.mockResolvedValue(as("reader"));
    expect((await POST(req({ action: "dismiss_welcome" }))).status).toBe(200);
    expect(h.db.onboardingState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { scope_subjectId_key: { scope: "user", subjectId: "u-1", key: "welcome_dismissed" } } }),
    );
    expect((await POST(req({ action: "hide_card" }))).status).toBe(200);
    expect(h.db.onboardingState.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { scope_subjectId_key: { scope: "user", subjectId: "u-1", key: "card_hidden" } } }),
    );
    expect((await POST(req({ action: "show_card" }))).status).toBe(200);
    expect(h.db.onboardingState.deleteMany).toHaveBeenCalledWith({ where: { scope: "user", subjectId: "u-1", key: "card_hidden" } });
  });

  it("administrators skip optional org steps (per org); others are refused", async () => {
    h.auth.mockResolvedValue(as("administrator"));
    expect((await POST(req({ action: "skip", step: "signing_key" }))).status).toBe(200);
    expect(h.db.onboardingState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { scope_subjectId_key: { scope: "org", subjectId: "org-1", key: "skip:signing_key" } } }),
    );
    expect((await POST(req({ action: "unskip", step: "signing_key" }))).status).toBe(200);
    expect(h.db.onboardingState.deleteMany).toHaveBeenCalledWith({ where: { scope: "org", subjectId: "org-1", key: "skip:signing_key" } });

    h.auth.mockResolvedValue(as("contributor"));
    expect((await POST(req({ action: "skip", step: "signing_key" }))).status).toBe(403);
  });

  it("required steps cannot be skipped; unknown actions are rejected", async () => {
    h.auth.mockResolvedValue(as("administrator"));
    expect((await POST(req({ action: "skip", step: "email_delivery" }))).status).toBe(400);
    expect((await POST(req({ action: "complete", step: "email_delivery" }))).status).toBe(400);
    expect(h.db.onboardingState.upsert).not.toHaveBeenCalled();
  });
});
