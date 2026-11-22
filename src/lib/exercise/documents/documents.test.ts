// @vitest-environment node
// Document library: upload sniffing for the 'document' kind, text extraction
// per format, and section detection on the sample playbook.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sniffUpload } from "@/lib/exercise/ingest/upload";
import { detectSections } from "@/lib/exercise/ingest/sections";
import { IngestError } from "@/lib/exercise/ingest/limits";
import { makeDocm, makeDocx, makePdf } from "@/test/fixtures";
import { cleanText, extractDocumentText, pasteDocumentSchema, sha256Hex, updateDocumentSchema } from "./documents";
import { documentKindLabel, isDocumentKind } from "./kinds";

const PLAYBOOK = readFileSync(path.join(process.cwd(), "src/lib/exercise/documents/fixtures/ransomware-playbook.md"), "utf8");

describe("document upload sniffing", () => {
  it("accepts PDF, DOCX, Markdown and text by their bytes", async () => {
    expect(sniffUpload(makePdf(["Ransomware playbook"]), "document", "plan.txt")).toMatchObject({ ok: true, format: "pdf" });
    expect(sniffUpload(await makeDocx(["Escalation"]), "document", "plan.pdf")).toMatchObject({ ok: true, format: "docx" });
    expect(sniffUpload(Buffer.from(PLAYBOOK), "document", "playbook.md")).toMatchObject({ ok: true, format: "md" });
    expect(sniffUpload(Buffer.from(PLAYBOOK), "document", "playbook.txt")).toMatchObject({ ok: true, format: "txt" });
    // A VTT given as a document is kept as plain text.
    expect(sniffUpload(Buffer.from("WEBVTT\n\n00:00.000 --> 00:01.000\nHi"), "document", "call.vtt")).toMatchObject({ ok: true, format: "txt" });
  });

  it("refuses macro documents, binaries and empty files", async () => {
    expect(sniffUpload(await makeDocm(), "document", "plan.docx")).toMatchObject({ ok: false });
    expect(sniffUpload(await makeDocx(["x"]), "document", "plan.docm")).toMatchObject({ ok: false, error: expect.stringMatching(/macros/) });
    expect(sniffUpload(Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x00]), "document", "a.bin")).toMatchObject({ ok: false });
    expect(sniffUpload(Buffer.alloc(0), "document", "a.txt")).toMatchObject({ ok: false, error: "The file is empty." });
  });
});

describe("extractDocumentText", () => {
  it("reads text and markdown, keeping headings", async () => {
    const text = await extractDocumentText(Buffer.from(`﻿${PLAYBOOK.replace(/\n/g, "\r\n")}`), "md");
    expect(text.startsWith("# Ransomware Response Playbook")).toBe(true);
    expect(text).not.toContain("\r");
  });

  it("reads PDF and DOCX in the worker", async () => {
    expect(await extractDocumentText(makePdf(["Declare a Severity 1 incident"]), "pdf")).toContain("Declare a Severity 1 incident");
    expect(await extractDocumentText(await makeDocx(["3.2 Declaring an Incident", "The IC declares."]), "docx")).toMatch(/3\.2 Declaring an Incident[\s\S]*The IC declares\./);
  }, 30_000);

  it("fails with a plain message for a broken PDF", async () => {
    const err = await extractDocumentText(Buffer.from("%PDF-1.4 this is not a pdf"), "pdf").catch((e) => e);
    expect(err).toBeInstanceOf(IngestError);
    expect((err as IngestError).userMessage).toMatch(/could not be read/);
  }, 30_000);
});

describe("document text and metadata", () => {
  it("strips control characters but keeps tabs and newlines", () => {
    expect(cleanText("a\u0000b\u0007c\td\r\ne")).toBe("abc\td\ne");
  });

  it("hashes the stored text", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("detects the playbook outline", () => {
    const headings = detectSections(PLAYBOOK).map((s) => s.heading);
    expect(headings).toContain("1. Purpose and Scope");
    expect(headings).toContain("3.2 Declaring an Incident");
    expect(headings).toContain("5.2 Ransom Payment");
    expect(headings.length).toBeGreaterThanOrEqual(20);
  });

  it("validates kinds and edits", () => {
    expect(isDocumentKind("sop")).toBe(true);
    expect(isDocumentKind("script")).toBe(false);
    expect(documentKindLabel("bcp_dr")).toBe("BCP or DR plan");
    expect(pasteDocumentSchema.safeParse({ title: "x", kind: "nope", text: "y" }).success).toBe(false);
    expect(updateDocumentSchema.safeParse({}).success).toBe(false);
    expect(updateDocumentSchema.safeParse({ kind: "policy" }).success).toBe(true);
  });
});
