// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const { mockConfirm, mockPush } = vi.hoisted(() => ({
  mockConfirm: vi.fn(),
  mockPush: vi.fn(),
}));

vi.mock("@/components/ui/confirm-dialog", () => ({ useConfirm: () => mockConfirm }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

import { useUnsavedChangesGuard } from "./use-unsaved-changes-guard";
import { useFormDirty } from "./use-form-dirty";

function fireBeforeUnload(): { defaultPrevented: boolean } {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e;
}

function clickAnchor(href: string, attrs: Record<string, string> = {}): MouseEvent {
  const a = document.createElement("a");
  a.setAttribute("href", href);
  for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
  document.body.appendChild(a);
  const e = new MouseEvent("click", { bubbles: true, cancelable: true });
  a.dispatchEvent(e);
  a.remove();
  return e;
}

describe("useUnsavedChangesGuard", () => {
  beforeEach(() => {
    mockConfirm.mockReset();
    mockPush.mockReset();
    document.body.innerHTML = "";
  });

  it("beforeunload: prevents default only when dirty", () => {
    const { rerender, unmount } = renderHook(({ dirty }) => useUnsavedChangesGuard(dirty), {
      initialProps: { dirty: false },
    });
    expect(fireBeforeUnload().defaultPrevented).toBe(false);

    rerender({ dirty: true });
    expect(fireBeforeUnload().defaultPrevented).toBe(true);
    unmount();
  });

  it("intercepts internal anchor clicks while dirty; navigates on confirm", async () => {
    mockConfirm.mockResolvedValue(true);
    const { unmount } = renderHook(() => useUnsavedChangesGuard(true));

    const e = clickAnchor("/somewhere-else");
    expect(e.defaultPrevented).toBe(true);
    await act(async () => {});
    expect(mockConfirm).toHaveBeenCalledOnce();
    expect(mockPush).toHaveBeenCalledWith("/somewhere-else");
    unmount();
  });

  it("stays put when the discard dialog is cancelled", async () => {
    mockConfirm.mockResolvedValue(false);
    const { unmount } = renderHook(() => useUnsavedChangesGuard(true));

    const e = clickAnchor("/elsewhere");
    expect(e.defaultPrevented).toBe(true);
    await act(async () => {});
    expect(mockPush).not.toHaveBeenCalled();
    unmount();
  });

  it("does not intercept external, _blank, download, or bypass links", () => {
    const { unmount } = renderHook(() => useUnsavedChangesGuard(true));

    expect(clickAnchor("https://example.com/x").defaultPrevented).toBe(false);
    expect(clickAnchor("/x", { target: "_blank" }).defaultPrevented).toBe(false);
    expect(clickAnchor("/x", { download: "" }).defaultPrevented).toBe(false);
    expect(clickAnchor("/x", { "data-bypass-guard": "" }).defaultPrevented).toBe(false);
    expect(mockConfirm).not.toHaveBeenCalled();
    unmount();
  });

  it("does not intercept when clean or disabled", () => {
    const clean = renderHook(() => useUnsavedChangesGuard(false));
    expect(clickAnchor("/x").defaultPrevented).toBe(false);
    clean.unmount();

    const disabled = renderHook(() => useUnsavedChangesGuard(true, { enabled: false }));
    expect(clickAnchor("/y").defaultPrevented).toBe(false);
    expect(fireBeforeUnload().defaultPrevented).toBe(false);
    disabled.unmount();
  });

  it("confirmIfDirty: true immediately when clean, asks when dirty", async () => {
    mockConfirm.mockResolvedValue(true);
    const clean = renderHook(() => useUnsavedChangesGuard(false));
    await expect(clean.result.current.confirmIfDirty()).resolves.toBe(true);
    expect(mockConfirm).not.toHaveBeenCalled();
    clean.unmount();

    const dirty = renderHook(() => useUnsavedChangesGuard(true));
    await expect(dirty.result.current.confirmIfDirty()).resolves.toBe(true);
    expect(mockConfirm).toHaveBeenCalledOnce();
    dirty.unmount();
  });
});

describe("useFormDirty", () => {
  it("false for identical values, true for changed, false for null baseline", () => {
    expect(useFormDirty({ a: 1 }, { a: 1 })).toBe(false);
    expect(useFormDirty({ a: 1 }, { a: 2 })).toBe(true);
    expect(useFormDirty({ a: 1 }, null)).toBe(false);
    expect(useFormDirty({ a: 1 }, undefined)).toBe(false);
  });

  it("honors a custom comparator", () => {
    expect(useFormDirty("A", "a", (x, y) => x.toLowerCase() === y.toLowerCase())).toBe(false);
  });
});
