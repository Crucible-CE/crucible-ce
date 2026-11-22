// Library collections: Crisis Sim templates, Strategic TTX templates and
// playbook documents shipped with CE, grouped under one collection label.
// Pure types. The registry is src/lib/exercise/library.ts.
//
// Templates reuse the seed types of their mode, with the collection label
// required. Playbooks are Markdown files under <collection>/playbooks/*.md,
// compiled into playbooks.generated.ts by `npm run library:playbooks`.

import type { DocumentKind } from "@/lib/exercise/documents/kinds";
import type { SeedTemplate } from "@/lib/exercise/templates/crisissim-seed-data";
import type { StrategicSeedTemplate } from "@/lib/exercise/strategic/seed-data";

/** A Crisis Sim library template in a collection. */
export type LibraryCrisisSimTemplate = SeedTemplate & { collection: string };

/** A Strategic TTX library template in a collection. */
export type LibraryStrategicTemplate = StrategicSeedTemplate & { collection: string };

/** A playbook or plan seeded into the document library as a read-only library document. */
export interface LibraryPlaybook {
  /** Stable key. Seeding upserts by it, so never change it once shipped. */
  libraryKey: string;
  title: string;
  kind: DocumentKind;
  collection: string;
  /** Path of the Markdown file relative to src/lib/exercise/library, for example "healthcare/playbooks/storm-0501.md". */
  file: string;
}

/** One collection's content. Every list may be empty. */
export interface LibraryCollection {
  /** Label shown on Templates and Documents, for example "Healthcare data analytics on Azure". */
  label: string;
  crisisSim: readonly LibraryCrisisSimTemplate[];
  strategic: readonly LibraryStrategicTemplate[];
  playbooks: readonly LibraryPlaybook[];
}
