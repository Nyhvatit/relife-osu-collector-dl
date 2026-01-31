import { readdirSync, readFileSync, statSync, existsSync, writeFileSync, unlinkSync } from "fs";
import { createHash } from "crypto";
import _path from "path";

export interface BeatmapHashEntry {
  beatmapId: number;
  md5: string;
}

export interface ScanProgress {
  current: number;
  total: number;
  currentFolder: string;
}

interface HashCache {
  version: number;
  lastScan: number;
  entries: Record<string, BeatmapHashEntry[]>; // folderName -> entries
}

const CACHE_VERSION = 1;
const CACHE_FILENAME = "ocdl-hash-cache.json";

export default class SongsScanner {
  private songsPath: string;
  private cachePath: string;
  private cache: HashCache | null = null;
  private hashMap: Map<number, string> = new Map(); // beatmapId -> md5
  private onProgress: ((progress: ScanProgress) => void) | null = null;

  constructor(songsPath: string) {
    this.songsPath = songsPath;
    this.cachePath = _path.join(songsPath, CACHE_FILENAME);
  }

  setProgressCallback(callback: (progress: ScanProgress) => void): void {
    this.onProgress = callback;
  }

  scan(): Map<number, string> {
    this.loadCache();

    const folders = this.getBeatmapFolders();
    const total = folders.length;
    let current = 0;

    for (const folder of folders) {
      current++;

      if (this.onProgress) {
        this.onProgress({
          current,
          total,
          currentFolder: folder,
        });
      }

      const folderPath = _path.join(this.songsPath, folder);

      // Check cache for this folder
      if (this.cache && this.cache.entries[folder]) {
        // Use cached data
        for (const entry of this.cache.entries[folder]) {
          this.hashMap.set(entry.beatmapId, entry.md5);
        }
        continue;
      }

      // Scan folder
      const entries = this.scanFolder(folderPath);

      // Save to cache
      if (this.cache) {
        this.cache.entries[folder] = entries;
      }

      for (const entry of entries) {
        this.hashMap.set(entry.beatmapId, entry.md5);
      }
    }

    this.saveCache();
    return this.hashMap;
  }

  private getBeatmapFolders(): string[] {
    try {
      return readdirSync(this.songsPath).filter((name) => {
        const fullPath = _path.join(this.songsPath, name);
        try {
          return statSync(fullPath).isDirectory() && !name.startsWith(".");
        } catch {
          return false;
        }
      });
    } catch {
      return [];
    }
  }

  private scanFolder(folderPath: string): BeatmapHashEntry[] {
    const entries: BeatmapHashEntry[] = [];

    try {
      const files = readdirSync(folderPath).filter((f) => f.endsWith(".osu"));

      for (const file of files) {
        const filePath = _path.join(folderPath, file);
        const entry = this.parseOsuFile(filePath);
        if (entry) {
          entries.push(entry);
        }
      }
    } catch {
      // Folder inaccessible, skip
    }

    return entries;
  }

  private parseOsuFile(filePath: string): BeatmapHashEntry | null {
    try {
      const content = readFileSync(filePath);
      const text = content.toString("utf-8");

      // Extract BeatmapID
      const beatmapIdMatch = text.match(/BeatmapID\s*:\s*(\d+)/);
      if (!beatmapIdMatch) {
        return null;
      }

      const beatmapId = parseInt(beatmapIdMatch[1], 10);
      if (isNaN(beatmapId) || beatmapId <= 0) {
        return null;
      }

      // Calculate MD5 hash of file
      const md5 = createHash("md5").update(content).digest("hex");

      return { beatmapId, md5 };
    } catch {
      return null;
    }
  }

  private loadCache(): void {
    try {
      if (existsSync(this.cachePath)) {
        const data = readFileSync(this.cachePath, "utf-8");
        const parsed = JSON.parse(data) as HashCache;

        if (parsed.version === CACHE_VERSION) {
          this.cache = parsed;
          return;
        }
      }
    } catch {
      // Cache corrupted or doesn't exist
    }

    // Create new cache
    this.cache = {
      version: CACHE_VERSION,
      lastScan: Date.now(),
      entries: {},
    };
  }

  private saveCache(): void {
    if (!this.cache) return;

    try {
      this.cache.lastScan = Date.now();
      writeFileSync(this.cachePath, JSON.stringify(this.cache));
    } catch {
      // Failed to save cache, not critical
    }
  }

  getHashMap(): Map<number, string> {
    return this.hashMap;
  }

  getScannedCount(): number {
    return this.hashMap.size;
  }

  // Clear cache (for rescanning)
  clearCache(): void {
    try {
      if (existsSync(this.cachePath)) {
        unlinkSync(this.cachePath);
      }
    } catch {
      // Ignore errors
    }
    this.cache = null;
    this.hashMap.clear();
  }
}
