"use client";

// ---------------------------------------------------------------------------
// useConfirm() — the ONE promise-based confirmation convention (spec §2.6).
//
//   const confirm = useConfirm();
//   const ok = await confirm({ title, description?, confirmLabel?,
//                              cancelLabel?, destructive? });
//   if (!ok) return; // cancel/dismiss is a true no-op
//
// <ConfirmDialogProvider> is mounted ONCE in the (platform) layout. It also
// backs usePromptDialog() (src/components/ui/prompt-dialog.tsx) — the
// text-input variant — so the platform mounts a single provider for both.
// Requests queue: a second confirm() while one is open shows after the
// first resolves. Dismissal (Esc / overlay) resolves false / null.
// ---------------------------------------------------------------------------

import * as React from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export interface PromptOptions {
  title: string;
  description?: string;
  label?: string;
  placeholder?: string;
  required?: boolean;
  destructive?: boolean;
  confirmLabel?: string;
  multiline?: boolean;
}

type Request =
  | { kind: "confirm"; opts: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: "prompt"; opts: PromptOptions; resolve: (value: string | null) => void };

interface ConfirmContextValue {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  promptText: (opts: PromptOptions) => Promise<string | null>;
}

const ConfirmContext = React.createContext<ConfirmContextValue | null>(null);

export function useConfirm(): (opts: ConfirmOptions) => Promise<boolean> {
  const ctx = React.useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within <ConfirmDialogProvider> (mounted in the platform layout)");
  return ctx.confirm;
}

/** Internal — consumed by prompt-dialog.tsx's usePromptDialog(). */
export function usePromptContext(): ConfirmContextValue {
  const ctx = React.useContext(ConfirmContext);
  if (!ctx) throw new Error("usePromptDialog must be used within <ConfirmDialogProvider> (mounted in the platform layout)");
  return ctx;
}

export function ConfirmDialogProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = React.useState<Request[]>([]);
  const active = queue[0] ?? null;
  const [promptValue, setPromptValue] = React.useState("");

  const enqueue = React.useCallback((req: Request) => {
    setQueue((q) => [...q, req]);
  }, []);

  const value = React.useMemo<ConfirmContextValue>(
    () => ({
      confirm: (opts) => new Promise<boolean>((resolve) => enqueue({ kind: "confirm", opts, resolve })),
      promptText: (opts) => new Promise<string | null>((resolve) => enqueue({ kind: "prompt", opts, resolve })),
    }),
    [enqueue],
  );

  const settle = React.useCallback(
    (result: boolean | string | null) => {
      setQueue((q) => {
        const [head, ...rest] = q;
        if (head) {
          if (head.kind === "confirm") head.resolve(result === true);
          else head.resolve(typeof result === "string" ? result : null);
        }
        return rest;
      });
      setPromptValue("");
    },
    [],
  );

  const promptTrimmed = promptValue.trim();
  const promptBlocked = active?.kind === "prompt" && !!active.opts.required && promptTrimmed.length === 0;

  return (
    <ConfirmContext.Provider value={value}>
      {children}

      {active?.kind === "confirm" && (
        <AlertDialog open onOpenChange={(open) => { if (!open) settle(false); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{active.opts.title}</AlertDialogTitle>
              {active.opts.description && (
                <AlertDialogDescription>{active.opts.description}</AlertDialogDescription>
              )}
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => settle(false)}>
                {active.opts.cancelLabel ?? "Cancel"}
              </AlertDialogCancel>
              <AlertDialogAction
                className={cn(active.opts.destructive && buttonVariants({ variant: "destructive" }))}
                onClick={() => settle(true)}
              >
                {active.opts.confirmLabel ?? "Confirm"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {active?.kind === "prompt" && (
        <Dialog open onOpenChange={(open) => { if (!open) settle(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{active.opts.title}</DialogTitle>
              {active.opts.description && (
                <DialogDescription>{active.opts.description}</DialogDescription>
              )}
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!promptBlocked) settle(promptValue.trim());
              }}
              className="space-y-3"
            >
              <div className="space-y-1.5">
                {active.opts.label && (
                  <label className="text-xs font-medium text-muted-foreground">
                    {active.opts.label}
                    {active.opts.required && <span className="text-[color:var(--mist-danger)]"> *</span>}
                  </label>
                )}
                {active.opts.multiline ? (
                  <textarea
                    autoFocus
                    value={promptValue}
                    onChange={(e) => setPromptValue(e.target.value)}
                    placeholder={active.opts.placeholder}
                    rows={3}
                    className="w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 py-1.5 text-sm"
                  />
                ) : (
                  <Input
                    autoFocus
                    value={promptValue}
                    onChange={(e) => setPromptValue(e.target.value)}
                    placeholder={active.opts.placeholder}
                  />
                )}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => settle(null)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant={active.opts.destructive ? "destructive" : "default"}
                  disabled={promptBlocked}
                >
                  {active.opts.confirmLabel ?? "Confirm"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </ConfirmContext.Provider>
  );
}
