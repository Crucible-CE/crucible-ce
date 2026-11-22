import { describe, it, expect } from "vitest";
import { parseMentions, type MentionMember } from "./mentions";

const members: MentionMember[] = [
  { id: "u1", name: "Alice Smith", email: "alice@acme.com" },
  { id: "u2", name: "Bob Jones", email: "bjones@acme.com" },
  { id: "u3", name: "Chen Wu", email: "chen.wu@acme.com" },
];

describe("parseMentions", () => {
  it("returns empty when there are no mentions", () => {
    expect(parseMentions("status is contained", members)).toEqual([]);
  });

  it("matches a member by first name", () => {
    expect(parseMentions("@alice please confirm", members)).toEqual(["u1"]);
  });

  it("matches by email local-part", () => {
    expect(parseMentions("ping @bjones", members)).toEqual(["u2"]);
  });

  it("matches by compacted full name", () => {
    expect(parseMentions("@chenwu can you check", members)).toEqual(["u3"]);
  });

  it("matches multiple distinct mentions", () => {
    expect(parseMentions("@alice and @bob", members).sort()).toEqual(["u1", "u2"]);
  });

  it("de-duplicates repeated mentions of the same person", () => {
    expect(parseMentions("@alice @alice", members)).toEqual(["u1"]);
  });

  it("ignores unknown handles", () => {
    expect(parseMentions("@nobody here", members)).toEqual([]);
  });

  it("is case-insensitive", () => {
    expect(parseMentions("@ALICE", members)).toEqual(["u1"]);
  });

  it("does not treat an email address in the text as a mention", () => {
    expect(parseMentions("reply to alice@acme.com when done", members)).toEqual([]);
  });

  it("still matches a real mention next to an email", () => {
    expect(parseMentions("email is bjones@acme.com — ping @alice", members)).toEqual(["u1"]);
  });
});
