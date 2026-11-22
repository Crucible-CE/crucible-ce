"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Maximize2, XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";

export interface Shot {
  src: string;
  alt: string;
  title: string;
}

/**
 * A screenshot thumbnail that opens full screen on click. The viewer steps
 * through every shot in `shots` (arrow keys or the side buttons) and closes
 * with Esc, the close button, or a click on the backdrop.
 */
export function ScreenshotLightbox({ shots, index }: { shots: Shot[]; index: number }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(index);
  const shot = shots[index];
  const active = shots[current];

  const step = useCallback(
    (delta: number) => setCurrent((c) => (c + delta + shots.length) % shots.length),
    [shots.length],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, step]);

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setCurrent(index);
        setOpen(next);
      }}
    >
      <DialogPrimitive.Trigger asChild>
        <button
          type="button"
          className="group relative block aspect-[16/10] w-full cursor-zoom-in border-b border-[color:var(--color-border)] bg-[color:var(--color-muted)]/30 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--mist-indigo)]"
          aria-label={`View larger: ${shot.alt}`}
        >
          <Image
            src={shot.src}
            alt={shot.alt}
            fill
            className="object-cover object-top transition-transform duration-300 group-hover:scale-[1.02]"
            sizes="(max-width: 768px) 100vw, 50vw"
          />
          <span className="pointer-events-none absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 text-[11px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            <Maximize2 className="h-3 w-3" /> View larger
          </span>
        </button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex flex-col items-center justify-center p-4 outline-none sm:p-10"
          onClick={(e) => {
            // Click on the empty area around the image closes the viewer.
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <DialogPrimitive.Title className="sr-only">{active.title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">{active.alt}</DialogPrimitive.Description>
          <div className="relative flex max-h-full w-full max-w-[1600px] flex-1 items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- full-resolution view, no resizing wanted */}
            <img
              src={active.src}
              alt={active.alt}
              className="max-h-[calc(100vh-7rem)] max-w-full rounded-lg object-contain shadow-2xl"
            />
          </div>
          <div className="mt-3 flex w-full max-w-[1600px] items-center justify-between gap-3 text-white">
            <p className="truncate text-sm font-medium">{active.title}</p>
            <p className="shrink-0 text-xs text-white/60">
              {current + 1} / {shots.length}
            </p>
          </div>
          {shots.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => step(-1)}
                className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20 sm:left-4"
                aria-label="Previous screenshot"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20 sm:right-4"
                aria-label="Next screenshot"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          )}
          <DialogPrimitive.Close
            className="absolute top-3 right-3 rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20 sm:top-5 sm:right-5"
            aria-label="Close"
          >
            <XIcon className="h-5 w-5" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
