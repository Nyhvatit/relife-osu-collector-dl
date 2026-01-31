import { existsSync, readFileSync } from "fs";
import { Collection } from "./struct/Collection";
import Config from "./struct/Config";

// Global application state
export const collection = new Collection();

const configPath = Config.configFilePath;
export const config = existsSync(configPath)
  ? new Config(readFileSync(configPath, "utf8"))
  : Config.generateConfig();
