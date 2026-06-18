import Monitor, { DisplayTextColor, FreezeCondition, BackToMenu } from "../Monitor";
import DownloadFlow from "../DownloadFlow";
import TournamentCommand from "./TournamentCommand";
import { Msg } from "../../struct/Message";
import { collection } from "../../state";
import { Requestor, UserUploads } from "../Requestor";
import { Tournament } from "../../struct/Tournament";
import { pickFromList } from "../picker";
import { parseIdInput } from "../../util";

export default class UserUploadsCommand {
  constructor(private monitor: Monitor, private flow: DownloadFlow) {}

  async run(rateLimitStatus: number | null): Promise<void> {
    this.monitor.section("User uploads");
    this.monitor.displayMessage(Msg.USER_START, {}, DisplayTextColor.SECONDARY);

    let uploads: UserUploads | null = null;
    while (uploads === null) {
      const input = this.monitor.awaitInput(Msg.USER_INPUT_ID, {}, "");
      if (!input) return;
      const userId = parseIdInput(input);
      if (userId === null) continue;

      this.monitor.displayMessage(Msg.USER_FETCHING, { id: userId.toString() });
      try {
        uploads = await Requestor.fetchUserUploads(userId);
      } catch {
        this.monitor.displayMessage(Msg.USER_NOT_FOUND, { id: userId.toString() }, DisplayTextColor.DANGER);
      }
    }

    const hasCollections = uploads.collections.length > 0;
    const hasTournaments = uploads.tournaments.length > 0;
    if (!hasCollections && !hasTournaments) {
      return this.monitor.freeze(Msg.USER_NONE, {}, FreezeCondition.WARNING);
    }

    let browseTournaments: boolean;
    if (hasCollections && hasTournaments) {
      let choice: "1" | "2" | null = null;
      while (choice === null) {
        this.monitor.displayMessage(Msg.USER_TYPE, {
          collections: uploads.collections.length.toString(),
          tournaments: uploads.tournaments.length.toString(),
        });
        const input = this.monitor.awaitInput(Msg.USER_TYPE_INPUT, {}, "1");
        if (input === "1" || input === "2") choice = input;
      }
      browseTournaments = choice === "2";
    } else {
      browseTournaments = hasTournaments;
    }

    const picked = browseTournaments
      ? pickFromList(this.monitor, uploads.tournaments.map((t) => t.name), "Tournaments")
      : pickFromList(
          this.monitor,
          uploads.collections.map((c) => `${c.name} (${c.beatmapCount} maps)`),
          "Collections"
        );
    if (picked === null || picked.length === 0) return;

    let combinePerTournament = false;
    if (browseTournaments) {
      let choice: "1" | "2" | null = null;
      while (choice === null) {
        this.monitor.displayMessage(Msg.USER_TG);
        const input = this.monitor.awaitInput(Msg.USER_TG_INPUT, {}, "1");
        if (input === "1" || input === "2") choice = input;
      }
      combinePerTournament = choice === "2";
    }

    if (!this.flow.requireOsuPathForDbModes()) return;

    this.monitor.setTask(6);
    let processed = 0;
    if (browseTournaments) {
      for (const i of picked) {
        const summary = uploads.tournaments[i];
        try {
          const tournament = new Tournament(await Requestor.fetchTournament(summary.id));
          if (tournament.unresolvedCount > 0) {
            await TournamentCommand.resolveMaps(tournament);
          }

          const units = combinePerTournament
            ? [Tournament.mergeStages(tournament.name, tournament.stages)]
            : tournament.stages.map((s) => ({
                ...s,
                name: `${tournament.name} - ${s.name}`,
              }));

          for (const unit of units) {
            collection.load(
              tournament.id,
              unit.name,
              unit.beatMapSets,
              unit.beatMapCount,
              tournament.uploaderName
            );
            rateLimitStatus = await this.flow.processLoadedCollection(rateLimitStatus);
            processed++;
          }
        } catch (e) {
          if (e instanceof BackToMenu) throw e;
          this.logUploadError(summary.id, summary.name, e);
        }
      }
    } else {
      for (const i of picked) {
        const c = uploads.collections[i];
        try {
          collection.resolveData(await Requestor.fetchCollection(c.id));
          await this.flow.fetchFullData();
          rateLimitStatus = await this.flow.processLoadedCollection(rateLimitStatus);
          processed++;
        } catch (e) {
          if (e instanceof BackToMenu) throw e;
          this.logUploadError(c.id, c.name, e);
        }
      }
    }

    this.monitor.freeze(Msg.USER_DONE, { count: processed.toString() });
  }

  private logUploadError(id: number, name: string, e: unknown): void {
    this.monitor.appendDownloadLog(
      Msg.DOWNLOAD_FILE_FAILED,
      { id: id.toString(), name, error: String(e) },
      DisplayTextColor.DANGER
    );
    this.monitor.update();
  }
}
