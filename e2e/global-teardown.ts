import { down } from "./stack";

export default async function globalTeardown(): Promise<void> {
  if (process.env.E2E_EXTERNAL_STACK === "1" || process.env.E2E_KEEP_STACK === "1") return;
  down();
}
