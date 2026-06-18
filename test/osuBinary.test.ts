import { describe, it, expect } from "vitest";
import { readOsuString, writeOsuString } from "../src/struct/osuBinary";

describe("osuBinary", () => {
  it("round-trips an empty string as a single 0x00 byte", () => {
    const buf = writeOsuString("");
    expect(Array.from(buf)).toEqual([0x00]);
    expect(readOsuString(buf, 0)).toEqual(["", 1]);
  });

  it("round-trips a short ASCII string", () => {
    const buf = writeOsuString("hello");
    expect(buf[0]).toBe(0x0b);
    expect(buf[1]).toBe(5);
    expect(readOsuString(buf, 0)).toEqual(["hello", buf.length]);
  });

  it("round-trips UTF-8 multibyte content with the correct byte length", () => {
    const s = "café—テスト";
    const buf = writeOsuString(s);
    const byteLen = Buffer.byteLength(s, "utf-8");
    const [value, next] = readOsuString(buf, 0);
    expect(value).toBe(s);
    expect(next).toBe(buf.length);
    expect(buf.length).toBe(1 + 1 + byteLen);
  });

  it("uses multi-byte ULEB128 for lengths over 127", () => {
    const s = "x".repeat(200);
    const buf = writeOsuString(s);
    expect(buf[0]).toBe(0x0b);
    expect(buf[1]).toBe(0xc8);
    expect(buf[2]).toBe(0x01);
    expect(readOsuString(buf, 0)).toEqual([s, buf.length]);
  });

  it("reads from a non-zero offset and reports the next offset", () => {
    const prefix = Buffer.from([0xaa, 0xbb]);
    const buf = Buffer.concat([prefix, writeOsuString("z")]);
    const [value, next] = readOsuString(buf, 2);
    expect(value).toBe("z");
    expect(next).toBe(buf.length);
  });

  it("throws on an invalid string indicator", () => {
    expect(() => readOsuString(Buffer.from([0x05]), 0)).toThrow(/Invalid string indicator/);
  });
});
