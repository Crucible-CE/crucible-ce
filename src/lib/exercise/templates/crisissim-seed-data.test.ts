// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  anchoredTime,
  expectedActionsSchema,
  templateConfigSchema,
  templateInjectContentSchema,
  templateInjectSecretSchema,
  templateObjectivesSchema,
  PATH_KEYS,
  WEEKDAYS,
} from "@/lib/exercise/modes/crisissim/schema";
import { formatIssues, optionBalanceIssues, validateTemplate } from "@/lib/exercise/modes/crisissim/validate";
import {
  CRISISSIM_SEED_TEMPLATES,
  PRACTICE_TEMPLATE_ID,
  RANSOMWARE_TEMPLATE_ID,
  THIRD_PARTY_TEMPLATE_ID,
  type SeedTemplate,
} from "./crisissim-seed-data";
import { parseSeedTemplate } from "./crisissim-seed";

function parseTemplate(t: SeedTemplate) {
  const config = templateConfigSchema.parse(t.config);
  const objectives = templateObjectivesSchema.parse(t.objectives);
  const injects = t.injects.map((inj) => ({
    title: inj.title,
    scenarioOffsetMin: inj.scenarioOffsetMin,
    plannedDelayMin: inj.plannedDelayMin,
    targetTeams: inj.targetTeams,
    objectiveKeys: inj.objectiveKeys,
    expectedActions: expectedActionsSchema.parse(inj.expectedActions),
    content: templateInjectContentSchema.parse(inj.content),
    secret: templateInjectSecretSchema.parse(inj.secret),
  }));
  return { config, objectives, injects };
}

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out);
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      collectStrings(v, out);
    }
  }
  return out;
}

function byId(id: string) {
  const t = CRISISSIM_SEED_TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`missing ${id}`);
  return t;
}

