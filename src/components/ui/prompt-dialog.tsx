"use client";

// ---------------------------------------------------------------------------
// usePromptDialog() — text-input variant of useConfirm.
//
//   const promptText = usePromptDialog();
//   const reason = await promptText({ title, label, required: true });
//   if (reason === null) return; // cancel/dismiss is a true no-op
//
// Backed by the same <ConfirmDialogProvider> as useConfirm — the platform
// layout mounts ONE provider for both. Replaces browser prompt() sites
// (which conflated cancel with empty input).
// ---------------------------------------------------------------------------

import { usePromptContext, type PromptOptions } from "./confirm-dialog";

export type { PromptOptions };

export function usePromptDialog(): (opts: PromptOptions) => Promise<string | null> {
  return usePromptContext().promptText;
}
