// Cache for regular expressions (avoid creating new RegExp on each call)
const regexCache = new Map<string, RegExp>();

// Get or create cached RegExp for variable
function getRegex(key: string): RegExp {
  let regex = regexCache.get(key);
  if (!regex) {
    regex = new RegExp(`{{${key}}}`, "g");
    regexCache.set(key, regex);
  }
  return regex;
}

// Format message, replacing {{key}} placeholders with values
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
  HEADER = "Collection: {{id}} - {{name}} | Working Mode: {{mode}}\n",

  CHECK_CONNECTION_TO_SERVER = "Connecting to server...",
  NO_CONNECTION = "Unable to connect to osu-collector's server, the server may be down, or you are not connected to internet.",

  CHECK_RATE_LIMIT = "Checking for rate limitation...",
  UNABLE_TO_GET_DAILY_RATE_LIMIT = "Warning: Unable to get daily rate limit, proceeding may cause incomplete downloads.",
  DAILY_RATE_LIMIT_HIT = "Your daily download rate limit hit!",
  DAILY_RATE_LIMIT_HIT_WARN = "Warning: Your daily download rate limit hit! Continue to generate .osdb only.",
  MIRROR_SWITCHED_DUE_TO_RATE_LIMIT = "Rate limit reached. Switching mirror to {{mirror}}...",
  TO_DOWNLOADS_EXCEED_DAILY_RATE_LIMIT = "Warning: The collection size exceeds the remaining downloads limit ({{collection}} > {{limit}}), proceeding may cause incomplete downloads.",
  REMAINING_DOWNLOADS = "Remaining Downloads Available: {{amount}}",

  REQUEST_BLOCKED = "The download request is blocked. Please do not proceed with the download function to avoid potential ban.",
  RESOURCE_UNAVAILBALE = "The download request is blocked in your location for legal reasons, unable to download collection.",

  INPUT_ID = "Enter the collection ID you want to download:",
  INPUT_ID_ERR = "ID should be a number, Ex: '44' (without the quote)",

  INPUT_MODE_DESCRIPTION = "1: Download Beatmap Set only\n2: Download Beatmap Set + Generate .osdb\n3: Generate .osdb only\n4: Download Beatmap Set + Add to collection.db\n5: Add to collection.db only (instant, maps show as unknown until downloaded)\n",
  INPUT_MODE = "Please select a working mode. (Default: {{mode}}):",
  INPUT_MODE_ERR = "Invalid mode, please type '1', '2', '3' or '4' (without the quote)",

  FETCH_BRIEF_INFO = "Fetching brief info for collection {{id}}...",
  FETCH_DATA = "Fetched [ {{amount}}/{{total}} ] of beatmaps' data...",

  CREATING_FOLDER = "Creating folder {{name}}...",

  PREVIOUS_DOWNLOAD_FOUND = "There are unfinished downloads from a previous session.\n\n1: Resume those downloads\n2: Discard them and start fresh\n",
  INPUT_CONTINUE_DOWNLOAD = "Please select an option to continue. (Default: 1):",
  INPUT_CONTINUE_DOWNLOAD_ERR = "Invalid mode, please type '1' or '2' (without the quote)",

  GENERATE_OSDB = "Generating {{name}}.osdb file...",
  GENERATED_OSDB = "Generated {{name}}.osdb file successfully.",

  CHECK_OSU_RUNNING = "Checking if osu! is running...",
  OSU_IS_RUNNING_ERROR = "osu! is currently running. Please close osu! before modifying collection.db to avoid file corruption.",
  OSU_IS_RUNNING_WAIT = "osu! is currently running. Please close it to continue.",
  OSU_IS_RUNNING_PROMPT = "Press Enter to retry...",
  OSU_STILL_RUNNING = "osu! is still running. Please close it first.",
  READING_COLLECTION_DB = "Reading collection.db...",
  ADDING_TO_COLLECTION_DB = "Adding collection to collection.db...",
  COLLECTION_DB_UPDATED = "Successfully added {{count}} beatmaps to collection '{{name}}' in collection.db!",
  COLLECTION_DB_UPDATED_CONTINUE = "Added {{count}} beatmaps to '{{name}}' in collection.db. Now downloading maps...",
  COLLECTION_DB_UPDATED_LOG = "✓ Collection.db updated: '{{name}}' ({{count}} beatmaps)",
  COLLECTION_DB_BACKUP_CREATED = "Backup created: {{path}}",
  COLLECTION_DB_BACKUP_CREATED_LOG = "✓ Backup created: {{path}}",

  DOWNLOAD_FILES = "Downloaded [ {{amount}}/{{total}} ] beatmap sets...",
  DOWNLOAD_LOG = "{{log}}",
  DOWNLOADING_FILE = "Downloading [{{id}}] {{name}}",
  RETRYING_DOWNLOAD = "Retrying [{{id}}] {{name}}",
  DOWNLOADED_FILE = "Downloaded [{{id}}] {{name}}",
  SKIPPED_FILE = "Skipped [{{id}}] {{name}} (already exists)",
  DOWNLOAD_FILE_FAILED = "Failed when downloading [{{id}}] {{name}}, due to error: {{error}}",
  RATE_LIMITED = "Download request rate is limited, cooling down for one minute...",
  DOWNLOAD_COMPLETED = "Download completed.",

  PROCESS_ERRORED = "An error occurred: {{error}}",

  // Setup Wizard
  SETUP_WELCOME = "Welcome to osu-collector-dl! Let's set up your preferences.\n",
  SETUP_TYPE = "Select setup type:\n1: Standard (Recommended)\n2: Advanced\n",
  SETUP_TYPE_INPUT = "Choose (1-2):",
  SETUP_OSU_PATH = "Enter the path to your osu! game folder (e.g., C:\\osu!):",
  SETUP_OSU_PATH_INVALID = "Invalid osu! folder. Must contain Songs folder and osu!.db file.",
  SETUP_DIRECTORY = "Enter the download directory (for modes 1-3):",
  SETUP_DIRECTORY_INVALID = "Invalid path. Please enter a valid directory path.",
  SETUP_MIRROR = "Select download mirror:\n1: catboy.best (Recommended)\n2: nerinyan.moe\n3: osu.direct\n4: sayobot.cn\n5: beatconnect.io\n6: nekoha.moe\n",
  SETUP_MIRROR_INPUT = "Choose mirror (1-6):",
  SETUP_CATBOY_SERVER = "Select Catboy server:\n1: Default (catboy.best)\n2: Central (Falkenstein)\n3: US\n4: Asia (Singapore)\n",
  SETUP_CATBOY_SERVER_INPUT = "Choose server (1-4):",
  SETUP_MODE = "Select default working mode:\n1: Download only\n2: Download + Generate .osdb\n3: Generate .osdb only\n4: Download to Songs + Add to collection.db\n5: Add to collection.db only (instant)\n",
  SETUP_MODE_INPUT = "Choose mode (1-5):",
  SETUP_COMPLETE = "Setup complete! Your settings have been saved.\n",

  // Settings Menu
  SETTINGS_HEADER = "=== Settings === (Enter = Back)\n",
  SETTINGS_CURRENT = "Current settings:\n1: Mirror: {{mirror}}\n2: Download mode: {{mode}}\n3: Concurrency: {{concurrency}}\n4: Parallel downloads: {{parallel}}\n5: Skip existing maps: {{skipExisting}}\n6: osu! folder: {{osuPath}}\n7: Download directory (modes 1-3): {{directory}}\n",
  SETTINGS_SELECT = "Select option to change (1-7):",
  SETTINGS_SKIP_EXISTING = "Skip downloading maps that already exist in Songs? (y/n):",
  SETTINGS_SAVED = "Settings saved!",
  SETTINGS_PARALLEL = "Enable parallel downloads? (y/n):",
  SETTINGS_CONCURRENCY = "Enter concurrency (1-10):",

  // Input hints
  INPUT_ID_COMMANDS = "'s' = settings, 'f' = fix hashes, 'b' = backup maps",
  INPUT_ID_HINT = "Enter collection ID:",

  // Navigation
  GO_BACK_HINT = "(Press Enter without input to go back)",
  GOING_BACK = "Going back...",

  // Fix command
  FIX_START = "Download missing beatmaps from collection\n",
  FIX_INPUT_COLLECTION_ID = "Enter collection ID from osucollector.com:",
  FIX_READING_OSU_DB = "Reading osu!.db...",
  FIX_OSU_DB_COMPLETE = "Found {{count}} beatmaps in osu!.db",
  FIX_MISSING_COUNT = "Missing: {{missing}}/{{total}} beatmapsets need to be downloaded",
  FIX_ALL_DOWNLOADED = "All beatmaps are downloaded. Fixed {{fixed}}/{{total}} hashes in collection '{{name}}'.",
  FIX_HASHES_FIXING = "Fixing hashes in collection.db...",
  FIX_HASHES_COMPLETE = "Fixed {{fixed}}/{{total}} hashes in collection '{{name}}'.",
  FIX_HASHES_NONE = "All hashes in collection '{{name}}' are already correct!",
  FIX_CONFIRM_DOWNLOAD = "Download missing beatmaps? (y/n):",
  FIX_DOWNLOAD_COMPLETE = "Downloaded {{downloaded}}/{{total}} beatmapsets. Collection '{{name}}' updated in collection.db!",
  FIX_COLLECTION_STATS = "  {{name}}: {{fixed}}/{{total}} hashes fixed",
  FIX_COLLECTION_EXISTS = "Collection '{{name}}' already exists with {{count}} beatmaps.\n1: Merge (add new beatmaps)\n2: Replace (overwrite completely)\n3: Cancel\n",
  FIX_COLLECTION_EXISTS_INPUT = "Choose action (1-3):",

  // Backup command
  BACKUP_DESCRIPTION = "Backup all local beatmaps to collection.db\n\nThis will:\n  1. Read ALL beatmap hashes from your osu!.db\n  2. Add them to a 'backup maps' collection in collection.db\n  3. You can then upload this collection to osucollector.com\n     and download it on another PC using the collection ID\n\nNote: osu! must be closed during this operation.\n",
  BACKUP_CONFIRM = "Proceed with backup? (y/n):",
  BACKUP_READING_OSU_DB = "Reading all beatmaps from osu!.db...",
  BACKUP_FOUND_MAPS = "Found {{count}} beatmaps in osu!.db.",
  BACKUP_NO_MAPS = "No beatmaps found in osu!.db. Nothing to back up.",
  BACKUP_WRITING = "Writing 'backup maps' collection to collection.db...",
  BACKUP_COMPLETE = "Successfully backed up {{count}} beatmaps to collection '{{name}}' in collection.db!",
  BACKUP_CANCELLED = "Backup cancelled.",

  // Collection conflict (modes 4/5)
  COLLECTION_CONFLICT = "Collection '{{name}}' already exists with {{count}} beatmaps.\n1: Merge (add new beatmaps)\n2: Replace (overwrite completely)\n3: Rename (create '{{name}}_2')\n4: Cancel\n",
  COLLECTION_CONFLICT_INPUT = "Choose action (1-4):",
}
