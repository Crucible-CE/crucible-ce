"use client";

// Document TTX mode UI. Props only: no socket or database imports.
//   PlayerView   current module, entry composer, entries, earlier modules
//   ControlView  module with expected actions, moderation, grades, presenter link
//   DebriefView  per module entries, answered questions, grade summaries

import type { ModeUi } from "@/lib/exercise/modes/ui";
import { ControlView } from "./control";
import { DebriefView } from "./debrief";
import { PlayerView } from "./player";

export const ui: ModeUi = {
  PlayerView,
  ControlView,
  DebriefView,
};
