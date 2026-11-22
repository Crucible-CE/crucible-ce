import { describe, expect, it } from "vitest";
import { FEED_TOKEN_KEY, feedTokenHashOf, feedTokenMatches, hashFeedToken, newFeedToken } from "./feed-token";

describe("feed token", () => {
  it("is random, url safe and long", () => {
    const a = newFeedToken();
    const b = newFeedToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("matches only the stored hash", () => {
    const token = newFeedToken();
    const stored = hashFeedToken(token);
    expect(feedTokenMatches(token, stored)).toBe(true);
    expect(feedTokenMatches(newFeedToken(), stored)).toBe(false);
    expect(feedTokenMatches(stored, stored)).toBe(false);
    expect(feedTokenMatches(`${token}x`, stored)).toBe(false);
  });

  it("fails closed without a token or a hash", () => {
    const token = newFeedToken();
    expect(feedTokenMatches(token, null)).toBe(false);
    expect(feedTokenMatches(null, hashFeedToken(token))).toBe(false);
    expect(feedTokenMatches("", hashFeedToken(""))).toBe(false);
    expect(feedTokenMatches("short", hashFeedToken("short"))).toBe(false);
    expect(feedTokenMatches("bad token with spaces and more chars", hashFeedToken("bad token with spaces and more chars"))).toBe(false);
  });

  it("reads the hash from policy JSON and ignores junk", () => {
    const h = hashFeedToken("x");
    expect(feedTokenHashOf({ [FEED_TOKEN_KEY]: h, cadence: {} })).toBe(h);
    expect(feedTokenHashOf({ [FEED_TOKEN_KEY]: "not-a-hash" })).toBeNull();
    expect(feedTokenHashOf(null)).toBeNull();
    expect(feedTokenHashOf([h])).toBeNull();
  });
});
