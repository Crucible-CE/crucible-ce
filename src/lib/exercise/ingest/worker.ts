// Runs PDF and DOCX parsing in a worker_thread with a heap cap and a
// wall-clock timeout, so a hostile file cannot take the server down.
//
// The worker body is plain JavaScript evaluated with `eval: true`. That keeps
// it independent of the bundler: it works the same under the custom server
// (tsx), inside Next route handlers, and in vitest. pdfjs-dist and mammoth are
// resolved from the project root and are never bundled.

import { Worker } from "node:worker_threads";
import { INGEST_LIMITS, IngestError } from "./limits";

export type WorkerTask = "pdf" | "docx";

export interface WorkerResult {
  text: string;
  pages?: number;
}

const WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require("node:worker_threads");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

const req = createRequire(path.join(workerData.cwd, "package.json"));

function fail(code, detail) {
  parentPort.postMessage({ ok: false, code, detail: String(detail || "").slice(0, 500) });
}

// pdfjs-dist 5 requires the native @napi-rs/canvas addon at import time for
// rendering polyfills. A native addon loaded in a worker thread segfaults the
// whole process when the worker is torn down (seen on Node 24). Text
// extraction never renders, so block the addon in this worker's module loader
// and give pdfjs inert stand-ins for the three classes it touches at load.
function disableNativeCanvas() {
  const Module = require("node:module");
  const load = Module._load;
  Module._load = function (request, ...rest) {
    if (String(request).startsWith("@napi-rs/canvas")) throw new Error("native canvas is disabled in the ingest worker");
    return load.call(this, request, ...rest);
  };
  globalThis.DOMMatrix = class DOMMatrix {
    constructor() { this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0; }
  };
  globalThis.ImageData = class ImageData {};
  globalThis.Path2D = class Path2D {};
}

async function parsePdf(bytes, maxPages) {
  disableNativeCanvas();
  const pdfjs = await import(pathToFileURL(req.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href);
  if (!globalThis.pdfjsWorker) {
    globalThis.pdfjsWorker = await import(pathToFileURL(req.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs")).href);
  }
  const task = pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    return fail("malformed", e && e.message);
  }
  if (doc.numPages > maxPages) {
    await task.destroy();
    return fail("too_many_pages", doc.numPages);
  }
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let s = "";
    for (const item of content.items) {
      if (typeof item.str === "string") {
        s += item.str;
        if (item.hasEOL) s += "\n";
      }
    }
    pages.push(s.trim());
    page.cleanup();
  }
  const numPages = doc.numPages;
  await task.destroy();
  parentPort.postMessage({ ok: true, text: pages.join("\n\n"), pages: numPages });
}

async function parseDocx(bytes) {
  const mammoth = req("mammoth");
  let result;
  try {
    result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  } catch (e) {
    return fail("malformed", e && e.message);
  }
  parentPort.postMessage({ ok: true, text: result.value });
}

(async () => {
  try {
    const bytes = new Uint8Array(workerData.bytes);
    if (workerData.task === "pdf") await parsePdf(bytes, workerData.maxPages);
    else if (workerData.task === "docx") await parseDocx(bytes);
    else fail("unsupported", workerData.task);
  } catch (e) {
    fail("worker_failed", e && e.message);
  }
})();
`;

type WorkerMessage = { ok: true; text: string; pages?: number } | { ok: false; code: string; detail?: string };

const KNOWN_CODES = new Set(["timeout", "too_large", "too_many_pages", "zip_bomb", "malformed", "unsupported", "worker_failed"]);

/** Parse `bytes` in a resource-limited worker. Rejects with IngestError. */
export function runIngestWorker(
  task: WorkerTask,
  bytes: Uint8Array,
  opts: { timeoutMs?: number; maxPages?: number } = {},
): Promise<WorkerResult> {
  const timeoutMs = opts.timeoutMs ?? INGEST_LIMITS.timeoutMs;
  // Copy into a fresh buffer we can transfer (the caller's view may be shared).
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);

  return new Promise<WorkerResult>((resolve, reject) => {
    let settled = false;
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { task, bytes: copy.buffer, maxPages: opts.maxPages ?? INGEST_LIMITS.pdfMaxPages, cwd: process.cwd() },
      transferList: [copy.buffer],
      resourceLimits: {
        maxOldGenerationSizeMb: INGEST_LIMITS.workerMaxOldGenerationMb,
        maxYoungGenerationSizeMb: INGEST_LIMITS.workerMaxYoungGenerationMb,
        stackSizeMb: 4,
      },
      stdout: true,
      stderr: true,
    });
    // Drain the worker's stdio so library chatter never reaches the server log.
    worker.stdout.resume();
    worker.stderr.resume();

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate().catch(() => {});
      fn();
    };

    const timer = setTimeout(() => finish(() => reject(new IngestError("timeout"))), timeoutMs);

    worker.on("message", (msg: WorkerMessage) => {
      if (msg.ok) finish(() => resolve({ text: msg.text, pages: msg.pages }));
      else {
        const code = KNOWN_CODES.has(msg.code) ? (msg.code as ConstructorParameters<typeof IngestError>[0]) : "worker_failed";
        finish(() => reject(new IngestError(code, msg.detail)));
      }
    });
    worker.on("error", (err: Error & { code?: string }) => {
      const code = err.code === "ERR_WORKER_OUT_OF_MEMORY" ? "too_large" : "worker_failed";
      finish(() => reject(new IngestError(code, err.message)));
    });
    worker.on("exit", (exitCode) => {
      finish(() => reject(new IngestError("worker_failed", `worker exited with code ${exitCode}`)));
    });
  });
}
