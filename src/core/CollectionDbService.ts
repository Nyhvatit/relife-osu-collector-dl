import { collection, config } from "../state";
import { Msg } from "../struct/Message";
import Monitor, { DisplayTextColor, FreezeCondition } from "./Monitor";
import CollectionDbManager from "./CollectionDbManager";
import OsuDbReader from "./OsuDbReader";
import { ensureOsuPath } from "./osuPath";

export default class CollectionDbService {
  constructor(private monitor: Monitor) {}

  waitForOsuClosed(): boolean {
    this.monitor.displayMessage(Msg.CHECK_OSU_RUNNING);
    while (CollectionDbManager.isOsuRunning()) {
      this.monitor.displayMessage(Msg.OSU_IS_RUNNING_WAIT, {}, DisplayTextColor.DANGER);
      this.monitor.awaitInput(Msg.OSU_IS_RUNNING_PROMPT, {}, "");
      this.monitor.displayMessage(Msg.CHECK_OSU_RUNNING);
      if (CollectionDbManager.isOsuRunning()) {
        this.monitor.displayMessage(Msg.OSU_STILL_RUNNING, {}, DisplayTextColor.DANGER);
      }
    }
    return true;
  }

  addToCollectionDb(options: { silent?: boolean } = {}): boolean {
    if (!this.waitForOsuClosed()) {
      return false;
    }

    let beatmapIdToRealHash: Map<number, string> = new Map();
    this.monitor.displayMessage(Msg.FIX_READING_OSU_DB);
    try {
      const osuDbReader = new OsuDbReader(config.osuDbPath);
      beatmapIdToRealHash = osuDbReader.readBeatmapIdToHash();
      this.monitor.displayMessage(Msg.FIX_OSU_DB_COMPLETE, {
        count: beatmapIdToRealHash.size.toString(),
      });
    } catch {
    }

    const dbManager = new CollectionDbManager();
    this.monitor.displayMessage(Msg.READING_COLLECTION_DB);
    dbManager.readCollectionDb();

    const resolved = this.resolveCollectionConflict(dbManager, collection.name);
    if (!resolved) return false;
    const { name: collectionName, action: collectionAction } = resolved;

    const { hashes, replaced } = CollectionDbManager.getMd5HashesWithRealHashes(
      beatmapIdToRealHash
    );

    this.monitor.displayMessage(Msg.ADDING_TO_COLLECTION_DB);
    this.writeCollection(dbManager, collectionName, collectionAction, hashes);

    if (replaced > 0) {
      this.monitor.displayMessage(Msg.FIX_COLLECTION_STATS, {
        name: collectionName,
        fixed: replaced.toString(),
        total: hashes.length.toString(),
      });
    }

    if (options.silent) {
      this.monitor.displayMessage(
        Msg.COLLECTION_DB_UPDATED,
        { name: collectionName, count: hashes.length.toString() },
        DisplayTextColor.SUCCESS
      );
    } else {
      this.monitor.freeze(Msg.COLLECTION_DB_UPDATED, {
        name: collectionName,
        count: hashes.length.toString(),
      });
    }

    return true;
  }

  backupLocalMaps(): void {
    this.monitor.section("Backup maps");
    this.monitor.displayMessage(Msg.BACKUP_DESCRIPTION, {}, DisplayTextColor.SECONDARY);

    const confirm = this.monitor.awaitInput(Msg.BACKUP_CONFIRM, {}, "n");
    if (confirm.toLowerCase() !== "y") {
      this.monitor.displayMessage(Msg.BACKUP_CANCELLED);
      return;
    }

    if (!ensureOsuPath(this.monitor)) return;

    if (!this.waitForOsuClosed()) {
      return;
    }

    this.monitor.displayMessage(Msg.BACKUP_READING_OSU_DB);
    let allHashes: Set<string>;
    try {
      const osuDbReader = new OsuDbReader(config.osuDbPath);
      allHashes = osuDbReader.readAllHashes();
    } catch (e) {
      return this.monitor.freeze(Msg.PROCESS_ERRORED, { error: String(e) }, FreezeCondition.WARNING);
    }

    this.monitor.displayMessage(Msg.BACKUP_FOUND_MAPS, { count: allHashes.size.toString() });

    if (allHashes.size === 0) {
      return this.monitor.freeze(Msg.BACKUP_NO_MAPS, {}, FreezeCondition.WARNING);
    }

    this.monitor.displayMessage(Msg.READING_COLLECTION_DB);
    const dbManager = new CollectionDbManager();
    dbManager.readCollectionDb();

    const resolved = this.resolveCollectionConflict(dbManager, "backup maps");
    if (!resolved) return;
    const { name: collectionName, action: collectionAction } = resolved;

    this.monitor.displayMessage(Msg.BACKUP_WRITING);
    const hashArray = Array.from(allHashes);
    this.writeCollection(dbManager, collectionName, collectionAction, hashArray);

    this.monitor.freeze(Msg.BACKUP_COMPLETE, { count: hashArray.length.toString(), name: collectionName });
  }

  writeCollection(
    dbManager: CollectionDbManager,
    name: string,
    action: "merge" | "replace",
    hashes: string[]
  ): void {
    if (action === "replace") dbManager.replaceCollection(name, hashes);
    else dbManager.addCollection(name, hashes);
    dbManager.writeCollectionDb();

    const backupPath = dbManager.getLastBackupPath();
    if (backupPath) {
      this.monitor.displayMessage(Msg.COLLECTION_DB_BACKUP_CREATED, { path: backupPath });
    }
  }

  private resolveCollectionConflict(
    dbManager: CollectionDbManager,
    baseName: string
  ): { name: string; action: "merge" | "replace" } | null {
    if (!dbManager.hasCollection(baseName)) {
      return { name: baseName, action: "merge" };
    }

    this.monitor.displayMessage(Msg.COLLECTION_CONFLICT, {
      name: baseName,
      count: dbManager.getCollectionSize(baseName).toString(),
    });

    for (;;) {
      const choice = this.monitor.awaitInput(Msg.COLLECTION_CONFLICT_INPUT, {}, "1");
      if (choice === "1") return { name: baseName, action: "merge" };
      if (choice === "2") return { name: baseName, action: "replace" };
      if (choice === "3") {
        let suffix = 2;
        while (dbManager.hasCollection(`${baseName}_${suffix}`)) suffix++;
        return { name: `${baseName}_${suffix}`, action: "merge" };
      }
      if (choice === "4") return null;
    }
  }
}
