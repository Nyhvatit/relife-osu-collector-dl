import https from "https";
import { Constant } from "./struct/Constant";

export function isBoolean(obj: unknown): boolean {
  return !!obj === obj;
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

// ANSI escape codes for setting terminal title
const ESC = "\x1b";  // Escape character (code 27)
const BEL = "\x07";  // Bell character (code 7)

export function setTerminalTitle(title: string): void {
  // OSC (Operating System Command) sequence for setting title
  process.stdout.write(`${ESC}]0;${title}${BEL}`);
}
