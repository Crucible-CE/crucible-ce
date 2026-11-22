// Side-effect imports that register job handlers and feature crons. One line
// per feature module. Each imported module calls registerRuntimeJob(kind,
// handler) or registerCron(...).
//
// CE has no grading or generation jobs: every grade is a person's.

import "@/lib/exercise/improvement/cron";
import "@/lib/exercise/readiness/cron";

export {};
