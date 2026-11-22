// Compiles the library playbooks (src/lib/exercise/library/*/playbooks/*.md)
// into src/lib/exercise/library/playbooks.generated.ts, a plain TS string
// module, so the server (tsx), next build and tests all load them without a
// Markdown loader. Run after editing a playbook:
//
//   npm run library:playbooks
//
// library.test.ts fails when the generated module is out of date.

import { writeFileSync } from "node:fs";
import path from "node:path";
import { GENERATED_PATH, renderPlaybookModule } from "../src/lib/exercise/library/playbook-files";

const out = renderPlaybookModule();
writeFileSync(path.resolve(GENERATED_PATH), out, "utf8");
console.log(`[library] wrote ${GENERATED_PATH}`);
