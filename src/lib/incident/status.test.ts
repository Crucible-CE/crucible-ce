import { describe, it, expect } from "vitest";
import {
  isClosedStatus,
  isReopen,
  ACTIVE_STATUS_FILTER,
  ledgerEventForTransition,
  statusTransitionSideEffects,
} from "./status";

const NOW = new Date("2026-07-04T00:00:00Z");
const clean = { status: "open", containedAt: null, resolvedAt: null, closedAt: null };

describe("incident status canonical semantics", () => {
  it("closed is the ONLY terminal state; recovered is active", () => {
    expect(isClosedStatus("closed")).toBe(true);
    expect(isClosedStatus("recovered")).toBe(false);
    expect(ACTIVE_STATUS_FILTER).toEqual({ notIn: ["closed"] });
  });

  it("contained stamps containedAt once", () => {
    expect(statusTransitionSideEffects(clean, "contained", NOW)).toEqual({ containedAt: NOW });
    expect(statusTransitionSideEffects({ ...clean, status: "contained", containedAt: NOW }, "contained", NOW)).toEqual({});
  });

  it("recovered stamps resolvedAt (previously stamped nothing)", () => {
    expect(statusTransitionSideEffects(clean, "recovered", NOW)).toEqual({ resolvedAt: NOW });
  });

  it("closed stamps BOTH resolvedAt and closedAt when unset", () => {
    expect(statusTransitionSideEffects(clean, "closed", NOW)).toEqual({ resolvedAt: NOW, closedAt: NOW });
  });

  it("closed keeps an existing resolvedAt (recovered→closed)", () => {
    const recovered = { status: "recovered", containedAt: NOW, resolvedAt: NOW, closedAt: null };
    expect(statusTransitionSideEffects(recovered, "closed", NOW)).toEqual({ closedAt: NOW });
  });

  it("reopen to a pre-recovered state clears closure AND resolvedAt", () => {
    const closed = { status: "closed", containedAt: NOW, resolvedAt: NOW, closedAt: NOW };
    const eff = statusTransitionSideEffects(closed, "investigating", NOW);
    expect(eff.closedAt).toBeNull();
    expect(eff.resolvedAt).toBeNull();
    expect(eff.closureDisposition).toBeNull();
  });

  it("reopen to recovered keeps resolvedAt", () => {
    const closed = { status: "closed", containedAt: NOW, resolvedAt: NOW, closedAt: NOW };
    const eff = statusTransitionSideEffects(closed, "recovered", NOW);
    expect(eff.closedAt).toBeNull();
    expect(eff).not.toHaveProperty("resolvedAt");
  });

  it("ledger event classification", () => {
    expect(ledgerEventForTransition("open", "closed")).toBe("incident_closed");
    expect(ledgerEventForTransition("closed", "open")).toBe("incident_reopened");
    expect(ledgerEventForTransition("open", "contained")).toBe("status_changed");
    expect(isReopen("closed", "open")).toBe(true);
    expect(isReopen("open", "closed")).toBe(false);
  });
});
