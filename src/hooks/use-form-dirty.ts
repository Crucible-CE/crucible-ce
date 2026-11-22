"use client";

// dirty check against a baseline snapshot captured on load. For surfaces
// that don't already track an explicit `dirty` flag (wizards, editors).
// A null baseline (still loading) is never dirty.

export function useFormDirty<T>(
  current: T,
  baseline: T | null | undefined,
  isEqual?: (a: T, b: T) => boolean,
): boolean {
  if (baseline === null || baseline === undefined) return false;
  if (isEqual) return !isEqual(current, baseline);
  return JSON.stringify(current) !== JSON.stringify(baseline);
}
