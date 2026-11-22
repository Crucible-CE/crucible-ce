"use client";

// Crisis Sim mode UI. Props only: no socket or database imports.
//   PlayerView   executive layout for tablet and phone
//   ControlView  facilitator console with live score and hidden quality
//   DebriefView  path arc and the decisions that moved it, after ENDEX

import type { ModeUi } from "@/lib/exercise/modes/ui";
import { ControlView } from "./control";
import { DebriefView } from "./debrief";
import { PlayerView } from "./player";

export const ui: ModeUi = {
  PlayerView,
  ControlView,
  DebriefView,
};
