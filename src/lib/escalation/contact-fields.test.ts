import { describe, it, expect } from "vitest";
import { phoneField, shapeContactForViewer } from "./contact-fields";

describe("phoneField (E.164)", () => {
  it("normalizes common formatting to E.164 (national input uses the default country)", () => {
    expect(phoneField.parse("+1 (415) 555-0123")).toBe("+14155550123");
    expect(phoneField.parse("+44 20 7946 0958")).toBe("+442079460958");
    expect(phoneField.parse("(415) 555-0123")).toBe("+14155550123");
  });
  it("treats empty / null as clear and undefined as untouched", () => {
    expect(phoneField.parse("")).toBeNull();
    expect(phoneField.parse(null)).toBeNull();
    expect(phoneField.parse(undefined)).toBeUndefined();
  });
  it("rejects non-E.164 numbers", () => {
    for (const bad of ["+0123456789", "+1 555", "call me", "555-0100 ext 12", "+1234567890123456"]) {
      expect(phoneField.safeParse(bad).success).toBe(false);
    }
  });
});

describe("shapeContactForViewer", () => {
  const c = { id: "c", email: "a@x", phone: "+14155550123", alternatePhone: null, notes: "n" };
  it("hides details from readers", () => {
    const r = shapeContactForViewer(c, { id: "u", role: "reader" });
    expect(r).toMatchObject({ email: null, phone: null, notes: null, detailsHidden: true });
  });
  it("shows details to contributors and admins", () => {
    expect(shapeContactForViewer(c, { id: "u", role: "contributor" })).toMatchObject({ phone: "+14155550123", detailsHidden: false });
    expect(shapeContactForViewer(c, { id: "u", role: "administrator" }).email).toBe("a@x");
  });
});
