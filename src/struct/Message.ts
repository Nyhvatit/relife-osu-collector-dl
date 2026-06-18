const regexCache = new Map<string, RegExp>();

function getRegex(key: string): RegExp {
  let regex = regexCache.get(key);
  if (!regex) {
    regex = new RegExp(`{{${key}}}`, "g");
    regexCache.set(key, regex);
  }
  return regex;
}

export function formatMessage(
  message: Msg,
  variables: Record<string, string> = {}
): string {
  let result: string = message;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(getRegex(key), value);
  }
  return result;
}

export enum Msg {
  FREEZE = "Please press 'Enter' to {{action}}.",
  HEADER = "Collection: {{id}} - {{name}} | Working Mode: {{mode}} | Mirror: {{mirror}}\n",

  CHECK_CONNECTION_TO_SERVER = "Connecting to server...",
  NO_CONNECTION = "Unable to connect to osu-collector's server, the server may be down, or you are not connected to internet.",

  CHECK_RATE_LIMIT = "Checking for rate limitation...",
  UNABLE_TO_GET_DAILY_RATE_LIMIT = "Warning: Unable to get daily rate limit, proceeding may cause incomplete downloads.",
  DAILY_RATE_LIMIT_HIT = "Your daily download rate limit hit!",
  MIRROR_SWITCHED_DUE_TO_RATE_LIMIT = "Rate limit reached. Switching mirror to {{mirror}}...",
  TO_DOWNLOADS_EXCEED_DAILY_RATE_LIMIT = "Warning: The collection size exceeds the remaining downloads limit ({{collection}} > {{limit}}), proceeding may cause incomplete downloads.",
  REMAINING_DOWNLOADS = "Remaining Downloads Available: {{amount}}",

  REQUEST_BLOCKED = "The download request is blocked. Please do not proceed with the download function to avoid potential ban.",
  RESOURCE_UNAVAILBALE = "The download request is blocked in your location for legal reasons, unable to download collection.",

  INPUT_ID_ERR = "ID should be a number, Ex: '44' (without the quote)",

  FETCH_BRIEF_INFO = "Fetching brief info for collection {{id}}...",
  FETCH_DATA = "Fetched [ {{amount}}/{{total}} ] of beatmaps' data...",

  CREATING_FOLDER = "Creating folder {{name}}...",

  PREVIOUS_DOWNLOAD_FOUND = "There are unfinished downloads from a previous session.\n\n   1  Resume those downloads\n   2  Discard them and start fresh\n",
  INPUT_CONTINUE_DOWNLOAD = "Please select an option to continue. (Default: 1):",
  INPUT_CONTINUE_DOWNLOAD_ERR = "Invalid mode, please type '1' or '2' (without the quote)",

  GENERATE_OSDB = "Generating {{name}}.osdb file...",
  GENERATED_OSDB = "Generated {{name}}.osdb file successfully.",

  CHECK_OSU_RUNNING = "Checking if osu! is running...",
  OSU_IS_RUNNING_WAIT = "osu! is currently running. Please close it to continue.",
  OSU_IS_RUNNING_PROMPT = "Press Enter to retry...",
  OSU_STILL_RUNNING = "osu! is still running. Please close it first.",
  READING_COLLECTION_DB = "Reading collection.db...",
  ADDING_TO_COLLECTION_DB = "Adding collection to collection.db...",
  COLLECTION_DB_UPDATED = "Successfully added {{count}} beatmaps to collection '{{name}}' in collection.db!",
  COLLECTION_DB_BACKUP_CREATED = "Backup created: {{path}}",

  DOWNLOAD_FILES = "Downloaded [ {{amount}}/{{total}} ] beatmap sets...",
  DOWNLOAD_LOG = "{{log}}",
  DOWNLOADING_FILE = "Downloading [{{id}}] {{name}}",
  RETRYING_DOWNLOAD = "Retrying [{{id}}] {{name}}",
  DOWNLOADED_FILE = "Downloaded [{{id}}] {{name}}",
  SKIPPED_FILE = "Skipped [{{id}}] {{name}} (already exists)",
  DOWNLOAD_FILE_FAILED = "Failed when downloading [{{id}}] {{name}}, due to error: {{error}}",
  RATE_LIMITED = "Download request rate is limited, cooling down for one minute...",
  MIRROR_RATE_LIMITED_ROTATING = "{{mirror}} rate-limited — switching to another mirror...",
  DOWNLOAD_COMPLETED = "Download completed.",

