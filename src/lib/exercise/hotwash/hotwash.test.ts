import { describe, expect, it } from "vitest";
import { canRate, effectiveRating } from "./ratings";
import { feedbackInputSchema, summarizeFeedback, type FeedbackView } from "./feedback";
import type { ParticipantRow } from "@/lib/exercise/runtime/types";

function participant(roles: ParticipantRow["roles"]): ParticipantRow {
  return { id: "p", userId: "u", displayName: "X", title: null, teamId: null, roles, isDecisionMaker: false, isGuest: false, joinedAt: null, leftAt: null, removedAt: null };
}

describe("rating permissions", () => {
  it("lets evaluators and the lead facilitator rate", () => {
    expect(canRate({ participant: null, isControl: true, isDriver: false }, participant(["evaluator"]), false)).toBe(true);
    expect(canRate({ participant: null, isControl: true, isDriver: true }, participant(["lead_facilitator"]), false)).toBe(true);
  });
  it("refuses players, observers and controllers", () => {
    expect(canRate({ participant: null, isControl: false, isDriver: false }, participant(["player"]), false)).toBe(false);
    expect(canRate({ participant: null, isControl: false, isDriver: false }, participant(["observer"]), false)).toBe(false);
    expect(canRate({ participant: null, isControl: true, isDriver: true }, participant(["controller"]), false)).toBe(false);
  });
  it("lets the owner and admins rate", () => {
    expect(canRate({ participant: null, isControl: true, isDriver: true }, null, true)).toBe(true);
  });
});

describe("effective rating", () => {
  it("is the latest evaluator rating, never an AI one", () => {
    const rows = [
      { id: "1", source: "evaluator", rating: "M", createdAt: new Date("2026-01-01T10:00:00Z") },
      { id: "2", source: "evaluator", rating: "S", createdAt: new Date("2026-01-01T11:00:00Z") },
      { id: "3", source: "ai", rating: "P", createdAt: new Date("2026-01-01T12:00:00Z") },
    ];
    expect(effectiveRating(rows)?.id).toBe("2");
    expect(effectiveRating(rows.filter((r) => r.source === "ai"))).toBeNull();
  });
});

describe("participant feedback", () => {
  it("validates the 1 to 5 scales", () => {
    expect(feedbackInputSchema.safeParse({ overall: 5, realism: 4, relevance: 3, roleClarity: 1 }).success).toBe(true);
    expect(feedbackInputSchema.safeParse({ overall: 6, realism: 4, relevance: 3, roleClarity: 1 }).success).toBe(false);
    expect(feedbackInputSchema.safeParse({ overall: 0, realism: 4, relevance: 3, roleClarity: 1 }).success).toBe(false);
    expect(feedbackInputSchema.safeParse({ overall: 2.5, realism: 4, relevance: 3, roleClarity: 1 }).success).toBe(false);
  });
  it("summarizes without names", () => {
    const row = (n: number, s = ""): FeedbackView => ({ overall: n, realism: n, relevance: n, roleClarity: n, strengths: s, improvements: "", comments: "", updatedAt: "" });
    const s = summarizeFeedback([row(5, "Good pace"), row(4), row(3)], 6);
    expect(s.responses).toBe(3);
    expect(s.participants).toBe(6);
    expect(s.averages.overall).toBe(4);
    expect(s.distribution.overall).toEqual([0, 0, 1, 1, 1]);
    expect(s.strengths).toEqual(["Good pace"]);
  });
});
