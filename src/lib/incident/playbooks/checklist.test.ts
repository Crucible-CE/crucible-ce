import { describe, expect, it, vi } from "vitest";
import { boldStep, checklistSize, parseChecklist } from "./checklist";
import { runProgress } from "./service";
import { PLAYBOOK_FILES } from "@/lib/exercise/library/playbooks.generated";

vi.mock("@/lib/db", () => ({ db: {} }));

describe("parseChecklist", () => {
  it("groups numbered list items by Markdown section and skips sections without steps", () => {
    const text = [
      "# Playbook",
      "",
      "## 1. Purpose",
      "",
      "Plain text is not a step.",
      "- A bullet is not a step either.",
      "",
      "## 2. Contain",
      "",
      "1. Isolate the host",
      "   with EDR first",
      "2) Disable the account",
      "",
      "## 3. Recover",
      "",
      "- [ ] Restore from backup",
      "- [x] Rotate the keys",
    ].join("\n");
    const sections = parseChecklist(text);
    expect(sections.map((s) => s.heading)).toEqual(["2. Contain", "3. Recover"]);
    expect(sections[0].steps.map((s) => s.text)).toEqual(["Isolate the host", "Disable the account"]);
    expect(sections[0].steps[0].detail).toBe("Isolate the host with EDR first");
    expect(sections[1].steps.map((s) => s.text)).toEqual(["Restore from backup", "Rotate the keys"]);
    expect(checklistSize(sections)).toBe(4);
  });

  it("reads bold step ids and decision points, and ignores code fences and tables", () => {
    const text = [
      "## 7. Contain",
      "",
      "**C1. Isolate.** Use EDR to isolate encrypted hosts.",
      "",
      "```",
      "1. not a step inside code",
      "```",
      "",
      "| 1. not a step | in a table |",
      "",
      "**C2.** Block the tools the attacker used. Then close the entry point.",
      "",
      "**C5. Block the remote management tools** the attacker used at the firewall.",
      "",
      "**Decision point C-A: cut internet access?** Cut egress when data is leaving.",
      "",
      "**Note.** Bold text that is not a step id.",
    ].join("\n");
    const [contain] = parseChecklist(text);
    expect(contain.steps.map((s) => [s.kind, s.text])).toEqual([
      ["step", "C1. Isolate"],
      ["step", "C2. Block the tools the attacker used"],
      ["step", "C5. Block the remote management tools the attacker used at the firewall"],
      ["decision", "Decision point C-A: cut internet access?"],
    ]);
    expect(contain.steps[0].detail).toBe("C1. Isolate. Use EDR to isolate encrypted hosts.");
  });

  it("uses numbered and ALL CAPS headings in a document without Markdown headings", () => {
    const text = ["INCIDENT RESPONSE PLAN", "", "3.2 Notification", "", "1. Call the regulator", "2. Tell the insurer", "", "4.1 Recovery", "", "1. Restore service"].join("\n");
    const sections = parseChecklist(text);
    expect(sections.map((s) => [s.heading, s.steps.length])).toEqual([
      ["3.2 Notification", 2],
      ["4.1 Recovery", 1],
    ]);
  });

  it("finds steps in every shipped library playbook", () => {
    for (const [file, text] of Object.entries(PLAYBOOK_FILES)) {
      const sections = parseChecklist(text);
      expect(checklistSize(sections), file).toBeGreaterThan(10);
      for (const s of sections) for (const step of s.steps) expect(step.text.length, file).toBeLessThanOrEqual(240);
    }
  });

  it("boldStep returns null for bold text that is not a step", () => {
    expect(boldStep("**Important:** read this")).toBeNull();
    expect(boldStep("plain")).toBeNull();
  });
});

describe("runProgress", () => {
  it("counts done steps", () => {
    expect(runProgress([])).toEqual({ done: 0, total: 0, percent: 0 });
    expect(runProgress([{ doneAt: new Date() }, { doneAt: null }, { doneAt: null }])).toEqual({ done: 1, total: 3, percent: 33 });
  });
});
