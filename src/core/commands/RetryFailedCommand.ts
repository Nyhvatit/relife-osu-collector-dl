import { existsSync, readdirSync, unlinkSync } from "fs";
import _path from "path";
import Monitor, { FreezeCondition } from "../Monitor";
import DownloadFlow from "../DownloadFlow";
import { DownloadManager } from "../DownloadManager";
import { Msg } from "../../struct/Message";
import { collection, config } from "../../state";
import { BeatMapSet } from "../../struct/BeatMapSet";
import { ensureOsuPath } from "../osuPath";

export default class RetryFailedCommand {
  constructor(private monitor: Monitor, private flow: DownloadFlow) {}

  async run(rateLimitStatus: number | null): Promise<void> {
    this.monitor.section("Retry failed");
    if (!ensureOsuPath(this.monitor)) return;

    const failedDir = _path.join(config.songsPath, "Failed");
    if (!existsSync(failedDir)) {
      this.monitor.freeze(Msg.RETRY_FAILED_NO_FOLDER, { path: failedDir }, FreezeCondition.WARNING);
      return;
    }

    const idToFiles = new Map<number, string[]>();
    for (const entry of readdirSync(failedDir)) {
      if (!entry.toLowerCase().endsWith(".osz")) continue;
      const m = entry.match(/^(\d+)/);
      if (!m) continue;
      const id = parseInt(m[1]);
      const arr = idToFiles.get(id) ?? [];
      arr.push(entry);
      idToFiles.set(id, arr);
    }

    if (idToFiles.size === 0) {
      this.monitor.freeze(Msg.RETRY_FAILED_NONE, {}, FreezeCondition.WARNING);
      return;
    }

    const confirm = this.monitor.awaitInput(
      Msg.RETRY_FAILED_CONFIRM,
      { count: idToFiles.size.toString() },
      "y"
    );
    if (confirm.toLowerCase() !== "y") return;

    const sets = new Map<number, BeatMapSet>();
    for (const id of idToFiles.keys()) {
      sets.set(id, new BeatMapSet({ id, beatmaps: [] }));
    }
    collection.load(0, "Failed retry", sets, 0, "local");

    this.monitor.setCondition({
      downloaded_beatmapset: 0,
      download_log: [],
      mirror_stats: [],
      remaining_downloads: rateLimitStatus,
    });
    this.monitor.setTask(6);

    const dm = new DownloadManager(rateLimitStatus);
    dm.path = config.songsPath;
    await this.flow.runToCompletion(dm, config.songsPath, { freeze: false });

    const stillFailed = new Set(dm.getNotDownloadedBeatMapSets().map((s) => s.id));
    let deleted = 0;
    for (const [id, files] of idToFiles) {
      if (stillFailed.has(id)) continue;
      for (const f of files) {
        try { unlinkSync(_path.join(failedDir, f)); deleted++; } catch { }
      }
    }

    this.monitor.freeze(Msg.RETRY_FAILED_DONE, {
      recovered: (idToFiles.size - stillFailed.size).toString(),
      total: idToFiles.size.toString(),
      deleted: deleted.toString(),
      missing: stillFailed.size.toString(),
    });
  }
}