  PROCESS_ERRORED = "An error occurred: {{error}}",

  SETUP_WELCOME = "Welcome to osu-collector-dl! Let's set up your preferences.\n",
  SETUP_TYPE = "   1  Standard (recommended)\n   2  Default (no questions)\n   3  Advanced\n",
  SETUP_TYPE_INPUT = "Choose (1-3, q=back):",
  SETUP_OSU_PATH = "Enter the path to your osu! game folder (e.g., C:\\osu!):",
  SETUP_OSU_PATH_INVALID = "Invalid osu! folder. Must contain Songs folder and osu!.db file.",
  SETUP_DIRECTORY = "Enter the download directory (for modes 1-3):",
  SETUP_DIRECTORY_INVALID = "Invalid path. Please enter a valid directory path.",
  SETUP_MIRROR = "   1  catboy.best (recommended)\n   2  nerinyan.moe (unavailable)\n   3  osu.direct\n   4  sayobot.cn\n   5  beatconnect.io\n   6  nekoha.moe\n",
  SETUP_MIRROR_INPUT = "Choose mirror (1-6, q=back):",
  SETUP_MODE = "   1  Download only\n   2  Download + generate .osdb\n   3  Generate .osdb only\n   4  Download to Songs + add to collection.db\n   5  Add to collection.db only (instant)\n",
  SETUP_MODE_INPUT = "Choose mode (1-5, q=back):",
  SETUP_COMPLETE = "Setup complete! Your settings have been saved.\n",

  SETTINGS_CURRENT = "   1  Mirror: {{mirror}}\n   2  Download mode: {{mode}}\n   3  Concurrency: {{concurrency}}\n   4  Parallel downloads: {{parallel}}\n   5  Skip existing maps: {{skipExisting}}\n   6  osu! folder: {{osuPath}}\n   7  Download directory (modes 1-3): {{directory}}\n   8  Subfolder per collection (modes 1-3): {{useSubfolder}}\n   9  Max downloads/min (intervalCap): {{intervalCap}}\n  10  Download log size: {{logSize}}\n  11  collection.db backups kept: {{backupRetention}}\n  12  Switch mirror on rate limit (no waiting): {{mirrorRotation}}\n  13  Download without video (smaller files): {{noVideo}}\n",
  SETTINGS_SELECT = ">",
  SETTINGS_MIRROR_ROTATION = "On rate limit, switch to another mirror instead of waiting 1 min? (y/n):",
  SETTINGS_NO_VIDEO = "Download the no-video (map-only) version where supported? (y/n):",
  SETTINGS_SKIP_EXISTING = "Skip downloading maps that already exist in Songs? (y/n):",
  SETTINGS_SAVED = "Settings saved!",
  SETTINGS_PARALLEL = "Enable parallel downloads? (y/n):",
  SETTINGS_CONCURRENCY = "Enter concurrency (1-10):",
  SETTINGS_SUBFOLDER = "Create a subfolder per collection (modes 1-3)? (y/n):",
  SETTINGS_INTERVAL_CAP = "Enter max downloads per minute (0-120):",
  SETTINGS_LOG_SIZE = "Enter download log size in lines:",
  SETTINGS_BACKUP_RETENTION = "Enter how many collection.db backups to keep (1-1000):",

  INPUT_ID_COMMANDS = "   s  Settings\n   f  Fix hashes\n   b  Backup maps\n   t  Tournament\n   u  User uploads\n   r  Retry failed\n",
  INPUT_ID_HINT = "Enter collection ID / URL (or a command above):",

  RETRY_FAILED_NO_FOLDER = "No 'Failed' folder found at {{path}} — nothing to retry.",
  RETRY_FAILED_NONE = "No recoverable .osz files found in the Failed folder.",
  RETRY_FAILED_CONFIRM = "Found {{count}} map(s) in Songs\\Failed. Re-download them into Songs? (y/n):",
  RETRY_FAILED_DONE = "Retry done: {{recovered}}/{{total}} re-downloaded, {{deleted}} broken file(s) removed from Failed, {{missing}} still missing.",

  GO_BACK_HINT = "(Press Enter or 'q' to go back)",

