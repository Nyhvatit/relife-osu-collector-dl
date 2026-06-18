import Logger, { DiagnosticsData } from "./Logger";
import { Mirror } from "../struct/Constant";

export default class RunDiagnostics {
  private readonly t0 = Date.now();
  private readonly rl = new Map<Mirror, number>();
  private readonly okMs = new Map<Mirror, number>();
  private readonly failMs = new Map<Mirror, number>();
  private readonly giveUps: DiagnosticsData["giveUps"] = [];
  private readonly events: string[] = [];
  private idleTicks = 0;
  private lastOkAt = this.t0;

  private stamp(): string {
    return `+${((Date.now() - this.t0) / 1000).toFixed(1)}s`;
  }

  event(msg: string): void {
    this.events.push(`[${this.stamp()}] ${msg}`);
  }

  rateLimit(mirror: Mirror): void {
    this.rl.set(mirror, (this.rl.get(mirror) ?? 0) + 1);
  }

  idle(): void {
    this.idleTicks++;
  }

  download(mirror: Mirror, ok: boolean, ms: number): void {
    if (ok) {
      this.okMs.set(mirror, (this.okMs.get(mirror) ?? 0) + ms);
      this.lastOkAt = Date.now();
    } else {
      this.failMs.set(mirror, (this.failMs.get(mirror) ?? 0) + ms);
    }
  }

  giveUp(id: number, reason: string, attempts: number, rlHits: number, failed: string[]): void {
    this.giveUps.push({ id, reason, attempts, rlHits, failed, at: this.stamp() });
  }

  dump(
    mirrors: Mirror[],
    statsOf: (m: Mirror) => { ok: number; fail: number; notfound: number },
    isBanned: (m: Mirror) => boolean,
    totalDownloaded: number,
    totalMissing: number
  ): void {
    Logger.generateDiagnosticsLog({
      durationMs: Date.now() - this.t0,
      tailIdleMs: Date.now() - this.lastOkAt,
      idleTicks: this.idleTicks,
      totalDownloaded,
      totalMissing,
      mirrors: mirrors.map((m) => {
        const s = statsOf(m);
        return {
          mirror: m,
          ok: s.ok,
          fail: s.fail,
          notfound: s.notfound,
          rl: this.rl.get(m) ?? 0,
          banned: isBanned(m),
          okMs: this.okMs.get(m) ?? 0,
          failMs: this.failMs.get(m) ?? 0,
        };
      }),
      giveUps: this.giveUps,
      events: this.events,
    });
  }
}
