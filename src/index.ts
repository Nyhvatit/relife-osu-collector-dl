import Worker from "./core/Worker";
import Logger from "./core/Logger";
import OcdlError from "./struct/OcdlError";
import { Msg } from "./struct/Message";
import { FreezeCondition, BackToMenu } from "./core/Monitor";
import { collection } from "./state";
import { appendFileSync } from "fs";
import { execSync } from "child_process";

if (process.platform === "win32") {
  try {
    execSync("chcp 65001 > nul", { windowsHide: true });
  } catch {
  }
}

function logCrash(kind: string, err: unknown): void {
  try {
    const detail = err instanceof Error ? err.stack ?? err.message : String(err);
    appendFileSync("./ocdl-crash.log", `[${new Date().toISOString()}] ${kind}: ${detail}\n`);
  } catch {
  }
}
process.on("unhandledRejection", (reason) => logCrash("unhandledRejection", reason));
process.on("uncaughtException", (err) => logCrash("uncaughtException", err));

void (async () => {
  while (true) {
    const worker = new Worker();

    try {
      await worker.run();
    } catch (err) {
      if (!(err instanceof BackToMenu)) {
        if (err instanceof OcdlError) {
          Logger.generateErrorLog(err);
        }
        worker.monitor.freeze(
          Msg.PROCESS_ERRORED,
          { error: String(err) },
          FreezeCondition.ERRORED
        );
      }
    }

    collection.reset();
  }
})();
