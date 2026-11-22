"use client";

// Mode UI registry (client). The exercise shell (src/components/exercise)
// renders header, clocks, chat, feed, roster, MSEL and observations, and puts
// the mode's view in the main area. Mode UI gets everything through props and
// never imports @/socket or @/db.

import type * as React from "react";
import type { Mode, ResponseKind } from "@/lib/exercise/runtime/types";
import { ui as crisisSimUi } from "@/lib/exercise/modes/crisissim/ui";
import { ui as documentUi } from "@/lib/exercise/modes/document/ui";
import { ui as strategicUi } from "@/lib/exercise/modes/strategic/ui";

export interface ModeViewProps {
  exerciseId: string;
  /** projectFor output for this viewer. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state: any;
  isGuest: boolean;
  respond(injectId: string, kind: ResponseKind, data: unknown): Promise<{ ok: boolean; error?: string }>;
  act(action: string, body?: Record<string, unknown>): Promise<{ ok: boolean; error?: string }>;
  refresh(): void;
}

export interface ModeUi {
  /** Main area for players and observers. */
  PlayerView: React.ComponentType<ModeViewProps>;
  /** Main area of the control room. */
  ControlView: React.ComponentType<ModeViewProps>;
  /** Shown after ENDEX. */
  DebriefView?: React.ComponentType<ModeViewProps>;
}

export const MODE_UI: Partial<Record<Mode, ModeUi>> = {
  crisissim: crisisSimUi,
  document: documentUi,
  strategic: strategicUi,
};
