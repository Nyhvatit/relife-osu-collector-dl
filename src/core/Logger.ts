import type OcdlError from "../struct/OcdlError";
import { existsSync, writeFileSync, appendFileSync } from "fs";
import _path from "path";
import { BeatMapSet } from "../struct/BeatMapSet";

// A utility class for logging errors and missing beatmaps
export default class Logger {
  static readonly errorLogPath = "./ocdl-error.log";
  static readonly missingLogPath = "./ocdl-missing.log";

  // Generates an error log file with the given error
  static generateErrorLog(error: OcdlError): boolean {
    try {
      // Check if the error log file exists
      if (!Logger._checkIfErrorLogFileExists()) {
        // If it does not, create the file and write the error stack trace to it
        writeFileSync(
          Logger.errorLogPath,
          `=== Error Log ===\n${
            error.stack ?? "Unknown error stack"
          }\n=========\n`
        );
      } else {
        // If the file does exist, append the error stack trace to it
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

  // Generates a log file for missing beatmaps
  // Note: Only call this function once per download, as it will overrides the previous log
  static generateMissingLog(
    folder: string,
    beatMapSets: BeatMapSet[]
  ): boolean {
    try {
      // Construct the path to the missing beatmaps log file in the given folder
      const path = _path.join(folder, Logger.missingLogPath);

      // Use map and join for efficient string concatenation
      // instead of concatenation in loop (O(n) instead of O(n²))
      const urlsString = beatMapSets
        .map((beatMapSet) => `https://osu.ppy.sh/beatmapsets/${beatMapSet.id}`)
        .join("\n");

      // Create file and write urls into it.
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
}
