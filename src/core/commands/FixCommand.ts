import Monitor, { DisplayTextColor, FreezeCondition } from "../Monitor";
import DownloadFlow from "../DownloadFlow";
import CollectionDbService from "../CollectionDbService";
import CollectionDbManager from "../CollectionDbManager";
import { DownloadManager } from "../DownloadManager";
import OsuDbReader from "../OsuDbReader";
import { Msg } from "../../struct/Message";
import { collection, config } from "../../state";
import { Requestor } from "../Requestor";
import { ensureOsuPath } from "../osuPath";
import { parseIdInput } from "../../util";

export default class FixCommand {
  constructor(
    private monitor: Monitor,
    private collectionDb: CollectionDbService,
    private flow: DownloadFlow
  ) {}

  async run(): Promise<void> {
    this.monitor.section("Fix hashes");
    this.monitor.displayMessage(Msg.FIX_START, {}, DisplayTextColor.SECONDARY);

    if (!ensureOsuPath(this.monitor)) return;

    let collectionId: number | null = null;
    while (collectionId === null) {
      const input = this.monitor.awaitInput(Msg.FIX_INPUT_COLLECTION_ID, {}, "");
      if (!input) {
        return;
      }
      collectionId = parseIdInput(input);
    }

    if (!this.collectionDb.waitForOsuClosed()) {
      return;
    }

    this.monitor.displayMessage(Msg.FETCH_BRIEF_INFO, { id: collectionId.toString() });
    let apiData;
    try {
      apiData = await Requestor.fetchCollection(collectionId);
    } catch (e) {
      return this.monitor.freeze(Msg.PROCESS_ERRORED, { error: String(e) }, FreezeCondition.WARNING);
    }

    collection.id = collectionId;
    collection.resolveData(apiData);

    this.monitor.displayMessage(Msg.FIX_READING_OSU_DB);
    const osuDbReader = new OsuDbReader(config.osuDbPath);
    let beatmapIdToRealHash: Map<number, string>;
    let existingBeatmapsetIds: Set<number>;
    try {
      beatmapIdToRealHash = osuDbReader.readBeatmapIdToHash();
      existingBeatmapsetIds = osuDbReader.readAllBeatmapsetIds();
    } catch (e) {
      return this.monitor.freeze(Msg.PROCESS_ERRORED, { error: String(e) }, FreezeCondition.WARNING);
    }

    this.monitor.displayMessage(Msg.FIX_OSU_DB_COMPLETE, { count: beatmapIdToRealHash.size.toString() });

    this.monitor.displayMessage(Msg.FIX_HASHES_FIXING);
    const { hashes, replaced } = CollectionDbManager.getMd5HashesWithRealHashes(beatmapIdToRealHash);

    const dbManager = new CollectionDbManager();
    dbManager.readCollectionDb();
    this.collectionDb.writeCollection(dbManager, collection.name, "replace", hashes);

    this.monitor.displayMessage(Msg.FIX_HASHES_COMPLETE, {
      fixed: replaced.toString(),
      total: hashes.length.toString(),
      name: collection.name,
    });

    const missingBeatmapsetIds = new Set<number>();
    for (const [beatmapsetId, beatmapSet] of collection.beatMapSets) {
      let hasAny = existingBeatmapsetIds.has(beatmapsetId);
      if (!hasAny && beatmapSet.beatMaps) {
        for (const beatmap of beatmapSet.beatMaps.values()) {
          if (beatmapIdToRealHash.has(beatmap.id)) {
            hasAny = true;
            break;
          }
        }
      }
      if (!hasAny) {
        missingBeatmapsetIds.add(beatmapsetId);
      }
    }

    if (missingBeatmapsetIds.size === 0) {
      return this.monitor.freeze(Msg.FIX_ALL_DOWNLOADED, {
        fixed: replaced.toString(),
        total: hashes.length.toString(),
        name: collection.name,
      });
    }

    this.monitor.displayMessage(Msg.FIX_MISSING_COUNT, {
      missing: missingBeatmapsetIds.size.toString(),
      total: collection.beatMapSetCount.toString(),
    });

    const confirm = this.monitor.awaitInput(Msg.FIX_CONFIRM_DOWNLOAD, {}, "y");
    if (confirm.toLowerCase() !== "y") {
      return;
    }

    collection.keepOnly(missingBeatmapsetIds);

    let rateLimitStatus: number | null = null;
    try {
      rateLimitStatus = await Requestor.checkRateLimitation();
    } catch {
    }

    this.monitor.setTask(6);

    const downloadManager = new DownloadManager(rateLimitStatus);

    this.flow.wireCommonDownloadEvents(downloadManager);
    downloadManager.on("end", async () => {
      this.monitor.freeze(Msg.FIX_DOWNLOAD_COMPLETE, {
        downloaded: downloadManager.getDownloadedBeatMapSetSize().toString(),
        total: missingBeatmapsetIds.size.toString(),
        name: collection.name,
      });
    });

    downloadManager.bulkDownload();

    await this.flow.waitUntilDone(downloadManager);
  }
}
