import type OcdlError from "../struct/OcdlError";
import { existsSync, writeFileSync, appendFileSync } from "fs";
import _path from "path";
import { BeatMapSet } from "../struct/BeatMapSet";

export interface MirrorDiag {
  mirror: string;
  ok: number;
  fail: number;
  notfound: number;
  rl: number;
  banned: boolean;
  okMs: number;
  failMs: number;
}

export interface DiagnosticsData {
  durationMs: number;
  tailIdleMs: number;
  idleTicks: number;
  totalDownloaded: number;
  totalMissing: number;
  mirrors: MirrorDiag[];
  giveUps: {
    id: number;
    reason: string;
    attempts: number;
    rlHits: number;
    failed: string[];
    at: string;
  }[];
  events: string[];
}

export default class Logger {
  static readonly errorLogPath = "./ocdl-error.log";
  static readonly missingLogPath = "./ocdl-missing.log";
  static readonly diagnosticsLogPath = "./ocdl-diagnostics.log";

  static generateErrorLog(error: OcdlError): boolean {
    try {
      if (!Logger._checkIfErrorLogFileExists()) {
        writeFileSync(
          Logger.errorLogPath,
          `=== Error Log ===\n${
            error.stack ?? "Unknown error stack"
          }\n=========\n`
        );
      } else {
        appendFileSync(
          Logger.errorLogPath,
          `${error.stack ?? "Unknown error stack"}\n=================\n`
        );
      }
      return true;
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  static generateMissingLog(
    folder: string,
    beatMapSets: BeatMapSet[]
  ): boolean {
    try {
      const path = _path.join(folder, Logger.missingLogPath);

      const urlsString = beatMapSets
        .map((beatMapSet) => `https://osu.ppy.sh/beatmapsets/${beatMapSet.id}`)
        .join("\n");

      writeFileSync(
        path,
        `=== Missing Beatmap Sets ===\n[ Try to download them manually ]\n${urlsString}\n`
      );

      return true;
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  private static _checkIfErrorLogFileExists(): boolean {
    return existsSync(Logger.errorLogPath);
  }

  static generateDiagnosticsLog(data: DiagnosticsData): boolean {
    try {
      const s = (ms: number): string => (ms / 1000).toFixed(1) + "s";
      const pad = (v: string | number, n: number): string => String(v).padEnd(n);

      const lines: string[] = [];
      lines.push("=== relife-ocdl diagnostics ===");
      lines.push("generated " + new Date().toISOString());
      lines.push("run duration: " + s(data.durationMs));
      lines.push(
        `downloaded: ${data.totalDownloaded} | missing: ${data.totalMissing}`
      );
      lines.push(
        "tail idle (last success -> end): " +
          s(data.tailIdleMs) +
          "   <- time spent stuck at the end"
      );
      lines.push(
        "idle ticks (workers with no usable mirror): " + data.idleTicks
      );
      lines.push("");

      lines.push("--- Per-mirror efficiency ---");
      lines.push(
        pad("mirror", 14) +
          pad("ok", 6) +
          pad("fail", 6) +
          pad("notfnd", 8) +
          pad("429", 5) +
          pad("banned", 8) +
          pad("avg-dl", 9) +
          pad("total-dl", 10) +
          "wasted"
      );
      for (const m of data.mirrors) {
        const avg = m.ok > 0 ? (m.okMs / m.ok / 1000).toFixed(2) + "s" : "-";
        lines.push(
          pad(m.mirror, 14) +
            pad(m.ok, 6) +
            pad(m.fail, 6) +
            pad(m.notfound, 8) +
            pad(m.rl, 5) +
            pad(m.banned ? "yes" : "no", 8) +
            pad(avg, 9) +
            pad(s(m.okMs), 10) +
            s(m.failMs)
        );
      }
      lines.push("");

      lines.push(`--- Give-ups (${data.giveUps.length} maps dropped -> missing) ---`);
      for (const g of data.giveUps) {
        lines.push(
          `[${g.at}] ${g.id}  reason="${g.reason}" attempts=${g.attempts} rlHits=${g.rlHits} failed=[${g.failed.join(",")}]`
        );
      }
      lines.push("");

      lines.push(`--- Mirror events (cooldowns / bans / benches), ${data.events.length} ---`);
      for (const e of data.events) lines.push(e);
      lines.push("");

      writeFileSync(Logger.diagnosticsLogPath, lines.join("\n"));
      return true;
    } catch (error) {
      console.error(error);
      return false;
    }
  }
}
