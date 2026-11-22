// 10. Case-file export: generate (signing key configured), download the .cxz,
// verify it with the bundled verifier (`npm run verify-export`) against the
// pinned public key generated for this run.
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import path from "node:path";
import { expect, test } from "./support/fixtures";
import { ROOT, STATE_DIR } from "./stack";
import { expectJson, go, need, toast } from "./support/helpers";

test("generate a signed case file, download the .cxz, verify-export PASS with the pinned key", async ({ as }) => {
  const id = need("incidentId");
  const { page } = await as("admin");

  const status = await expectJson<{ signingConfigured: boolean }>(await page.request.get(`/api/incidents/${id}/export`), 200);
  expect(status.signingConfigured).toBe(true);

  await go(page, `/incidents/${id}/case-file`);
  await expect(page.getByRole("heading", { name: "Case file", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Generate & seal" }).click();
  await expect(toast(page, "Case file sealed")).toBeVisible();
  await expect(page.getByText("Decryption passphrase (shown once)")).toBeVisible();
  const passphrase = (await page.locator("code").filter({ hasText: /^[A-Z0-9]{5}(-[A-Z0-9]{5}){3}$/ }).first().textContent())!.trim();
  expect(passphrase).toMatch(/^[A-Z0-9]{5}(-[A-Z0-9]{5}){3}$/);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: /Download encrypted package \(\.cxz\)/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^casefile-[a-z0-9]{8}-\d{4}-\d{2}-\d{2}\.cxz$/);
  const cxz = path.join(STATE_DIR, download.suggestedFilename());
  await download.saveAs(cxz);

  // The recipient-side verifier, exactly as documented (npm run verify-export).
  // One command string through the shell, because npm is npm.cmd on Windows.
  const verify = (publicKey: string) =>
    spawnSync(`npm run --silent verify-export -- "${cxz}" --public-key "${publicKey}"`, {
      cwd: ROOT,
      env: { ...process.env, CXZ_PASSPHRASE: passphrase },
      encoding: "utf8",
      shell: true,
      timeout: 120_000,
    });
  const run = verify(path.join(STATE_DIR, "export-signing.pub.pem"));
  const out = `${run.stdout}\n${run.stderr}`;
  expect(run.status, out).toBe(0);
  expect(out).toContain("Case-file verification: PASS");
  expect(out).not.toContain("[FAIL]");
  expect(out).not.toContain("UNTRUSTED");

  // Pinned to a key that is not the sender's, the same package must fail.
  const otherPub = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
  const wrong = verify(Buffer.from(otherPub).toString("base64"));
  expect(wrong.status, `${wrong.stdout}\n${wrong.stderr}`).not.toBe(0);
});
