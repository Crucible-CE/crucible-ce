// User-pluggable delivery providers.
//
// Every top-level .js / .mjs / .cjs file in PROVIDERS_DIR (default
// ./providers relative to the working directory, i.e. /app/providers in the
// Docker image) is imported once per process. Its default export is either a
// DeliveryProvider object or a (sync/async) factory `({ env, logger,
// guardedPost }) => DeliveryProvider` (guardedPost: the SSRF-guarded sender,
// ./outbound-http). A file that fails to import, throws in its factory, or
// exports the wrong shape is logged and skipped; it never stops the boot.
//
// SECURITY: plugins run in-process with the app's full privileges (database
// credentials, MASTER_KEK, network). Only install code you trust.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DELIVERY_CHANNELS, type DeliveryProvider, type ProviderContext, type ProviderLogger } from "./types";
import { createPluginGuardedPost } from "./outbound-http";

export const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const PLUGIN_EXT = new Set([".js", ".mjs", ".cjs"]);

export interface LoadedPlugin {
  provider: DeliveryProvider;
  file: string;
}

export interface PluginLoadReport {
  dir: string;
  loaded: LoadedPlugin[];
  errors: { file: string; error: string }[];
}

export function providersDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(env.PROVIDERS_DIR?.trim() || path.join(process.cwd(), "providers"));
}

/** Returns an error string, or null when `p` satisfies the DeliveryProvider contract. */
export function validateProviderShape(p: unknown): string | null {
  if (!p || typeof p !== "object") return "default export is not an object (or a factory returning one)";
  const o = p as Record<string, unknown>;
  if (typeof o.id !== "string" || !PLUGIN_ID_RE.test(o.id)) return `invalid id ${JSON.stringify(o.id)} (lowercase a-z 0-9 . _ -, max 64)`;
  if (typeof o.displayName !== "string" || !o.displayName.trim()) return "displayName must be a non-empty string";
  if (!Array.isArray(o.channels) || o.channels.length === 0) return "channels must be a non-empty array";
  for (const c of o.channels) {
    if (!(DELIVERY_CHANNELS as readonly unknown[]).includes(c)) return `unknown channel ${JSON.stringify(c)} (allowed: ${DELIVERY_CHANNELS.join(", ")})`;
  }
  if (typeof o.isConfigured !== "function") return "isConfigured must be a function";
  if (typeof o.send !== "function") return "send must be a function";
  return null;
}

export function pluginLogger(id: string, base: Pick<Console, "log" | "warn" | "error"> = console): ProviderLogger {
  const prefix = `[provider:${id}]`;
  return {
    info: (...a) => base.log(prefix, ...a),
    warn: (...a) => base.warn(prefix, ...a),
    error: (...a) => base.error(prefix, ...a),
  };
}

// Native import() that bundlers (webpack/turbopack) never try to resolve:
// plugins are runtime files, not part of the build. Inside a vm context
// without a dynamic-import hook (vitest), fall back to a plain import().
const viaFunction = new Function("specifier", "return import(specifier)") as (s: string) => Promise<Record<string, unknown>>;
async function nativeImport(specifier: string): Promise<Record<string, unknown>> {
  try {
    return await viaFunction(specifier);
  } catch (e) {
    if (!/dynamic import callback/i.test(e instanceof Error ? e.message : "")) throw e;
    return (await import(/* webpackIgnore: true */ /* @vite-ignore */ specifier)) as Record<string, unknown>;
  }
}

/** Load one plugin file. Throws with a readable message on any problem. */
export async function loadPluginFile(file: string, env: NodeJS.ProcessEnv = process.env): Promise<DeliveryProvider> {
  const mod = await nativeImport(pathToFileURL(file).href);
  // ESM default export, or CJS module.exports (surfaced as default by Node).
  let exported: unknown = mod.default ?? mod;
  if (exported && typeof exported === "object" && "default" in exported && Object.keys(exported).length === 1) {
    exported = (exported as { default: unknown }).default; // CJS `exports.default = ...`
  }
  const base = path.basename(file).replace(/\.[^.]+$/, "");
  let candidate: unknown = exported;
  if (typeof exported === "function") {
    const ctx: ProviderContext = { env, logger: pluginLogger(base), guardedPost: createPluginGuardedPost(env) };
    candidate = await (exported as (c: ProviderContext) => unknown)(ctx);
  }
  const problem = validateProviderShape(candidate);
  if (problem) throw new Error(problem);
  return candidate as DeliveryProvider;
}

export async function loadPlugins(
  dir: string = providersDir(),
  opts: { env?: NodeJS.ProcessEnv; reservedIds?: Set<string>; log?: Pick<Console, "log" | "warn" | "error"> } = {},
): Promise<PluginLoadReport> {
  const log = opts.log ?? console;
  const report: PluginLoadReport = { dir, loaded: [], errors: [] };
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return report; // no providers directory: nothing to load
  }
  const seen = new Set(opts.reservedIds ?? []);
  for (const name of entries.sort()) {
    if (name.startsWith(".") || name.startsWith("_")) continue;
    if (!PLUGIN_EXT.has(path.extname(name).toLowerCase())) continue;
    const file = path.join(dir, name);
    try {
      if (!fs.statSync(file).isFile()) continue;
      const provider = await loadPluginFile(file, opts.env ?? process.env);
      if (seen.has(provider.id)) throw new Error(`duplicate provider id "${provider.id}"`);
      seen.add(provider.id);
      report.loaded.push({ provider, file });
      log.log(`[delivery] loaded plugin provider "${provider.id}" (${provider.channels.join(", ")}) from ${name}`);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      report.errors.push({ file, error });
      log.error(`[delivery] skipped plugin ${name}: ${error}`);
    }
  }
  return report;
}
