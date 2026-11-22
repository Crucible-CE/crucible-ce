import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUnsubscribeToken, eligibleAudiences, pageUpdatesWhere, publicStatusLabel, statusPageLive, verifyUnsubscribeToken } from "./status-page";

vi.mock("@/lib/db", () => ({ db: {} }));

describe("status page rules", () => {
  it("never shows internal updates", () => {
    expect(eligibleAudiences("public")).toEqual(["public"]);
    expect(eligibleAudiences("customer")).toEqual(["public", "customer"]);
    expect(eligibleAudiences("anything")).not.toContain("internal");
  });

  it("only posted, unretracted updates of eligible audiences", () => {
    expect(pageUpdatesWhere("inc1", "public")).toEqual({ incidentId: "inc1", publishedToPageAt: { not: null }, unpublishedAt: null, audience: { in: ["public"] } });
  });

  it("maps internal statuses to three public labels", () => {
    expect(publicStatusLabel("open")).toBe("Investigating");
    expect(publicStatusLabel("investigating")).toBe("Investigating");
    expect(publicStatusLabel("contained")).toBe("Monitoring");
    expect(publicStatusLabel("recovered")).toBe("Monitoring");
    expect(publicStatusLabel("closed")).toBe("Resolved");
    expect(publicStatusLabel("weird")).toBe("Investigating");
  });

  it("is live only when published on an unlocked, undeleted incident", () => {
    expect(statusPageLive({ isPublished: true }, { restricted: false, deletedAt: null })).toBe(true);
    expect(statusPageLive({ isPublished: false }, { restricted: false, deletedAt: null })).toBe(false);
    expect(statusPageLive({ isPublished: true }, { restricted: true, deletedAt: null })).toBe(false);
    expect(statusPageLive({ isPublished: true }, { restricted: false, deletedAt: new Date() })).toBe(false);
  });
});

describe("unsubscribe tokens", () => {
  const saved = process.env.AUTH_SECRET;
  beforeEach(() => {
    process.env.AUTH_SECRET = "test-secret-0123456789abcdef0123456789abcdef";
  });
  afterEach(() => {
    process.env.AUTH_SECRET = saved;
  });

  it("verify only when signed for that subscriber", () => {
    const t = createUnsubscribeToken("csub0000000000000001");
    expect(verifyUnsubscribeToken(t)).toBe("csub0000000000000001");
    expect(verifyUnsubscribeToken(t.replace("0001", "0002"))).toBeNull();
    expect(verifyUnsubscribeToken(`${t.slice(0, -1)}${t.endsWith("A") ? "B" : "A"}`)).toBeNull();
    expect(verifyUnsubscribeToken("garbage")).toBeNull();
    process.env.AUTH_SECRET = "another-secret-0123456789abcdef0123456789";
    expect(verifyUnsubscribeToken(t)).toBeNull();
  });
});
