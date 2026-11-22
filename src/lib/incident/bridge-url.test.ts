import { describe, it, expect } from "vitest";
import { isValidBridgeUrl, normalizeBridgeUrl, bridgeUrlSchema } from "./bridge-url";

describe("bridge-url", () => {
  it("accepts https URLs", () => {
    expect(isValidBridgeUrl("https://teams.microsoft.com/l/meetup-join/real")).toBe(true);
    expect(isValidBridgeUrl("https://zoom.us/j/12345")).toBe(true);
  });

  it("rejects non-https schemes and junk", () => {
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,<script>",
      "vbscript:msgbox",
      "file:///etc/passwd",
      "blob:https://x",
      "http://insecure.example",
      "not a url",
      "//protocol-relative",
      "",
    ]) {
      expect(isValidBridgeUrl(bad)).toBe(false);
    }
  });

  it("rejects over-length URLs", () => {
    expect(isValidBridgeUrl("https://x.test/" + "a".repeat(1001))).toBe(false);
  });

  it("normalizeBridgeUrl trims and nulls invalid input", () => {
    expect(normalizeBridgeUrl("  https://ok.test/j  ")).toBe("https://ok.test/j");
    expect(normalizeBridgeUrl("javascript:x")).toBeNull();
  });

  it("bridgeUrlSchema parses valid, throws on invalid", () => {
    expect(bridgeUrlSchema.parse("https://ok.test")).toBe("https://ok.test");
    expect(bridgeUrlSchema.safeParse("http://x").success).toBe(false);
  });
});
