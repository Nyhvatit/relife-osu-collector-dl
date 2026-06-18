import { existsSync } from "fs";
import _path from "path";
import { config } from "../state";
import { Msg } from "../struct/Message";
import Monitor, { DisplayTextColor } from "./Monitor";
import type { WorkingMode } from "../types";
import { Mirror } from "../struct/Constant";
import { trySetOsuPath } from "./osuPath";

const MIRROR_CHOICES: Record<string, Mirror> = {
  "1": Mirror.Catboy,
  "2": Mirror.Nerinyan,
  "3": Mirror.OsuDirect,
  "4": Mirror.Sayobot,
  "5": Mirror.Beatconnect,
  "6": Mirror.Nekoha,
};

const VALID_MODES = ["1", "2", "3", "4", "5"] as const;

export default class SettingsManager {
  constructor(private monitor: Monitor) {}

  runSetupWizard(): void {
    this.monitor.section("Setup wizard");
    this.monitor.displayMessage(Msg.SETUP_WELCOME, {}, DisplayTextColor.PRIMARY);

    this.monitor.displayMessage(Msg.SETUP_TYPE);
    let setupType: "standard" | "default" | "advanced" | null = null;
    while (!setupType) {
      const choice = this.monitor.awaitInput(Msg.SETUP_TYPE_INPUT, {}, "1");
      if (choice === "1") setupType = "standard";
      else if (choice === "2") setupType = "default";
      else if (choice === "3") setupType = "advanced";
    }

    if (setupType === "standard") {
      this.runStandardSetup();
    } else if (setupType === "default") {
      this.runDefaultSetup();
    } else {
      this.runAdvancedSetup();
    }

    config.isFirstRun = false;
    config.save();
    this.monitor.displayMessage(Msg.SETUP_COMPLETE, {}, DisplayTextColor.SUCCESS);
  }

  private runStandardSetup(): void {
    this.promptOsuPath(true);
    config.mode = 4;
    config.mirror = Mirror.Catboy;
    config.mirrorRotation = true;
  }

  private runDefaultSetup(): void {
    this.monitor.section("Default setup", "Using defaults, no questions");
    config.directory = process.cwd();
    config.mirrorRotation = false;
  }

  private runAdvancedSetup(): void {
    this.promptOsuPath(false);

    this.monitor.section("Mirror");
    this.monitor.displayMessage(Msg.SETUP_MIRROR);
    let validMirror = false;
    while (!validMirror) {
      const mirrorChoice = this.monitor.awaitInput(Msg.SETUP_MIRROR_INPUT, {}, "1");
      if (mirrorChoice in MIRROR_CHOICES) {
        config.mirror = MIRROR_CHOICES[mirrorChoice];
        validMirror = true;
      }
    }

    this.monitor.section("Working mode");
    this.monitor.displayMessage(Msg.SETUP_MODE);
    let validMode = false;
    while (!validMode) {
      const modeChoice = this.monitor.awaitInput(Msg.SETUP_MODE_INPUT, {}, "1");
      if (VALID_MODES.includes(modeChoice as typeof VALID_MODES[number])) {
        config.mode = parseInt(modeChoice) as WorkingMode;
        validMode = true;
      }
    }

    if (config.caps.dest === "dir" && (config.caps.download || config.caps.osdb)) {
      let validDir = false;
      while (!validDir) {
        const dir = this.monitor.awaitInput(Msg.SETUP_DIRECTORY, {}, process.cwd());
        if (dir && existsSync(dir)) {
          config.directory = _path.isAbsolute(dir) ? dir : _path.resolve(dir);
          validDir = true;
        } else if (!dir) {
          config.directory = process.cwd();
          validDir = true;
        } else {
          this.monitor.displayMessage(Msg.SETUP_DIRECTORY_INVALID, {}, DisplayTextColor.DANGER);
        }
      }
    }
  }

  private promptOsuPath(required: boolean): void {
    for (;;) {
      const input = this.monitor.awaitInput(Msg.SETUP_OSU_PATH, {}, "");
      if (trySetOsuPath(input)) return;
      if (input) {
        this.monitor.displayMessage(Msg.SETUP_OSU_PATH_INVALID, {}, DisplayTextColor.DANGER);
      } else if (!required) {
        return;
      }
    }
  }

  private promptYesNo(message: Msg, current: boolean): boolean {
    const input = this.monitor.awaitInput(message, {}, current ? "y" : "n");
    return input.toLowerCase() === "y";
  }

