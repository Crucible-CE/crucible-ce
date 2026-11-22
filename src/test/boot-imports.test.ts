// @vitest-environment node
// The server boot path (src/lib/exercise/runtime/boot.ts) runs before Next is
// ready. Anything it imports that loads next/* (for example next/server)
// crashes the production server on its first request. Keep it free of them.

import { describe, expect, it } from "vitest";
import { build } from "esbuild";
import path from "node:path";

describe("server boot imports", () => {
  it("does not reach next/* from the runtime boot module", async () => {
    const root = path.resolve(__dirname, "../..");
    const result = await build({
      entryPoints: [path.join(root, "src/lib/exercise/runtime/boot.ts")],
      bundle: true,
      platform: "node",
      format: "esm",
      packages: "external",
      metafile: true,
      write: false,
      logLevel: "silent",
      absWorkingDir: root,
      tsconfig: path.join(root, "tsconfig.json"),
    });
    const offenders: string[] = [];
    for (const [file, input] of Object.entries(result.metafile.inputs)) {
      for (const imp of input.imports) {
        if (/^next(\/|$)/.test(imp.path)) offenders.push(`${file} -> ${imp.path}`);
      }
    }
    expect(offenders).toEqual([]);
  }, 60_000);
});
