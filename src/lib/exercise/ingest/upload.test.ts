// @vitest-environment node
import { describe, expect, it } from "vitest";
import { makeDocm, makeDocx, makePdf } from "@/test/fixtures";
import { UPLOAD_LIMITS, isUtf8Text, readUpload, sniffUpload } from "./upload";

function multipart(file: { name: string; type: string; bytes: Uint8Array }, extra: Record<string, string> = {}) {
  const boundary = "----ttxtest" + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(extra)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`),
    Buffer.from(file.bytes),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

function req(body: Uint8Array | ReadableStream<Uint8Array>, headers: Record<string, string>) {
  return new Request("http://x/api/upload", { method: "POST", body: body as BodyInit, headers, duplex: "half" } as RequestInit);
}

describe("sniffUpload", () => {
  it("detects PDF, DOCX, text and markdown from the bytes, and reads VTT as text", async () => {
    expect(sniffUpload(makePdf(["x"]), "document", "a.bin")).toMatchObject({ ok: true, format: "pdf" });
    expect(sniffUpload(await makeDocx(["hi"]), "document", "a.docx")).toMatchObject({ ok: true, format: "docx" });
    expect(sniffUpload(Buffer.from("WEBVTT\n\n00:00.000 --> 00:01.000\nhi"), "document")).toMatchObject({ ok: true, format: "txt" });
    expect(sniffUpload(Buffer.from("﻿WEBVTT\n"), "document")).toMatchObject({ ok: true, format: "txt" });
    expect(sniffUpload(Buffer.from("# Plan\nText"), "document", "plan.md")).toMatchObject({ ok: true, format: "md" });
    expect(sniffUpload(Buffer.from("plain"), "document", "notes.txt")).toMatchObject({ ok: true, format: "txt" });
  });

  it("ignores the client's claimed type: an HTML file named .pdf is text, a PDF named .txt is a PDF", () => {
    expect(sniffUpload(Buffer.from("<script>alert(1)</script>"), "document", "x.pdf", "application/pdf")).toMatchObject({ format: "txt", mime: "text/plain" });
    expect(sniffUpload(makePdf(["x"]), "document", "x.txt", "text/plain")).toMatchObject({ format: "pdf" });
  });

  it("refuses macro documents (vbaProject, macroEnabled content type, .docm name)", async () => {
    const docm = await makeDocm();
    expect(sniffUpload(docm, "document", "a.docx").ok).toBe(false);
    expect(sniffUpload(await makeDocx(["x"]), "document", "a.docm").ok).toBe(false);
    expect(sniffUpload(await makeDocx(["x"]), "document", "a.docx", "application/vnd.ms-word.document.macroEnabled.12").ok).toBe(false);
  });

  it("refuses zips without word/document.xml, binary junk, invalid UTF-8 and empty files", () => {
    const zipNoDoc = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    expect(sniffUpload(zipNoDoc, "document").ok).toBe(false);
    expect(sniffUpload(Buffer.from([0x00, 0x01, 0x02]), "document").ok).toBe(false);
    expect(sniffUpload(Buffer.from([0xc3, 0x28]), "document").ok).toBe(false);
    expect(sniffUpload(Buffer.alloc(0), "document").ok).toBe(false);
    expect(isUtf8Text(Buffer.from("héllo"))).toBe(true);
  });
});

describe("readUpload", () => {
  it("accepts a valid upload and returns the sniffed format", async () => {
    const { body, contentType } = multipart({ name: "plan.pdf", type: "application/pdf", bytes: makePdf(["Hello"]) }, { title: "Plan" });
    const r = await readUpload(req(body, { "content-type": contentType, "content-length": String(body.length) }), "document");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.detected).toEqual({ format: "pdf", mime: "application/pdf" });
      expect(r.form.getString("title")).toBe("Plan");
      expect(r.file.name).toBe("plan.pdf");
    }
  });

  it("refuses on Content-Length before reading a byte of the body", async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new Uint8Array(1024));
      },
    });
    const r = await readUpload(
      req(stream, { "content-type": "multipart/form-data; boundary=x", "content-length": String(UPLOAD_LIMITS.document + 1024 * 1024) }),
      "document",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(413);
    expect(pulled).toBeLessThanOrEqual(1);
  });

  it("stops reading a chunked body once it passes the cap", async () => {
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 256 * 1024;
        controller.enqueue(new Uint8Array(256 * 1024));
        if (sent > 50 * 1024 * 1024) controller.close();
      },
    });
    const r = await readUpload(req(stream, { "content-type": "multipart/form-data; boundary=x" }), "document");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(413);
    expect(sent).toBeLessThan(UPLOAD_LIMITS.document + 2 * 1024 * 1024);
  });

  it("returns 415 for a file whose bytes are not an allowed type", async () => {
    const { body, contentType } = multipart({ name: "evil.docm", type: "application/octet-stream", bytes: await makeDocm() });
    const r = await readUpload(req(body, { "content-type": contentType }), "document");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(415);
  });

  it("returns 400 for a non-multipart body or a missing file", async () => {
    const r1 = await readUpload(req(Buffer.from("{}"), { "content-type": "application/json" }), "document");
    expect(!r1.ok && r1.response.status).toBe(400);
    const boundary = "b1";
    const body = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nx\r\n--${boundary}--\r\n`);
    const r2 = await readUpload(req(body, { "content-type": `multipart/form-data; boundary=${boundary}` }), "document");
    expect(!r2.ok && r2.response.status).toBe(400);
  });
});
