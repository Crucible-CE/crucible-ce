// Side-effect module: registers the action item reminder cron at boot.
// Imported from src/runtime/jobs/handler-modules.ts.
import { registerReminderCron } from "./reminders";

registerReminderCron();

export {};
