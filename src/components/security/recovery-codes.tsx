"use client";

// Shows freshly issued recovery codes exactly once, with copy / download.

import { useState } from "react";
import { Check, Copy, Download, LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function RecoveryCodesDialog({ codes, onClose }: { codes: string[] | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = (codes ?? []).join("\n");

  function download() {
    const blob = new Blob(
      [`Crucible CE recovery codes\nEach code works once. Keep them somewhere safe.\n\n${text}\n`],
      { type: "text/plain" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "crucible-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog open={!!codes} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md" showCloseButton={false} onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LifeBuoy className="h-4 w-4 text-[color:var(--mist-indigo)]" aria-hidden />
            Save your recovery codes
          </DialogTitle>
          <DialogDescription>
            Each code signs you in once. They&apos;re shown only now.
          </DialogDescription>
        </DialogHeader>
        <ul data-testid="recovery-codes" className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/30 p-3 font-mono text-[13px]">
          {(codes ?? []).map((c) => (
            <li key={c} className="tracking-wider">
              {c}
            </li>
          ))}
        </ul>
        <DialogFooter className="gap-2 sm:justify-between sm:gap-2">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard?.writeText(text).then(() => setCopied(true));
              }}
            >
              {copied ? <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden /> : <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={download}>
              <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Download
            </Button>
          </div>
          <Button type="button" onClick={onClose}>
            I&apos;ve saved them
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
