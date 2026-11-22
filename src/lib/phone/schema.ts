import { z } from "zod";
import { toE164 } from "./e164";

export const PHONE_FORMAT_MESSAGE = "Enter a phone number like +15551234567.";

/**
 * Optional phone input normalized to E.164 at write time. Empty -> null;
 * unreadable -> validation error (so a bad number is fixed at entry, not
 * discovered when a page silently can't reach it).
 */
export function e164PhoneField(max = 30) {
  return z
    .string()
    .max(max)
    .nullable()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined) return undefined;
      if (v === null || v.trim() === "") return null;
      const e164 = toE164(v);
      if (!e164) {
        ctx.addIssue({ code: "custom", message: PHONE_FORMAT_MESSAGE });
        return z.NEVER;
      }
      return e164;
    });
}
