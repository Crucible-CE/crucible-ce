// The built-in exercise library: capabilities (FEMA, NIST CSF 2.0), the core
// Crisis Sim and Strategic TTX templates, and library collections
// (src/lib/exercise/library/<collection>) with their own templates and
// playbook documents.
//
// Seeded once the install has an organization (after first-run setup): at
// boot, after setup, and lazily from the template and document pages.
// Idempotent. Library templates and library documents are read-only copies;
// teams duplicate them to edit.

import { db, type DbClient } from "@/lib/db";
import type { PrismaClient } from "@prisma/client";
import { installOrgId } from "./settings";
import { seedCapabilities } from "./seed-capabilities";
import { CRISISSIM_SEED_TEMPLATES, type SeedTemplate } from "./templates/crisissim-seed-data";
import { seedCrisisSimTemplates } from "./templates/crisissim-seed";
import { STRATEGIC_SEED_TEMPLATES, type StrategicSeedTemplate } from "./strategic/seed-data";
import { seedStrategicTemplates } from "./strategic/seed";
import { seedLibraryDocuments } from "./library/documents";
import { GENERAL_COLLECTION } from "./library/general";
import { HEALTHCARE_COLLECTION } from "./library/healthcare";
import type { LibraryCollection, LibraryPlaybook } from "./library/types";

/** Library collections, in display order. */
export const LIBRARY_COLLECTIONS: readonly LibraryCollection[] = [HEALTHCARE_COLLECTION, GENERAL_COLLECTION];

/** Every Crisis Sim library template: the core ones, then each collection's. */
export const LIBRARY_CRISISSIM_TEMPLATES: readonly SeedTemplate[] = [...CRISISSIM_SEED_TEMPLATES, ...LIBRARY_COLLECTIONS.flatMap((c) => c.crisisSim)];

/** Every Strategic TTX library template: the core ones, then each collection's. */
export const LIBRARY_STRATEGIC_TEMPLATES: readonly StrategicSeedTemplate[] = [
  ...STRATEGIC_SEED_TEMPLATES,
  ...LIBRARY_COLLECTIONS.flatMap((c) => c.strategic),
];

/** Every library playbook document. */
export const LIBRARY_PLAYBOOKS: readonly LibraryPlaybook[] = LIBRARY_COLLECTIONS.flatMap((c) => c.playbooks);

export const LIBRARY_TEMPLATE_IDS: readonly string[] = [...LIBRARY_CRISISSIM_TEMPLATES.map((t) => t.id), ...LIBRARY_STRATEGIC_TEMPLATES.map((t) => t.id)];

const g = globalThis as typeof globalThis & { __ceExerciseLibrary?: Promise<boolean> };

async function seedIfMissing(client: PrismaClient): Promise<boolean> {
  if (!(await installOrgId(client))) return false;
  if ((await client.capability.count()) === 0) await seedCapabilities(client);
  const present = await client.exerciseTemplate.count({ where: { id: { in: [...LIBRARY_TEMPLATE_IDS] } } });
  if (present < LIBRARY_TEMPLATE_IDS.length) {
    await seedCrisisSimTemplates(client, LIBRARY_CRISISSIM_TEMPLATES);
    await seedStrategicTemplates(client, LIBRARY_STRATEGIC_TEMPLATES);
  }
  await seedLibraryDocuments(client, LIBRARY_PLAYBOOKS);
  return true;
}

/** Make sure the library is in the database. Resolves false before setup. Never throws. */
export async function ensureExerciseLibrary(client: DbClient = db): Promise<boolean> {
  if (!g.__ceExerciseLibrary) {
    g.__ceExerciseLibrary = seedIfMissing(client as PrismaClient).catch((err) => {
      console.error("[exercises] library seed failed:", err instanceof Error ? err.message : err);
      return false;
    });
  }
  const ok = await g.__ceExerciseLibrary;
  // Before setup there is nothing to seed into; try again on the next call.
  if (!ok) delete g.__ceExerciseLibrary;
  return ok;
}
