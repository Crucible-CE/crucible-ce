// @vitest-environment node
import { describe, it, expect } from "vitest";
import { assertSafeWebhookUrl, guardedLookup, isBlockedAddress, SsrfBlockedError } from "./ssrf";

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1", "127.8.8.8", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1",
    "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255",
    "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254", "64:ff9b::a9fe:a9fe",
    "[::1]", "not-an-ip",
  ])("blocks %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "93.184.216.34", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("allows %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });

  // #11: IPv6 transition ranges are blocked WHOLE, even when the embedded
  // IPv4 is public (a relay/gateway would forward anywhere).
  it.each([
    // ::/96 IPv4-compatible
    "::127.0.0.1", "::7f00:1", "::8.8.8.8", "::808:808", "0:0:0:0:0:0:a9fe:a9fe",
    // 6to4 2002::/16
    "2002:7f00:1::", "2002:a9fe:a9fe::1", "2002:808:808::1", "2002::",
    // Teredo 2001::/32
    "2001::1", "2001:0:4136:e378:8000:63bf:3fff:fdd2", "2001:0:ffff::",
    // NAT64 64:ff9b::/96 and 64:ff9b:1::/48
    "64:ff9b::808:808", "64:ff9b::8.8.8.8", "64:ff9b::7f00:1", "64:ff9b:1::1", "64:ff9b:1:ffff::a9fe:a9fe",
    // IPv4-mapped, full spelling
    "0:0:0:0:0:ffff:7f00:1",
    // IPv4-translated ::ffff:0:0:0/96
    "::ffff:0:7f00:1",
  ])("blocks transition address %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each(["2001:4860:4860::8888", "2001:1::1", "2003::1", "64:ff9b:2::1"])("still allows public neighbour %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });

  it("refuses transition-range IP literals in webhook URLs", () => {
    expect(() => assertSafeWebhookUrl("https://[2002:a9fe:a9fe::1]/hook", false)).toThrow(SsrfBlockedError);
    expect(() => assertSafeWebhookUrl("https://[64:ff9b::a9fe:a9fe]/hook", false)).toThrow(SsrfBlockedError);
    expect(() => assertSafeWebhookUrl("https://[2001::1]/hook", false)).toThrow(SsrfBlockedError);
  });
});

describe("assertSafeWebhookUrl", () => {
  it("allows public http(s) URLs", () => {
    expect(assertSafeWebhookUrl("https://hooks.example.com/x", false).host).toBe("hooks.example.com");
    expect(assertSafeWebhookUrl("http://8.8.8.8/x", false).hostname).toBe("8.8.8.8");
  });

  it("rejects bad schemes, private IP literals and localhost", () => {
    expect(() => assertSafeWebhookUrl("file:///etc/passwd", false)).toThrow(SsrfBlockedError);
    expect(() => assertSafeWebhookUrl("gopher://x", false)).toThrow(SsrfBlockedError);
    expect(() => assertSafeWebhookUrl("not a url", false)).toThrow(SsrfBlockedError);
    expect(() => assertSafeWebhookUrl("http://169.254.169.254/latest/meta-data", false)).toThrow(/private/);
    expect(() => assertSafeWebhookUrl("http://[::1]:8080/", false)).toThrow(SsrfBlockedError);
    expect(() => assertSafeWebhookUrl("http://localhost:3000/", false)).toThrow(/localhost/);
  });

  it("DELIVERY_WEBHOOK_ALLOW_PRIVATE lets private targets through (local testing)", () => {
    expect(assertSafeWebhookUrl("http://127.0.0.1:9999/hook", true).port).toBe("9999");
    expect(() => assertSafeWebhookUrl("ftp://127.0.0.1/", true)).toThrow(SsrfBlockedError);
  });
});

describe("guardedLookup (connect-time DNS check, defeats rebinding)", () => {
  const resolverFor = (addresses: { address: string; family: number }[]) =>
    ((_h: string, _o: unknown, cb: (e: null, a: typeof addresses) => void) => cb(null, addresses)) as never;

  const run = (lookup: ReturnType<typeof guardedLookup>, all: boolean) =>
    new Promise<{ err: Error | null; address: unknown }>((resolve) =>
      lookup("hooks.example.com", { all }, (err, address) => resolve({ err, address })),
    );

  it("passes public answers through (single and all)", async () => {
    const lookup = guardedLookup(false, resolverFor([{ address: "93.184.216.34", family: 4 }]));
    expect(await run(lookup, false)).toEqual({ err: null, address: "93.184.216.34" });
    expect((await run(lookup, true)).address).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });

  it("refuses when ANY resolved address is private", async () => {
    const lookup = guardedLookup(false, resolverFor([{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.7", family: 4 }]));
    const r = await run(lookup, true);
    expect(r.err).toBeInstanceOf(SsrfBlockedError);
    expect(r.err?.message).toContain("10.0.0.7");
  });

  it("allowPrivate skips the check", async () => {
    const lookup = guardedLookup(true, resolverFor([{ address: "127.0.0.1", family: 4 }]));
    expect((await run(lookup, false)).address).toBe("127.0.0.1");
  });
});
