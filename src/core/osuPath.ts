import _path from "path";
import { config } from "../state";
import { Msg } from "../struct/Message";
import Monitor, { FreezeCondition } from "./Monitor";
import { isValidOsuFolder } from "../util";

export function trySetOsuPath(input: string): boolean {
  if (!input) return false;
  const fullPath = _path.isAbsolute(input) ? input : _path.resolve(input);
  if (isValidOsuFolder(fullPath)) {
    config.osuPath = fullPath;
    return true;
  }
  return false;
}

export function ensureOsuPath(monitor: Monitor): boolean {
  if (config.isOsuPathValid()) return true;
  const input = monitor.awaitInput(Msg.SETUP_OSU_PATH, {}, "");
  if (trySetOsuPath(input)) {
    config.save();
    return true;
  }
  monitor.freeze(Msg.SETUP_OSU_PATH_INVALID, {}, FreezeCondition.WARNING);
  return false;
}