  openSettings(): boolean {
    console.clear();
    this.monitor.section("Settings", "Ent | q = back");
    this.monitor.displayMessage(Msg.SETTINGS_CURRENT, {
      osuPath: config.osuPath || "(not set)",
      directory: config.directory,
      mirror: config.mirror,
      mode: config.mode.toString(),
      parallel: config.parallel ? "Yes" : "No",
      concurrency: config.concurrency.toString(),
      skipExisting: config.skipExisting ? "Yes" : "No",
      useSubfolder: config.useSubfolder ? "Yes" : "No",
      intervalCap: config.intervalCap.toString(),
      logSize: config.logSize.toString(),
      backupRetention: config.backupRetention.toString(),
      mirrorRotation: config.mirrorRotation ? "Yes" : "No",
      noVideo: config.noVideo ? "Yes" : "No",
    });

    const choice = this.monitor.awaitInput(Msg.SETTINGS_SELECT, {}, "");

    switch (choice) {
      case "1": {
        this.monitor.section("Mirror");
        this.monitor.displayMessage(Msg.SETUP_MIRROR);
        const mirrorChoice = this.monitor.awaitInput(Msg.SETUP_MIRROR_INPUT, {}, "1");
        if (mirrorChoice in MIRROR_CHOICES) {
          config.mirror = MIRROR_CHOICES[mirrorChoice];
        }
        break;
      }
      case "2": {
        this.monitor.section("Working mode");
        this.monitor.displayMessage(Msg.SETUP_MODE);
        const modeChoice = this.monitor.awaitInput(Msg.SETUP_MODE_INPUT, {}, config.mode.toString());
        if (VALID_MODES.includes(modeChoice as typeof VALID_MODES[number])) {
          config.mode = parseInt(modeChoice) as WorkingMode;
        }
        break;
      }
      case "3": {
        const concurrency = this.monitor.awaitInput(Msg.SETTINGS_CONCURRENCY, {}, config.concurrency.toString());
        const num = parseInt(concurrency);
        if (!isNaN(num) && num >= 1 && num <= 10) {
          config.concurrency = num;
        }
        break;
      }
      case "4": {
        config.parallel = this.promptYesNo(Msg.SETTINGS_PARALLEL, config.parallel);
        break;
      }
      case "5": {
        config.skipExisting = this.promptYesNo(Msg.SETTINGS_SKIP_EXISTING, config.skipExisting);
        break;
      }
      case "6": {
        const osuPath = this.monitor.awaitInput(Msg.SETUP_OSU_PATH, {}, config.osuPath);
        if (osuPath && !trySetOsuPath(osuPath)) {
          this.monitor.displayMessage(Msg.SETUP_OSU_PATH_INVALID, {}, DisplayTextColor.DANGER);
        }
        break;
      }
      case "7": {
        const dir = this.monitor.awaitInput(Msg.SETUP_DIRECTORY, {}, config.directory);
        if (dir && existsSync(dir)) {
          config.directory = _path.isAbsolute(dir) ? dir : _path.resolve(dir);
        }
        break;
      }
      case "8": {
        config.useSubfolder = this.promptYesNo(Msg.SETTINGS_SUBFOLDER, config.useSubfolder);
        break;
      }
      case "9": {
        const cap = this.monitor.awaitInput(Msg.SETTINGS_INTERVAL_CAP, {}, config.intervalCap.toString());
        const num = parseInt(cap);
        if (!isNaN(num) && num >= 0 && num <= 120) {
          config.intervalCap = num;
        }
        break;
      }
      case "10": {
        const size = this.monitor.awaitInput(Msg.SETTINGS_LOG_SIZE, {}, config.logSize.toString());
        const num = parseInt(size);
        if (!isNaN(num) && num >= 0) {
          config.logSize = num;
        }
        break;
      }
      case "11": {
        const keep = this.monitor.awaitInput(Msg.SETTINGS_BACKUP_RETENTION, {}, config.backupRetention.toString());
        const num = parseInt(keep);
        if (!isNaN(num) && num >= 1 && num <= 1000) {
          config.backupRetention = num;
        }
        break;
      }
      case "12": {
        config.mirrorRotation = this.promptYesNo(Msg.SETTINGS_MIRROR_ROTATION, config.mirrorRotation);
        break;
      }
      case "13": {
        config.noVideo = this.promptYesNo(Msg.SETTINGS_NO_VIDEO, config.noVideo);
        break;
      }
      case "":
        return false;
      default:
        return true;
    }

    config.save();
    this.monitor.displayMessage(Msg.SETTINGS_SAVED, {}, DisplayTextColor.SUCCESS);
    return true;
  }
}
