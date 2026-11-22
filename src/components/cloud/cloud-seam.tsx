"use client";

// A Cloud note: one quiet line next to a manual step that Crucible Cloud does
// with AI. Never a control, never a disabled button. Renders nothing without
// the platform provider (players, guests, presenter and projector views), for
// readers, when the organization turned notes off, or once the user dismissed
// it. Never used in exports or emails (those are not React pages).

import Link from "next/link";
import { Cloud, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { CLOUD_NOTES, cloudNoteLink, type CloudNoteKey } from "@/lib/cloud/notes";
import { useCloudNotes } from "./cloud-notes-provider";

export function CloudSeam({ feature, className }: { feature: CloudNoteKey; className?: string }) {
  const notes = useCloudNotes();
  if (!notes?.enabled || notes.isDismissed(feature)) return null;
  const link = cloudNoteLink(feature, notes.trial);
  return (
    <p
      className={cn("flex items-center gap-1.5 text-[12px] leading-snug text-[color:var(--color-muted-foreground)]", className)}
      data-testid="cloud-note"
      data-note={feature}
    >
      <Cloud className="size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0">
        {CLOUD_NOTES[feature].text}{" "}
        <Link href={link.href} className="font-medium text-[color:var(--mist-indigo)] underline-offset-4 hover:underline">
          {link.label}
        </Link>
      </span>
      <button
        type="button"
        onClick={() => notes.dismiss(feature)}
        className="ml-auto shrink-0 rounded p-0.5 hover:bg-[color:var(--color-muted)] hover:text-[color:var(--color-foreground)]"
        aria-label="Dismiss this note"
        title="Dismiss"
      >
        <X className="size-3" aria-hidden />
      </button>
    </p>
  );
}
