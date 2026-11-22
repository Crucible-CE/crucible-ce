import { describe, it, expect, afterEach } from "vitest";
import { toE164, phoneForStorage } from "./e164";
import { e164PhoneField } from "./schema";

afterEach(() => {
  delete process.env.PHONE_DEFAULT_COUNTRY_CODE;
});

describe("toE164", () => {
  it("canonicalizes the common NANP spellings to one form", () => {
    for (const raw of ["+1 (555) 010-0001", "(555) 010-0001", "555.010.0001", "1-555-010-0001", "+15550100001", "tel:+1-555-010-0001"]) {
      expect(toE164(raw)).toBe("+15550100001");
    }
  });

  it("handles international input (+ and 00 prefixes) and a non-NANP default country", () => {
    expect(toE164("+44 20 7946 0958")).toBe("+442079460958");
    expect(toE164("0044 20 7946 0958")).toBe("+442079460958");
    process.env.PHONE_DEFAULT_COUNTRY_CODE = "44";
    expect(toE164("020 7946 0958")).toBe("+442079460958");
    expect(toE164("44 20 7946 0958")).toBe("+442079460958");
  });

  it("rejects unreadable input", () => {
    for (const raw of ["", "   ", "555-0100 ext 12", "12345", "+0123456789", "not a number", "+1234567890123456"]) {
      expect(toE164(raw)).toBeNull();
    }
    expect(toE164(null)).toBeNull();
  });

  it("phoneForStorage keeps unreadable input as typed and nulls empties", () => {
    expect(phoneForStorage(" (555) 010-0001 ")).toBe("+15550100001");
    expect(phoneForStorage("ext 12")).toBe("ext 12");
    expect(phoneForStorage("  ")).toBeNull();
  });
});

describe("e164PhoneField (write-time validation)", () => {
  const field = e164PhoneField();
  it("normalizes, nulls empties, and rejects unreadable numbers", () => {
    expect(field.parse("(555) 010-0001")).toBe("+15550100001");
    expect(field.parse("")).toBeNull();
    expect(field.parse(null)).toBeNull();
    expect(field.parse(undefined)).toBeUndefined();
    expect(field.safeParse("call me maybe").success).toBe(false);
  });
});
