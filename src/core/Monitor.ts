import chalk from "chalk";
import { formatMessage, Msg } from "../struct/Message";
import OcdlError from "../struct/OcdlError";
import { setTerminalTitle } from "../util";
import { collection, config } from "../state";
import promptSync from "prompt-sync";
import { LIB_VERSION } from "../version";
import { MirrorStatsView } from "../types";

interface Condition {
  retry_input: boolean;
  missing_log_found: boolean;
  retry_missing_log_input: boolean;
  fetched_collection: number;
  remaining_downloads: number | null;
  downloaded_beatmapset: number;
  download_log: string[];
  mirror_stats: MirrorStatsView[];
}

export enum DisplayTextColor {
  PRIMARY = "yellowBright",
  SECONDARY = "grey",
  DANGER = "red",
  SUCCESS = "green",
  WHITE = "white",
}

export enum FreezeCondition {
  NORMAL,
  WARNING,
  ERRORED,
}

export const GO_BACK_SIGNAL = Symbol("GO_BACK");

export class BackToMenu extends Error {
  constructor() {
    super("back-to-menu");
    this.name = "BackToMenu";
  }
}

export default class Monitor {
  private progress = 0;
  private prompt = promptSync({ sigint: true });
  private readonly task: Record<number, () => void>;
  private readonly condition: Condition;

  constructor() {
    this.condition = {
      retry_input: false,
      missing_log_found: false,
      retry_missing_log_input: false,
      fetched_collection: 0,
      downloaded_beatmapset: 0,
      remaining_downloads: null,
      download_log: [],
      mirror_stats: [],
    };

    setTerminalTitle(`relife-ocdl v${LIB_VERSION}`);

    this.task = {
      0: () => undefined,
      1: this.p_input_id.bind(this),
      2: this.p_fetch_brief_info.bind(this),
      3: this.p_check_folder.bind(this),
      4: this.p_fetch_collection.bind(this),
      5: this.p_generate_osdb.bind(this),
      6: this.p_download.bind(this),
    };
  }

  update(): void {
    console.clear();

    this.displayHeader();

    try {
      this.task[this.progress]();
    } catch (e) {
      throw new OcdlError("MESSAGE_GENERATION_FAILED", e);
    }
  }

  freeze(
    message: Msg,
    variable: Record<string, string> = {},
    freezeCondition: FreezeCondition = FreezeCondition.NORMAL
  ): void {
    let messageColor: DisplayTextColor;
    switch (freezeCondition) {
      case FreezeCondition.NORMAL:
        messageColor = DisplayTextColor.SUCCESS;
        break;
      case FreezeCondition.WARNING:
        messageColor = DisplayTextColor.PRIMARY;
        break;
      case FreezeCondition.ERRORED:
        messageColor = DisplayTextColor.DANGER;
        break;
    }

    this.displayMessage(message, variable, messageColor);

    this.prompt(
      formatMessage(Msg.FREEZE, {
        action: freezeCondition == FreezeCondition.ERRORED ? "exit" : "continue",
      }) + " "
    );

    if (freezeCondition == FreezeCondition.ERRORED) {
      process.exit(1);
    }
  }

  displayMessage(
    message: Msg,
    variable: Record<string, string> = {},
    color: DisplayTextColor = DisplayTextColor.WHITE
  ) {
    console.log(chalk`{${color} ${formatMessage(message, variable)}}`);
  }

  section(title: string, info?: string): void {
    const cols = Math.min(process.stdout.columns || 60, 60);
    const head = `── ${title} `;
    console.log(chalk.cyan(head + "─".repeat(Math.max(0, cols - head.length))));
    if (info) console.log(chalk.grey(` ${info}`));
    console.log("");
  }

  awaitInput(
    message: Msg,
    variable: Record<string, string> = {},
    defaultValue = ""
  ): string {
    const input = this.prompt(formatMessage(message, variable) + " ", defaultValue);
    if (typeof input === "string" && input.trim().toLowerCase() === "q") {
      throw new BackToMenu();
    }
    return input;
  }

