"use client";

// Links from an ended exercise to its after-action work: hotwash, the
// after-action report and participant feedback. The hotwash and the report are
// for the control team; feedback is for every participant, guests too.

import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export function AfterActionLinks({ exerciseId, isPractice, isParticipant, isControl }: { exerciseId: string; isPractice: boolean; isParticipant: boolean; isControl: boolean }) {
  if (!isControl && !isParticipant) return null;
  return (
    <div className="flex flex-wrap gap-2" data-testid="after-action-links">
      {isControl && (
        <Link href={`/exercises/${exerciseId}/hotwash`} className={buttonVariants({ size: "sm" })}>
          Hotwash
        </Link>
      )}
      {isControl && !isPractice && (
        <Link href={`/exercises/${exerciseId}/aar`} className={buttonVariants({ size: "sm", variant: "outline" })}>
          After-action report
        </Link>
      )}
      {isParticipant && (
        <Link href={`/play/${exerciseId}/feedback`} className={buttonVariants({ size: "sm", variant: "ghost" })}>
          Give feedback
        </Link>
      )}
    </div>
  );
}

export function PlayerFeedbackLink({ exerciseId }: { exerciseId: string }) {
  return (
    <Link href={`/play/${exerciseId}/feedback`} className={buttonVariants({ size: "sm" })}>
      Give feedback
    </Link>
  );
}
