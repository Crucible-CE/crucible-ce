// @vitest-environment node
import { describe, expect, it } from "vitest";
import { detectSections, sectionText } from "./sections";

describe("detectSections", () => {
  it("finds markdown headings with nesting", () => {
    const text = "# Plan\nIntro.\n## Detection\nWatch.\n## Containment\nIsolate.\n# Appendix\nList.";
    const s = detectSections(text);
    expect(s.map((x) => [x.heading, x.level])).toEqual([
      ["Plan", 1],
      ["Detection", 2],
      ["Containment", 2],
      ["Appendix", 1],
    ]);
    // A level 1 section contains its subsections.
    expect(sectionText(text, s[0])).toBe("# Plan\nIntro.\n## Detection\nWatch.\n## Containment\nIsolate.\n");
    expect(sectionText(text, s[1])).toBe("## Detection\nWatch.\n");
    expect(s[3].end).toBe(text.length);
    expect(s[1].id).toBe("s2-detection");
  });

  it("finds numbered headings and ALL CAPS lines, not list items or sentences", () => {
    const text = [
      "INCIDENT RESPONSE PLAN",
      "1. Purpose",
      "This plan covers ransomware.",
      "1.1 Scope",
      "1. Call the help desk.",
      "2. Notify legal within one hour, then write it down.",
      "2 Roles and Responsibilities",
      "The IC leads.",
    ].join("\n");
    const s = detectSections(text);
    expect(s.map((x) => [x.heading, x.level])).toEqual([
      ["INCIDENT RESPONSE PLAN", 1],
      ["1 Purpose", 1],
      ["1.1 Scope", 2],
      ["2 Roles and Responsibilities", 1],
    ]);
  });

  it("ignores headings inside code fences", () => {
    const s = detectSections("# Real\n```\n# not a heading\n```\n");
    expect(s.map((x) => x.heading)).toEqual(["Real"]);
  });

  it("returns one whole-document section when there are no headings, none for empty text", () => {
    expect(detectSections("just some text\nmore text")).toEqual([{ id: "s1-document", heading: "Document", level: 1, start: 0, end: 24 }]);
    expect(detectSections("")).toEqual([]);
  });
});
