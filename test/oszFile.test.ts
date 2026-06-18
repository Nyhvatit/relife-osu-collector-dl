import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readdirSync, existsSync } from "fs";
import { tmpdir } from "os";
import _path from "path";
import { getOszFilename, isCompleteOsz, streamResponseToOsz } from "../src/core/OszFile";

function eocd(commentLen = 0): Buffer {
  const b = Buffer.alloc(22 + commentLen);
  b.writeUInt32LE(0x06054b50, 0);
  b.writeUInt16LE(commentLen, 20);
  return b;
}

let dir: string;
function tmpFile(name: string, data: Buffer): string {
  dir = dir ?? mkdtempSync(_path.join(tmpdir(), "ocdl-osz-"));
  const p = _path.join(dir, name);
  writeFileSync(p, data);
  return p;
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined as unknown as string;
});

describe("isCompleteOsz", () => {
  it("accepts a file ending in a valid EOCD", () => {
    const data = Buffer.concat([Buffer.alloc(2000), eocd()]);
    expect(isCompleteOsz(tmpFile("ok.osz", data), data.length)).toBe(true);
  });

  it("accepts an EOCD with a trailing comment of the declared length", () => {
    const data = Buffer.concat([Buffer.alloc(100), eocd(5)]);
    expect(isCompleteOsz(tmpFile("comment.osz", data), data.length)).toBe(true);
  });

  it("rejects a truncated archive with no EOCD", () => {
    const data = Buffer.alloc(2000);
    expect(isCompleteOsz(tmpFile("trunc.osz", data), data.length)).toBe(false);
  });

  it("rejects a file smaller than an EOCD record", () => {
    const data = Buffer.alloc(10);
    expect(isCompleteOsz(tmpFile("tiny.osz", data), data.length)).toBe(false);
  });

  it("rejects a stray EOCD signature that does not point to EOF", () => {
    const data = Buffer.concat([eocd(0), Buffer.alloc(500)]);
    expect(isCompleteOsz(tmpFile("stray.osz", data), data.length)).toBe(false);
  });
});

describe("getOszFilename", () => {
  const resp = (headers: Record<string, string>) =>
    ({ headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } } as never);

  it("falls back to Untitled.osz when there is no content-disposition", () => {
    expect(getOszFilename(resp({}))).toBe("Untitled.osz");
  });

  it("extracts and sanitises the filename", () => {
    expect(
      getOszFilename(resp({ "content-disposition": "attachment; filename=12 Artist - Title.osz" }))
    ).toBe("12 Artist - Title.osz");
  });

  it("strips forbidden characters from the extracted name", () => {
    expect(
      getOszFilename(resp({ "content-disposition": 'filename=a/b:c?.osz' }))
    ).toBe("abc.osz");
  });
});

describe("streamResponseToOsz", () => {
  const resp = (chunks: Buffer[], filename = "filename=map.osz") =>
    ({
      headers: { get: (k: string) => (k.toLowerCase() === "content-disposition" ? filename : null) },
      // eslint-disable-next-line @typescript-eslint/require-await
      body: (async function* () {
        for (const c of chunks) yield c;
      })(),
    } as never);

  it("writes a valid archive to destDir", async () => {
    const d = mkdtempSync(_path.join(tmpdir(), "ocdl-dest-"));
    try {
      const data = Buffer.concat([Buffer.alloc(2000), eocd()]);
      let chunks = 0;
      await streamResponseToOsz(resp([data]), d, () => chunks++);
      expect(readdirSync(d)).toEqual(["map.osz"]);
      expect(chunks).toBe(1);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("rejects and deletes a too-small download", async () => {
    const d = mkdtempSync(_path.join(tmpdir(), "ocdl-dest-"));
    try {
      await expect(streamResponseToOsz(resp([eocd()]), d, () => {})).rejects.toMatch(/too small/);
      expect(readdirSync(d)).toEqual([]);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("rejects and deletes a truncated (no-EOCD) download", async () => {
    const d = mkdtempSync(_path.join(tmpdir(), "ocdl-dest-"));
    try {
      const data = Buffer.alloc(2000);
      await expect(streamResponseToOsz(resp([data]), d, () => {})).rejects.toMatch(/incomplete/);
      expect(existsSync(_path.join(d, "map.osz"))).toBe(false);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});