describe("crisis sim seed templates", () => {
  it("has unique ids", () => {
    const ids = CRISISSIM_SEED_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([PRACTICE_TEMPLATE_ID, RANSOMWARE_TEMPLATE_ID, THIRD_PARTY_TEMPLATE_ID]);
  });

  for (const t of CRISISSIM_SEED_TEMPLATES) {
    describe(t.id, () => {
      it("parses and validates with no issues", () => {
        const parsed = parseTemplate(t);
        const issues = validateTemplate(parsed);
        expect(issues, formatIssues(issues, 50)).toEqual([]);
        expect(() => parseSeedTemplate(t)).not.toThrow();
      });

      it("uses options a to d with one or two bad on every path options and a good option on each path", () => {
        const { injects } = parseTemplate(t);
        for (const inj of injects) {
          for (const q of inj.content.questions) {
            expect(q.options.map((o) => o.id)).toEqual(["a", "b", "c", "d"]);
            const quality = inj.secret.quality[q.team];
            const allBad = q.options.filter((o) => PATH_KEYS.every((p) => quality[o.id][p] === "bad")).length;
            expect(allBad, `${inj.title} ${q.team}`).toBeGreaterThanOrEqual(1);
            expect(allBad, `${inj.title} ${q.team}`).toBeLessThanOrEqual(2);
            for (const o of q.options) {
              expect(inj.secret.followUps[q.team][o.id]).toBeTruthy();
              expect(inj.secret.rationales[q.team]?.[o.id], `${inj.title} ${q.team} ${o.id} rationale`).toBeTruthy();
            }
            expect(q.decisionOwner).toBeTruthy();
            expect(q.discussionPrompt).toBeTruthy();
          }
        }
      });

      it("keeps options a similar length and the best option no longer than the rest", () => {
        const { injects } = parseTemplate(t);
        for (const inj of injects) {
          expect(optionBalanceIssues(inj), inj.title).toEqual([]);
          for (const q of inj.content.questions) {
            const lengths = q.options.map((o) => o.text.length);
            const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
            for (const o of q.options) {
              const ratio = o.text.length / avg;
              const label = `${inj.title} ${q.team} ${o.id} is ${o.text.length} chars, average ${Math.round(avg)}`;
              expect(ratio, label).toBeGreaterThanOrEqual(0.7);
              expect(ratio, label).toBeLessThanOrEqual(1.3);
            }
          }
        }
      });

      it("writes 2 to 4 expected actions for every team with a question", () => {
        const { injects } = parseTemplate(t);
        for (const inj of injects) {
          for (const q of inj.content.questions) {
            const ea = inj.expectedActions.find((e) => e.team === q.team);
            expect(ea, `${inj.title} ${q.team}`).toBeDefined();
            expect(ea!.actions.length).toBeGreaterThanOrEqual(2);
            expect(ea!.actions.length).toBeLessThanOrEqual(4);
          }
        }
      });

      it("plans about 80 percent of the target duration", () => {
        const { config, injects } = parseTemplate(t);
        const total = injects.reduce((a, i) => a + (i.plannedDelayMin ?? 0), 0);
        expect(injects.every((i) => i.plannedDelayMin !== null)).toBe(true);
        expect(total / config.targetDurationMin).toBeGreaterThanOrEqual(0.7);
        expect(total / config.targetDurationMin).toBeLessThanOrEqual(0.9);
      });

      it("uses strictly increasing scenario time", () => {
        const offsets = t.injects.map((i) => i.scenarioOffsetMin);
        for (let i = 1; i < offsets.length; i++) expect(offsets[i]).toBeGreaterThan(offsets[i - 1]);
      });

      it("has a scenario anchor that matches the times written in the narratives", () => {
        const { config, injects } = parseTemplate(t);
        expect(config.scenarioAnchor).toBeDefined();
        const anchor = config.scenarioAnchor!;
        const re = new RegExp(`^(?:(${WEEKDAYS.join("|")}) )?(\\d\\d:\\d\\d)\\.`);
        for (const inj of injects) {
          const at = anchoredTime(anchor, inj.scenarioOffsetMin);
          for (const p of PATH_KEYS) {
            const m = re.exec(inj.content.variants[p].narrativeMd);
            if (!m) continue;
            expect(m[2], `${inj.title} ${p}`).toBe(at.time);
            if (m[1]) expect(m[1], `${inj.title} ${p}`).toBe(at.weekday);
          }
        }
      });

      it("contains no em or en dashes", () => {
        const bad = collectStrings(t).filter((s) => s.includes("\u2014") || s.includes("\u2013"));
        expect(bad).toEqual([]);
      });
    });
  }

  it("practice template is a single team practice run with no hold after close", () => {
    const config = templateConfigSchema.parse(byId(PRACTICE_TEMPLATE_ID).config);
    expect(config.practice).toBe(true);
    expect(config.holdAfterClose).toBe(false);
    expect(config.teams).toHaveLength(1);
    expect(config.regulatoryClocks).toEqual([]);
    expect(byId(PRACTICE_TEMPLATE_ID).injects).toHaveLength(3);
  });

  it("ransomware template: materiality starts the SEC clock, offers Item 8.01, and the insurer clock starts at detection", () => {
    const { injects, config } = parseTemplate(byId(RANSOMWARE_TEMPLATE_ID));
    const materiality = injects.flatMap((inj) =>
      inj.content.questions.filter((q) => q.type === "materiality").map((q) => ({ q, secret: inj.secret })),
    );
    expect(materiality).toHaveLength(1);
    const { q, secret } = materiality[0];
    const triggers = Object.values(secret.clockEffects[q.team] ?? {}).some((effs) => effs.some((e) => e.key === "sec_8k" && e.action === "trigger"));
    expect(triggers).toBe(true);
    expect(q.options.some((o) => o.text.includes("8.01"))).toBe(true);
    const under5 = q.options.find((o) => /5 percent/.test(o.text));
    expect(under5).toBeDefined();
    expect(PATH_KEYS.every((p) => secret.quality[q.team][under5!.id][p] === "bad")).toBe(true);

    expect(injects[0].secret.clockTriggers).toContain("insurer_notice");
    expect(config.regulatoryClocks.map((c) => c.key)).toContain("state_ag");
    const stateAg = injects.some(
      (i) => i.secret.clockTriggers.includes("state_ag") || (i.secret.clockTriggersByPath.degrading ?? []).includes("state_ag"),
    );
    expect(stateAg).toBe(true);
    expect(injects.some((i) => i.content.questions.some((x) => x.type === "ransom"))).toBe(true);
    const text = JSON.stringify(injects);
    expect(text).toContain("Item 1.05(c)");
    expect(text).toMatch(/trading window/i);
    expect(text).toMatch(/Regulation FD|Reg FD/);
    const disclosure = injects.find((i) => i.title === "Disclosure")!;
    for (const p of PATH_KEYS) expect(disclosure.content.variants[p].narrativeMd).toContain("The 8-K draft is ready for review.");
  });

  it("third-party template starts GDPR at the advisory and state notice at customer exposure, with an insurer clock", () => {
    const { injects, config } = parseTemplate(byId(THIRD_PARTY_TEMPLATE_ID));
    expect(config.regulatoryClocks.map((c) => c.key)).toEqual(expect.arrayContaining(["gdpr_72h", "state_ag", "insurer_notice"]));
    expect(injects[0].secret.clockTriggers).toContain("gdpr_72h");
    expect(injects[1].secret.clockTriggers).toContain("state_ag");
    const legal = injects[0].content.questions.find((q) => q.team === "Legal")!;
    expect(legal.stem).toBe("Has Calloway become aware of a personal data breach under Art. 33?");
  });
});
