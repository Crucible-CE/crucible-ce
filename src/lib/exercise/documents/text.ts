// Small document helpers with no framework imports. Safe to load from the
// server boot path (library seeding runs before Next is ready).

import { createHash } from "node:crypto";

/** Exercise statuses that count as "in use" for a document or template. */
export const ACTIVE_EXERCISE_STATUSES = ["draft", "lobby", "live", "paused"];

/** Strip a BOM, normalize line endings and drop control characters. */
export function cleanText(text: string): string {
  return text
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
