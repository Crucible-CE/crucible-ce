import { describe, it, expect } from "vitest";
import { shouldEscalate, nextEscalationRole } from "./engine";

describe("shouldEscalate", () => {
  const now = new Date("2026-06-18T12:00:00Z");
  const past = new Date("2026-06-18T11:50:00Z");
  const future = new Date("2026-06-18T12:10:00Z");

  it("is true when sent and the deadline is in the past", () => {
    expect(shouldEscalate({ status: "sent", ackDeadlineAt: past }, now)).toBe(true);
  });

  it("is true when sent and the deadline equals now", () => {
    expect(shouldEscalate({ status: "sent", ackDeadlineAt: now }, now)).toBe(true);
  });

  it("is false when the page is already acked", () => {
    expect(shouldEscalate({ status: "acked", ackDeadlineAt: past }, now)).toBe(false);
  });

  it("is false when there is no deadline", () => {
    expect(shouldEscalate({ status: "sent", ackDeadlineAt: null }, now)).toBe(false);
  });

  it("is false when the deadline is in the future", () => {
    expect(shouldEscalate({ status: "sent", ackDeadlineAt: future }, now)).toBe(false);
  });
});

describe("nextEscalationRole", () => {
  it("maps level 0 to tech_lead", () => {
    expect(nextEscalationRole(0)).toBe("tech_lead");
  });

  it("maps level 1 to incident_commander", () => {
    expect(nextEscalationRole(1)).toBe("incident_commander");
  });

  it("maps level 2 to exec_sponsor", () => {
    expect(nextEscalationRole(2)).toBe("exec_sponsor");
  });

  it("returns null past the end of the chain", () => {
    expect(nextEscalationRole(3)).toBeNull();
  });
});
