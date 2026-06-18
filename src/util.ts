import https from "https";
import { existsSync } from "fs";
import path from "path";
import { Constant } from "./struct/Constant";

export function isBoolean(obj: unknown): boolean {
  return typeof obj === "boolean";
}

export function isValidOsuFolder(folder: string): boolean {
  if (!folder) return false;
  return (
    existsSync(folder) &&
    existsSync(path.join(folder, "Songs")) &&
    existsSync(path.join(folder, "osu!.db"))
  );
}

export function replaceForbiddenChars(str: string): string {
  return str.replace(/[\\/<>:"|?*]+/g, "");
}

export async function isOnline(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = https.get(Constant.OsuCollectorApiUrl, () => resolve(true));
    req.on("error", () => resolve(false));
    req.setTimeout(10000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

export function checkUndefined(
  obj: Record<string, unknown>,
  fields: string[]
): string | null {
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(obj, field)) {
      return field;
    }
  }
  return null;
}

export function checkRange(number: number, start: number, end: number): boolean {
  return number >= start && number <= end;
}

export function parseIdInput(input: string): number | null {
  const match = input.match(/(\d+)/);
  return match ? parseInt(match[1]) : null;
}

export function parseIndexSelection(input: string, count: number): number[] | null {
  const trimmed = input.trim().toLowerCase();
  if (trimmed === "" || trimmed === "a" || trimmed === "all") {
    return Array.from({ length: count }, (_, i) => i);
  }

  const result: number[] = [];
  const seen = new Set<number>();
  for (const part of trimmed.split(/[,\s]+/).filter(Boolean)) {
    const n = parseInt(part);
    if (isNaN(n) || n < 1 || n > count) return null;
    if (!seen.has(n)) {
      seen.add(n);
      result.push(n - 1);
    }
  }
  return result.length > 0 ? result : null;
}

const ESC = "\x1b";
const BEL = "\x07";

export function setTerminalTitle(title: string): void {
  process.stdout.write(`${ESC}]0;${title}${BEL}`);
}
