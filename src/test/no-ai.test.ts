// @vitest-environment node
//
// Crucible CE ships no AI. This guard fails the build when any source file
// imports an AI module or SDK, when any file reads an AI setting from the
// environment, or when package.json pulls in an AI SDK. Cloud keeps the AI.

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");
const SELF = path.resolve(__filename);

/** Directories and files to scan, relative to the repo root. */
const SCAN = ["src", "scripts", "prisma", "e2e", "providers", "docs", "server.ts", "server-socket.ts", "load-env.ts", "next.config.mjs", "Dockerfile", "docker-compose.yml", "docker-compose.dev.yml", "docker-entrypoint.sh", ".env.example", ".env.docker.example", "README.md"];
const SKIP_DIRS = new Set(["node_modules", ".next", "migrations", "test-results", "playwright-report", ".state"]);
const TEXT = /\.(ts|tsx|js|mjs|cjs|json|md|sh|yml|yaml|example)$|Dockerfile$/;

function files(rel: string): string[] {
  const full = path.join(ROOT, rel);
  let st;
  try {
    st = statSync(full);
  } catch {
    return [];
  }
  if (st.isFile()) return [full];
  const out: string[] = [];
  for (const name of readdirSync(full)) {
    if (SKIP_DIRS.has(name)) continue;
    const child = path.join(full, name);
    if (statSync(child).isDirectory()) out.push(...files(path.relative(ROOT, child)));
    else if (TEXT.test(name)) out.push(child);
  }
  return out;
}

const SOURCE = /\.(ts|tsx|js|mjs|cjs)$/;

/** Module specifiers that are AI code: an ai/ module of this repo, or an AI SDK. */
export function isAiSpecifier(spec: string): boolean {
  if (/^(@\/|\.{1,2}\/)(.*\/)?ai(\/|$)/.test(spec)) return true;
  return /^(openai|@anthropic-ai\/|@ai-sdk\/|ai$|langchain|@langchain\/|ollama|@google\/generative-ai|@mistralai\/|cohere-ai)/.test(spec);
}

const SPECIFIER = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|vi\.mock\s*\(\s*|import\s+)["'`]([^"'`]+)["'`]/g;

/** Environment settings an AI client reads. */
const AI_ENV = /\b(AI_BASE_URL|AI_API_KEY|AI_PROVIDER|AI_MODEL(?:_[A-Z_]+)?|OPENAI_API_KEY|OPENAI_BASE_URL|ANTHROPIC_API_KEY|AZURE_OPENAI_[A-Z_]+|OPENROUTER_API_KEY)\b/;

describe("no AI in Crucible CE", () => {
  const all = SCAN.flatMap(files).filter((f) => path.resolve(f) !== SELF);

  it("scans the source tree", () => {
    expect(all.length).toBeGreaterThan(100);
  });

  it("recognizes AI imports", () => {
    expect(isAiSpecifier("@/ai/port")).toBe(true);
    expect(isAiSpecifier("@/lib/ai/client")).toBe(true);
    expect(isAiSpecifier("../ai")).toBe(true);
    expect(isAiSpecifier("openai")).toBe(true);
    expect(isAiSpecifier("@anthropic-ai/sdk")).toBe(true);
    expect(isAiSpecifier("@/lib/exercise/modes/registry")).toBe(false);
    expect(isAiSpecifier("@/lib/auth")).toBe(false);
  });

  it("no file imports an AI module or SDK", () => {
    const hits: string[] = [];
    for (const f of all.filter((x) => SOURCE.test(x))) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(SPECIFIER)) {
        if (isAiSpecifier(m[1])) hits.push(`${path.relative(ROOT, f)}: ${m[1]}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("no file reads an AI setting from the environment", () => {
    const hits = all.filter((f) => AI_ENV.test(readFileSync(f, "utf8"))).map((f) => path.relative(ROOT, f));
    expect(hits).toEqual([]);
  });

  it("no src/**/ai directory exists", () => {
    const dirs = files("src")
      .map((f) => path.relative(ROOT, path.dirname(f)).split(path.sep))
      .filter((parts) => parts.includes("ai"));
    expect(dirs).toEqual([]);
  });

  it("package.json has no AI SDK", () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as Record<string, Record<string, string> | undefined>;
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps.filter((d) => isAiSpecifier(d))).toEqual([]);
  });
});
