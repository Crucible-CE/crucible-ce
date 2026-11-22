"use client";

// Strategic TTX mode UI. Props only: no socket or database imports.
//   PlayerView   shared update, the team's own variant, the answer composer, history
//   ControlView  held inject editing, team variants, answers, grades, contingency, SimCell
//   DebriefView  answers and ratings per update, outcomes over time, strengths and AFIs

import type { ModeUi } from "@/lib/exercise/modes/ui";
import { ControlView } from "./control";
import { DebriefView } from "./debrief";
import { PlayerView } from "./player";

export const ui: ModeUi = {
  PlayerView,
  ControlView,
  DebriefView,
};