  FIX_START = "Download missing beatmaps from collection\n",
  FIX_INPUT_COLLECTION_ID = "Enter collection ID / URL (q=back):",
  FIX_READING_OSU_DB = "Reading osu!.db...",
  FIX_OSU_DB_COMPLETE = "Found {{count}} beatmaps in osu!.db",
  FIX_MISSING_COUNT = "Missing: {{missing}}/{{total}} beatmapsets need to be downloaded",
  FIX_ALL_DOWNLOADED = "All beatmaps are downloaded. Fixed {{fixed}}/{{total}} hashes in collection '{{name}}'.",
  FIX_HASHES_FIXING = "Fixing hashes in collection.db...",
  FIX_HASHES_COMPLETE = "Fixed {{fixed}}/{{total}} hashes in collection '{{name}}'.",
  FIX_CONFIRM_DOWNLOAD = "Download missing beatmaps? (y/n):",
  FIX_DOWNLOAD_COMPLETE = "Downloaded {{downloaded}}/{{total}} beatmapsets. Collection '{{name}}' updated in collection.db!",
  FIX_COLLECTION_STATS = "  {{name}}: {{fixed}}/{{total}} hashes fixed",

  BACKUP_DESCRIPTION = "Backup all local beatmaps to collection.db\n\nThis will:\n  1. Read ALL beatmap hashes from your osu!.db\n  2. Add them to a 'backup maps' collection in collection.db\n  3. You can then upload this collection to osucollector.com\n     and download it on another PC using the collection ID\n\nNote: osu! must be closed during this operation.\n",
  BACKUP_CONFIRM = "Proceed with backup? (y/n):",
  BACKUP_READING_OSU_DB = "Reading all beatmaps from osu!.db...",
  BACKUP_FOUND_MAPS = "Found {{count}} beatmaps in osu!.db.",
  BACKUP_NO_MAPS = "No beatmaps found in osu!.db. Nothing to back up.",
  BACKUP_WRITING = "Writing 'backup maps' collection to collection.db...",
  BACKUP_COMPLETE = "Successfully backed up {{count}} beatmaps to collection '{{name}}' in collection.db!",
  BACKUP_CANCELLED = "Backup cancelled.",

  TOURNAMENT_START = "Download a tournament mappool as collection(s)\n",
  TOURNAMENT_INPUT_ID = "Enter tournament ID or URL (Enter to cancel):",
  TOURNAMENT_FETCHING = "Fetching tournament {{id}}...",
  TOURNAMENT_NOT_FOUND = "Couldn't load tournament {{id}} — wrong ID/URL, or that's a user, not a tournament. Try again (or 'q' to go back).",
  TOURNAMENT_RESOLVING = "Resolving {{count}} map(s) missing metadata via mirror...",
  TOURNAMENT_UNAVAILABLE = "Note: {{count}} map(s) could not be resolved and will be skipped.",
  TOURNAMENT_STAGES_HEADER = "Tournament: {{name}}\n\nStages:\n{{list}}\n",
  TOURNAMENT_SELECT_STAGES = "Select stages (e.g. '1,3' or 'a' for all):",
  TOURNAMENT_SELECT_ERR = "Invalid selection. Type stage numbers like '1,3' or 'a'.",
  TOURNAMENT_GROUPING = "Build collections how?\n\n   1  One collection per stage\n   2  Single combined collection\n",
  TOURNAMENT_GROUPING_INPUT = "Choose (1-2, q=back):",
  TOURNAMENT_DONE = "Tournament '{{name}}' done — {{count}} collection(s) processed.",

  USER_START = "Download a user's uploaded collections / tournaments\n",
  USER_INPUT_ID = "Enter user ID or profile URL (Enter to cancel):",
  USER_FETCHING = "Fetching uploads for user {{id}}...",
  USER_NOT_FOUND = "Couldn't load user {{id}} — wrong ID/URL, or that's a tournament, not a user. Try again (or 'q' to go back).",
  USER_NONE = "This user has no uploads.",
  USER_TYPE = "This user has {{collections}} collection(s) and {{tournaments}} tournament(s).\n\n   1  Collections\n   2  Tournaments\n",
  USER_TYPE_INPUT = "Choose (1-2, q=back):",
  USER_PICK_PROMPT = ">",
  USER_TG = "For each selected tournament, build:\n\n   1  One collection per stage\n   2  One combined collection per tournament\n",
  USER_TG_INPUT = "Choose (1-2, q=back):",
  USER_DONE = "Done — {{count}} collection(s) processed.",

  COLLECTION_CONFLICT = "Collection '{{name}}' already exists with {{count}} beatmaps.\n\n   1  Merge (add new beatmaps)\n   2  Replace (overwrite completely)\n   3  Rename (create '{{name}}_2')\n   4  Cancel\n",
  COLLECTION_CONFLICT_INPUT = "Choose action (1-4, q=back):",
}
