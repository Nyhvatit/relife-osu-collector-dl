import Monitor, { DisplayTextColor } from "../Monitor";
import DownloadFlow from "../DownloadFlow";
import { Msg } from "../../struct/Message";
import { collection } from "../../state";
import { Requestor } from "../Requestor";
import { Tournament, TournamentStage } from "../../struct/Tournament";
import { parseIndexSelection, parseIdInput } from "../../util";

export default class TournamentCommand {
  constructor(private monitor: Monitor, private flow: DownloadFlow) {}

  async run(rateLimitStatus: number | null): Promise<void> {
    this.monitor.section("Tournament");
    this.monitor.displayMessage(Msg.TOURNAMENT_START, {}, DisplayTextColor.SECONDARY);

    let loaded: Tournament | null = null;
    while (loaded === null) {
      const input = this.monitor.awaitInput(Msg.TOURNAMENT_INPUT_ID, {}, "");
      if (!input) return;
      const tournamentId = parseIdInput(input);
      if (tournamentId === null) continue;

      this.monitor.displayMessage(Msg.TOURNAMENT_FETCHING, { id: tournamentId.toString() });
      try {
        const t = new Tournament(await Requestor.fetchTournament(tournamentId));
        if (t.stages.length === 0) {
          this.monitor.displayMessage(Msg.TOURNAMENT_NOT_FOUND, { id: tournamentId.toString() }, DisplayTextColor.DANGER);
          continue;
        }
        loaded = t;
      } catch {
        this.monitor.displayMessage(Msg.TOURNAMENT_NOT_FOUND, { id: tournamentId.toString() }, DisplayTextColor.DANGER);
      }
    }
    const tournament = loaded;

    if (tournament.unresolvedCount > 0) {
      this.monitor.displayMessage(
        Msg.TOURNAMENT_RESOLVING,
        { count: tournament.unresolvedCount.toString() },
        DisplayTextColor.SECONDARY
      );
      const failed = await TournamentCommand.resolveMaps(tournament);
      if (failed > 0) {
        this.monitor.displayMessage(
          Msg.TOURNAMENT_UNAVAILABLE,
          { count: failed.toString() },
          DisplayTextColor.SECONDARY
        );
      }
    }

    const list = tournament.stages
      .map((s, i) => `  ${String(i + 1).padStart(2)}  ${s.name} (${s.beatMapCount} maps)`)
      .join("\n");
    let selected: TournamentStage[] | null = null;
    while (selected === null) {
      this.monitor.displayMessage(Msg.TOURNAMENT_STAGES_HEADER, { name: tournament.name, list });
      const input = this.monitor.awaitInput(Msg.TOURNAMENT_SELECT_STAGES, {}, "a");
      const idx = parseIndexSelection(input, tournament.stages.length);
      selected = idx ? idx.map((i) => tournament.stages[i]) : null;
      if (selected === null) {
        this.monitor.displayMessage(Msg.TOURNAMENT_SELECT_ERR, {}, DisplayTextColor.DANGER);
      }
    }

    let units: TournamentStage[];
    if (selected.length > 1 && this.askCombineStages()) {
      units = [Tournament.mergeStages(tournament.name, selected)];
    } else {
      units = selected.map((s) => ({
        ...s,
        name: `${tournament.name} - ${s.name}`,
      }));
    }

    if (!this.flow.requireOsuPathForDbModes()) return;

    this.monitor.setTask(6);
    for (const unit of units) {
      collection.load(tournament.id, unit.name, unit.beatMapSets, unit.beatMapCount, tournament.uploaderName);
      rateLimitStatus = await this.flow.processLoadedCollection(rateLimitStatus);
    }

    this.monitor.freeze(Msg.TOURNAMENT_DONE, {
      name: tournament.name,
      count: units.length.toString(),
    });
  }

  static async resolveMaps(tournament: Tournament): Promise<number> {
    let failed = 0;
    for (const stage of tournament.stages) {
      for (const beatmapId of stage.unresolvedBeatmapIds) {
        const resolved = await Requestor.resolveBeatmap(beatmapId);
        if (resolved) {
          tournament.addResolvedMap(stage, beatmapId, resolved);
        } else {
          failed++;
        }
      }
      stage.unresolvedBeatmapIds = [];
    }
    return failed;
  }

  private askCombineStages(): boolean {
    for (;;) {
      this.monitor.displayMessage(Msg.TOURNAMENT_GROUPING);
      const choice = this.monitor.awaitInput(Msg.TOURNAMENT_GROUPING_INPUT, {}, "1");
      if (choice === "1") return false;
      if (choice === "2") return true;
    }
  }
}
