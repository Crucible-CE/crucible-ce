// @vitest-environment node
import { describe, expect, it } from "vitest";
import { branchConditionSchema, evaluateCondition } from "@/lib/exercise/modes/shared/branching";
import { CONDITION_TYPES, buildCondition, describeCondition, emptyFields, fieldsOf } from "./conditions";

const TEAMS = ["Executive", "Legal"];

describe("studio condition editor", () => {
  it("covers every condition type in branching.ts", () => {
    const runtimeTypes = branchConditionSchema.options.map((o) => o.shape.type.value).sort();
    expect([...CONDITION_TYPES].sort()).toEqual(runtimeTypes);
  });

  it.each(CONDITION_TYPES)("builds a valid %s condition from default fields", (type) => {
    for (const mode of ["strategic", "document"] as const) {
      const r = buildCondition(type, emptyFields(mode, TEAMS));
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(branchConditionSchema.safeParse(r.condition).success).toBe(true);
      expect(r.condition.type).toBe(type);
      // Round trip: fields from the condition build the same condition.
      const again = buildCondition(type, fieldsOf(r.condition, mode, TEAMS));
      expect(again).toEqual(r);
      expect(describeCondition(r.condition, mode)).not.toBe("Invalid condition");
    }
  });

  it("builds conditions the runtime evaluates as intended", () => {
    const f = emptyFields("strategic", TEAMS);
    const outcome = buildCondition("team_outcome", { ...f, team: "Legal", outcome: "ineffective" });
    expect(outcome).toEqual({ ok: true, condition: { type: "team_outcome", team: "Legal", outcome: "ineffective" } });
    if (!outcome.ok) return;
    expect(evaluateCondition(outcome.condition, { outcomes: { Legal: "ineffective" } })).toBe(true);
    expect(evaluateCondition(outcome.condition, { outcomes: { Legal: "effective" } })).toBe(false);

    const below = buildCondition("score_below", { ...f, value: "2.5" });
    expect(below.ok && evaluateCondition(below.condition, { avgScore: 2 })).toBe(true);
    const atLeast = buildCondition("score_at_least", { ...f, value: "3" });
    expect(atLeast.ok && evaluateCondition(atLeast.condition, { avgScore: 3 })).toBe(true);
    const entries = buildCondition("entries_at_least", { ...f, entryType: "gap", count: "2" });
    expect(entries.ok && evaluateCondition(entries.condition, { byType: { gap: 2 } })).toBe(true);
    const majority = buildCondition("majority", { ...f, team: "Executive", optionId: "b" });
    expect(majority.ok && evaluateCondition(majority.condition, { majority: { Executive: "b" } })).toBe(true);
    const path = buildCondition("path", { ...f, path: "critical" });
    expect(path.ok && evaluateCondition(path.condition, { newPath: "critical" })).toBe(true);
  });

  it("rejects incomplete fields with a plain message", () => {
    const f = emptyFields("strategic", []);
    expect(buildCondition("team_outcome", f)).toEqual({ ok: false, error: "Pick a team." });
    expect(buildCondition("score_below", { ...f, value: "9" })).toEqual({ ok: false, error: "Enter a score from 0 to 4." });
    expect(buildCondition("score_below", { ...f, value: "" })).toEqual({ ok: false, error: "Enter a score from 0 to 4." });
    expect(buildCondition("entries_at_least", { ...f, count: "1.5" }).ok).toBe(false);
  });

  it("labels edges plainly", () => {
    expect(describeCondition({ type: "default" }, "strategic")).toBe("Otherwise");
    expect(describeCondition({ type: "team_outcome", team: "Legal", outcome: "ineffective" }, "strategic")).toBe("Legal: Not effective");
    expect(describeCondition({ type: "team_outcome", team: "Ops", outcome: "not_met" }, "document")).toBe("Ops: Not met");
    expect(describeCondition({ type: "score_below", value: 2 }, "strategic")).toBe("Score below 2");
    expect(describeCondition({ type: "nope" }, "strategic")).toBe("Invalid condition");
  });
});
