// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import {
  readBoundedMultipart,
  parseMultipart,
  withUploadSlot,
  activeUploadCount,
  UploadedFile,
} from "./upload";

async function encode(fd: FormData): Promise<{ body: Uint8Array<ArrayBuffer>; contentType: string }> {
  const r = new Response(fd);
  return { body: new Uint8Array(await r.arrayBuffer()), contentType: r.headers.get("content-type")! };
}

function req(body: Uint8Array<ArrayBuffer> | ReadableStream<Uint8Array>, contentType: string, contentLength?: number): Request {
  const headers: Record<string, string> = { "content-type": contentType };
  if (contentLength !== undefined) headers["content-length"] = String(contentLength);
  return new Request("http://x/upload", { method: "POST", headers, body, duplex: "half" } as RequestInit);
}

afterEach(() => {
  delete process.env.MAX_CONCURRENT_UPLOADS;
  delete process.env.MAX_ATTACHMENT_BYTES;
});

describe("parseMultipart (matches the platform FormData encoder)", () => {
  it("parses text fields and a binary file part as a zero-copy view", async () => {
    const bin = new Uint8Array([13, 10, 45, 45, 0, 255, 13, 10]); // CRLF + "--" inside the content
    const fd = new FormData();
    fd.append("description", 'héllo "q"\r\nline');
    fd.append("file", new File([bin], 'we"ird\r\nnamé.txt', { type: "text/plain" }));
    fd.append("category", "");
    const { body, contentType } = await encode(fd);
    const buf = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
    const form = parseMultipart(buf, contentType)!;
    expect(form).not.toBeNull();
    expect(form.get("description")).toBe('héllo "q"\r\nline');
    expect(form.get("category")).toBe("");
    const file = form.get("file") as UploadedFile;
    expect(file).toBeInstanceOf(UploadedFile);
    expect(file.name).toBe('we"ird\r\nnamé.txt');
    expect(file.type).toBe("text/plain");
    expect([...file.bytes]).toEqual([...bin]);
    expect(file.bytes.buffer).toBe(buf.buffer); // a view, not a copy
  });

  it("agrees with Request.formData() on a mixed body", async () => {
    const fd = new FormData();
    fd.append("a", "1");
    fd.append("a", "2");
    fd.append("f", new File([new Uint8Array(70_000).fill(7)], "big.bin", { type: "application/octet-stream" }));
    const { body, contentType } = await encode(fd);
    const ours = parseMultipart(Buffer.from(body), contentType)!;
    const ref = await new Request("http://x", { method: "POST", headers: { "content-type": contentType }, body }).formData();
    expect(ours.getAll("a")).toEqual(ref.getAll("a"));
    const f = ours.get("f") as UploadedFile;
    const rf = ref.get("f") as File;
    expect(f.size).toBe(rf.size);
    expect(Buffer.from(await rf.arrayBuffer()).equals(f.bytes)).toBe(true);
  });

  it("returns null for malformed bodies", () => {
    expect(parseMultipart(Buffer.from("nope"), "multipart/form-data; boundary=xyz")).toBeNull();
    expect(parseMultipart(Buffer.from("--xyz\r\nContent-Disposition: form-data; name=a\r\n\r\nunterminated"), "multipart/form-data; boundary=xyz")).toBeNull();
    expect(parseMultipart(Buffer.from("--xyz--"), "multipart/form-data")).toBeNull(); // no boundary
  });
});

describe("readBoundedMultipart", () => {
  it("reads with and without Content-Length", async () => {
    const fd = new FormData();
    fd.append("file", new File(["hello world"], "a.txt", { type: "text/plain" }));
    const { body, contentType } = await encode(fd);
    for (const len of [body.byteLength, undefined]) {
      const r = await readBoundedMultipart(req(body, contentType, len), 1024);
      expect(r.ok).toBe(true);
      if (r.ok) expect((r.form.get("file") as UploadedFile).bytes.toString()).toBe("hello world");
    }
  });

  it("413s over the cap (declared and streamed)", async () => {
    const fd = new FormData();
    fd.append("file", new File(["x".repeat(200_000)], "a.txt"));
    const { body, contentType } = await encode(fd);
    for (const len of [body.byteLength, undefined]) {
      const r = await readBoundedMultipart(req(body, contentType, len), 1024);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.response.status).toBe(413);
    }
  });

  it("refuses a body longer than its declared Content-Length", async () => {
    const fd = new FormData();
    fd.append("file", new File(["hello world"], "a.txt"));
    const { body, contentType } = await encode(fd);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(body);
        c.close();
      },
    });
    const r = await readBoundedMultipart(req(stream, contentType, 10), 1024);
    expect(r.ok).toBe(false);
  });

  it("refuses NUL in names and fields", async () => {
    const fd = new FormData();
    fd.append("description", "a\u0000b");
    const { body, contentType } = await encode(fd);
    const r = await readBoundedMultipart(req(body, contentType, body.byteLength), 1024);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(400);
  });
});

describe("MAX_CONCURRENT_UPLOADS", () => {
  it("503s with Retry-After past the cap and releases slots when handlers finish", async () => {
    process.env.MAX_CONCURRENT_UPLOADS = "2";
    const fd = new FormData();
    fd.append("file", new File(["data"], "a.txt"));
    const { body, contentType } = await encode(fd);

    const gates: (() => void)[] = [];
    const handler = withUploadSlot(async (r: Request) => {
      const read = await readBoundedMultipart(r, 1024);
      if (!read.ok) return read.response;
      await new Promise<void>((resolve) => gates.push(resolve)); // hold the slot
      return new Response("ok", { status: 201 });
    });

    const a = handler(req(body, contentType, body.byteLength), {});
    const b = handler(req(body, contentType, body.byteLength), {});
    await new Promise((r) => setTimeout(r, 10));
    expect(activeUploadCount()).toBe(2);

    const c = await handler(req(body, contentType, body.byteLength), {});
    expect(c.status).toBe(503);
    expect(c.headers.get("Retry-After")).toBe("5");
    expect((await c.json()).code).toBe("upload_busy");

    gates.forEach((g) => g());
    expect((await a).status).toBe(201);
    expect((await b).status).toBe(201);
    expect(activeUploadCount()).toBe(0);

    const d = withUploadSlot(async (r: Request) => {
      const read = await readBoundedMultipart(r, 1024);
      return read.ok ? new Response("ok", { status: 201 }) : read.response;
    });
    expect((await d(req(body, contentType, body.byteLength), {})).status).toBe(201);
  });

  it("releases the slot when the handler throws", async () => {
    const fd = new FormData();
    fd.append("file", new File(["data"], "a.txt"));
    const { body, contentType } = await encode(fd);
    const handler = withUploadSlot(async (r: Request) => {
      await readBoundedMultipart(r, 1024);
      throw new Error("boom");
    });
    await expect(handler(req(body, contentType, body.byteLength), {})).rejects.toThrow("boom");
    expect(activeUploadCount()).toBe(0);
  });
});