  awaitInputWithBack(
    message: Msg,
    variable: Record<string, string> = {}
  ): string | typeof GO_BACK_SIGNAL {
    this.displayMessage(Msg.GO_BACK_HINT, {}, DisplayTextColor.SECONDARY);
    const input = this.prompt(formatMessage(message, variable) + " ");

    if (!input || input.trim() === "" || input.trim().toLowerCase() === "q") {
      return GO_BACK_SIGNAL;
    }
    return input;
  }

  nextTask(): void {
    this.progress++;
    this.update();
  }

  setTask(task: number): void {
    this.progress = task;
    this.update();
  }

  setCondition(new_condition: Partial<Condition>): void {
    Object.assign(this.condition, new_condition);
  }

  appendDownloadLog(
    message: Msg,
    variable: Record<string, string> = {},
    color: DisplayTextColor = DisplayTextColor.WHITE
  ): void {
    const logEntry = chalk`{${color} ${formatMessage(message, variable)}}`;
    this.condition.download_log.unshift(logEntry);
    if (this.condition.download_log.length > config.logSize) {
      this.condition.download_log.length = config.logSize;
    }
  }

  private displayHeader(): void {
    this.displayMessage(
      Msg.HEADER,
      {
        id: collection.id.toString(),
        name: collection.name,
        mode: config.mode.toString(),
        mirror: config.mirrorRotation ? "switch" : config.mirror,
      },
      DisplayTextColor.PRIMARY
    );
  }

  private p_input_id(): void {
    if (this.condition.retry_input) {
      this.displayMessage(Msg.INPUT_ID_ERR, {}, DisplayTextColor.DANGER);
    }
  }

  private p_fetch_brief_info(): void {
    this.displayMessage(Msg.FETCH_BRIEF_INFO, {
      id: collection.id.toString(),
    });
  }

  private p_check_folder(): void {
    if (!this.condition.missing_log_found) {
      this.displayMessage(Msg.CREATING_FOLDER, { name: collection.name });
    } else {
      this.displayMessage(Msg.PREVIOUS_DOWNLOAD_FOUND);

      if (this.condition.retry_missing_log_input) {
        this.displayMessage(
          Msg.INPUT_CONTINUE_DOWNLOAD_ERR,
          {},
          DisplayTextColor.DANGER
        );
      }
    }
  }

  private p_fetch_collection(): void {
    this.displayMessage(Msg.FETCH_DATA, {
      amount: this.condition.fetched_collection.toString(),
      total: collection.beatMapCount.toString(),
    });
  }

  private p_generate_osdb(): void {
    this.displayMessage(Msg.GENERATE_OSDB, { name: collection.name });
  }

  private p_download(): void {
    if (this.condition.remaining_downloads !== null) {
      this.displayMessage(Msg.REMAINING_DOWNLOADS, {
        amount: this.condition.remaining_downloads.toString(),
      });
    }

    const activeMirrors = this.condition.mirror_stats.filter(
      (s) => s.ok > 0 || s.fail > 0 || s.active > 0 || s.notfound > 0
    );
    if (activeMirrors.length > 0) {
      const parts = activeMirrors.map((s) => {
        const name = s.banned
          ? chalk`{magenta ${s.mirror}}`
          : chalk`{white ${s.mirror}}`;
        const fail = s.fail > 0 ? chalk` {red ${s.fail}}` : "";
        const notfound = s.notfound > 0 ? chalk` {blue ${s.notfound}}` : "";
        const active = s.active > 0 ? chalk` {grey ${s.active}}` : "";
        return name + chalk` {green ${s.ok}}` + fail + notfound + active;
      });
      console.log(chalk`{cyanBright Mirrors:} ` + parts.join(chalk`{grey  |  }`));
    }

    this.displayMessage(Msg.DOWNLOAD_FILES, {
      amount: this.condition.downloaded_beatmapset.toString(),
      total: collection.beatMapSetCount.toString(),
    });

    this.displayMessage(Msg.DOWNLOAD_LOG, {
      log: this.condition.download_log.join("\n"),
    });
  }
}
