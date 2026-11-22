// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadPlugins, validateProviderShape } from "./plugins";
import { safeSend } from "./safe-send";

let dir: string;
const write = (name: string, src: string) => fs.writeFileSync(path.join(dir, name), src);

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "crucible-plugins-"));
  // valid: object default export (ESM)
  write("a-object.mjs", `export default { id: "obj", displayName: "Object", channels: ["push"], isConfigured: () => true, async send() { return { status: "sent", providerRef: "r1" }; } };`);
  // valid: factory receiving { env, logger } (CJS)
  write("b-factory.cjs", `module.exports = ({ env, logger }) => { logger.info("init"); return { id: "factory", displayName: "Factory " + (env.PLUGIN_TEST_FLAG || ""), channels: ["custom"], isConfigured: () => Boolean(env.PLUGIN_TEST_FLAG), send: async () => ({ status: "skipped", error: "no addr" }) }; };`);
  // valid: async factory
  write("c-async.js", `export default async function () { return { id: "async-one", displayName: "Async", channels: ["webhook"], isConfigured: () => true, send: async () => ({ status: "sent" }) }; }`);
  // invalid shape
  write("d-badshape.mjs", `export default { id: "Bad Id!", displayName: "x", channels: ["push"], isConfigured() {}, send() {} };`);
  // throws at import
  write("e-throws.mjs", `throw new Error("boom at import");`);
  // factory throws
  write("f-factory-throws.mjs", `export default () => { throw new Error("factory exploded"); };`);
  // duplicate id
  write("g-dup.mjs", `export default { id: "obj", displayName: "Dup", channels: ["push"], isConfigured: () => true, send: async () => ({ status: "sent" }) };`);
  // reserved (built-in) id
  write("h-reserved.mjs", `export default { id: "smtp", displayName: "Fake SMTP", channels: ["email"], isConfigured: () => true, send: async () => ({ status: "sent" }) };`);
  // ignored files
  write("README.md", "# not a plugin");
  write("_disabled.mjs", `throw new Error("should never load");`);
  write(".hidden.mjs", `throw new Error("should never load");`);
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("plugin loader", () => {
  it("loads valid plugins, logs + skips broken ones, never throws", async () => {
    const log = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const report = await loadPlugins(dir, { env: { PLUGIN_TEST_FLAG: "on" } as unknown as NodeJS.ProcessEnv, reservedIds: new Set(["smtp"]), log });

    expect(report.loaded.map((p) => p.provider.id)).toEqual(["obj", "factory", "async-one"]);
    const factory = report.loaded.find((p) => p.provider.id === "factory")!.provider;
    expect(factory.displayName).toBe("Factory on");
    expect(factory.isConfigured()).toBe(true);

    const errors = Object.fromEntries(report.errors.map((e) => [path.basename(e.file), e.error]));
    expect(Object.keys(errors).sort()).toEqual(["d-badshape.mjs", "e-throws.mjs", "f-factory-throws.mjs", "g-dup.mjs", "h-reserved.mjs"]);
    expect(errors["d-badshape.mjs"]).toMatch(/invalid id/);
    expect(errors["e-throws.mjs"]).toMatch(/boom at import/);
    expect(errors["f-factory-throws.mjs"]).toMatch(/factory exploded/);
    expect(errors["g-dup.mjs"]).toMatch(/duplicate provider id "obj"/);
    expect(errors["h-reserved.mjs"]).toMatch(/duplicate provider id "smtp"/);
    expect(log.error).toHaveBeenCalledTimes(5);
    expect(log.log).toHaveBeenCalledWith(expect.stringContaining('loaded plugin provider "obj"'));
  });

  it("a missing directory is simply empty", async () => {
    const report = await loadPlugins(path.join(dir, "nope"));
    expect(report).toMatchObject({ loaded: [], errors: [] });
  });

  it("validateProviderShape explains what is wrong", () => {
    expect(validateProviderShape(null)).toMatch(/not an object/);
    expect(validateProviderShape({ id: "ok", displayName: "x", channels: [], isConfigured() {}, send() {} })).toMatch(/channels/);
    expect(validateProviderShape({ id: "ok", displayName: "x", channels: ["fax"], isConfigured() {}, send() {} })).toMatch(/unknown channel "fax"/);
    expect(validateProviderShape({ id: "ok", displayName: "x", channels: ["sms"], send() {} })).toMatch(/isConfigured/);
    expect(validateProviderShape({ id: "ok", displayName: "x", channels: ["sms"], isConfigured() {}, send() {} })).toBeNull();
  });
});

describe("safeSend (plugin isolation)", () => {
  const base = { id: "p", displayName: "P", channels: ["custom" as const], isConfigured: () => true };
  const m = { kind: "test" as const, id: "t", attempt: 1, incident: null, page: null, title: "t", text: "t", ackUrl: null, sentAt: new Date().toISOString() };

  it("converts throws, bad results and hangs into failed", async () => {
    expect(await safeSend({ ...base, send: async () => { throw new Error("nope"); } }, m, { name: "x" })).toEqual({ status: "failed", error: "nope" });
    expect(await safeSend({ ...base, send: async () => ({ status: "maybe" }) as never }, m, { name: "x" })).toEqual({ status: "failed", error: "provider returned an invalid result" });
    expect(await safeSend({ ...base, send: () => new Promise(() => {}) }, m, { name: "x" }, 20)).toEqual({ status: "failed", error: "provider timed out after 20ms" });
  });
});
