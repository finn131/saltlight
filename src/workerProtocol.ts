import { World, type WorldJSON, type CellDelta } from './game/world';
import { Mote, type MoteJSON } from './game/drone';
import { parse } from './vm/parser';
import { Interp, OpCapError, RuntimeError } from './vm/interp';
import { makeBuiltins } from './vm/builtins';

export type ToWorker =
  | { type: 'init'; world: WorldJSON; mote: MoteJSON }
  | { type: 'run'; source: string; programId: string }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'step'; slices?: number }
  | { type: 'setSpeed'; multiplier: number }
  | { type: 'snapshot'; requestId: string };

export type ErrorPhase = 'tokenize' | 'parse' | 'runtime';

export type FromWorker =
  | { type: 'ready'; version: string }
  | { type: 'started'; programId: string }
  | { type: 'tick'; cells: CellDelta[] }
  | { type: 'event'; kind: string; x: number; y: number; h: number; data: Record<string, unknown> }
  | { type: 'console'; lines: string[] }
  | { type: 'stepped'; line: number; locals: Record<string, unknown> }
  | { type: 'paused' }
  | { type: 'resumed' }
  | { type: 'snapshot'; requestId: string; world: WorldJSON; mote: MoteJSON; locals: Record<string, unknown> }
  | { type: 'error'; message: string; line: number; col: number; phase: ErrorPhase }
  | { type: 'aborted'; reason: 'op_cap'; ops: number };

export const PROTOCOL_VERSION = '1.0.0';
export const BASE_INTERVAL_MS = 16;

export type Scheduler = {
  setTimeout: (handler: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
};

export class WorkerRuntime {
  private world: World | null = null;
  private mote: Mote | null = null;
  private interp: Interp | null = null;
  private paused = true;
  private multiplier = 1;
  private timerId: number | null = null;
  private scheduler: Scheduler;
  private post: (m: FromWorker) => void;
  private hardCap: number | undefined;

  constructor(post: (m: FromWorker) => void, opts?: { scheduler?: Scheduler; hardCap?: number }) {
    this.post = post;
    this.hardCap = opts?.hardCap;
    this.scheduler = opts?.scheduler ?? {
      setTimeout: (h, ms) => setTimeout(h, ms),
      clearTimeout: (id) => clearTimeout(id),
    };
  }

  intervalFor(m: number): number {
    return m <= 0 ? 0 : BASE_INTERVAL_MS / m;
  }

  handle(msg: ToWorker): void {
    switch (msg.type) {
      case 'init': return this.init(msg.world, msg.mote);
      case 'run': return this.run(msg.source, msg.programId);
      case 'pause': return this.pause();
      case 'resume': return this.resume();
      case 'step': return this.step(msg.slices ?? 1);
      case 'setSpeed': return this.setSpeed(msg.multiplier);
      case 'snapshot': return this.snapshot(msg.requestId);
    }
  }

  private init(worldJson: WorldJSON, moteJson: MoteJSON): void {
    this.world = World.fromJSON(worldJson);
    this.mote = Mote.fromJSON(moteJson);
    this.world.takeDirty();
    this.post({ type: 'ready', version: PROTOCOL_VERSION });
  }

  private run(source: string, programId: string): void {
    let stmts;
    try {
      stmts = parse(source);
    } catch (e) {
      this.post({
        type: 'error',
        message: e instanceof Error ? e.message : String(e),
        line: (e as { line?: number }).line ?? 0,
        col: (e as { col?: number }).col ?? 0,
        phase: (e as { name?: string }).name === 'TokenizeError' ? 'tokenize' : 'parse',
      });
      return;
    }

    this.interp = new Interp(stmts, { hardCap: this.hardCap, world: this.world, mote: this.mote });
    this.paused = false;
    this.post({ type: 'started', programId });
    this.scheduleNext();
  }

  private pause(): void {
    this.clearTimer();
    this.paused = true;
    this.post({ type: 'paused' });
  }

  private resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.scheduleNext();
    this.post({ type: 'resumed' });
  }

  private step(slices: number): void {
    this.clearTimer();
    this.paused = true;
    const n = Math.max(1, slices);
    for (let i = 0; i < n; i++) {
      if (!this.runSlice()) break;
    }
    this.flushSideEffects();
    this.post({ type: 'stepped', line: this.currentLine(), locals: this.snapshotLocals() });
  }

  private setSpeed(m: number): void {
    this.multiplier = m;
    if (!this.paused) {
      this.clearTimer();
      this.scheduleNext();
    }
  }

  private snapshot(requestId: string): void {
    if (!this.world || !this.mote) return;
    this.post({
      type: 'snapshot',
      requestId,
      world: this.world.toJSON(),
      mote: this.mote.toJSON(),
      locals: this.snapshotLocals(),
    });
  }

  private scheduleNext(): void {
    if (this.paused) return;
    const interval = this.intervalFor(this.multiplier);
    if (interval <= 0) return;
    this.timerId = this.scheduler.setTimeout(() => this.onTimer(), interval);
  }

  private clearTimer(): void {
    if (this.timerId !== null) {
      this.scheduler.clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  private onTimer(): void {
    this.timerId = null;
    if (this.paused) return;
    this.runSlice();
    this.flushSideEffects();
    if (!this.paused) this.scheduleNext();
  }

  private runSlice(): boolean {
    if (!this.interp) return false;
    try {
      const r = this.interp.step();
      return r === 'slice';
    } catch (e) {
      this.handleError(e);
      return false;
    }
  }

  private handleError(e: unknown): void {
    this.paused = true;
    this.clearTimer();
    if (e instanceof OpCapError) {
      this.post({ type: 'aborted', reason: 'op_cap', ops: e.ops });
      return;
    }
    const isRuntime = e instanceof RuntimeError;
    this.post({
      type: 'error',
      message: e instanceof Error ? e.message : String(e),
      line: isRuntime ? e.line : ((e as { line?: number }).line ?? 0),
      col: isRuntime ? (e.col ?? 0) : ((e as { col?: number }).col ?? 0),
      phase: isRuntime ? 'runtime' : ((e as { name?: string }).name === 'TokenizeError' ? 'tokenize' : 'parse'),
    });
  }

  private flushSideEffects(): void {
    if (this.world) {
      const cells = this.world.takeDirty();
      if (cells.length > 0) this.post({ type: 'tick', cells });
    }
    if (this.mote && this.mote.pending.length > 0) {
      const events = this.mote.pending.splice(0, this.mote.pending.length);
      for (const ev of events) {
        this.post({
          type: 'event',
          kind: ev.kind,
          x: Number(ev.ctx['x'] ?? 0),
          y: Number(ev.ctx['y'] ?? 0),
          h: Number(ev.ctx['h'] ?? 0),
          data: ev.ctx,
        });
      }
      if (this.interp) {
        try {
          this.mote.dispatch((fn, ctx) => this.interp!.callRule(fn, ctx));
        } catch (e) {
          this.handleError(e);
          return;
        }
        if (this.mote.pending.length > 0) {
          const deferred = this.mote.pending.splice(0, this.mote.pending.length);
          for (const ev of deferred) {
            this.post({
              type: 'event',
              kind: ev.kind,
              x: Number(ev.ctx['x'] ?? 0),
              y: Number(ev.ctx['y'] ?? 0),
              h: Number(ev.ctx['h'] ?? 0),
              data: ev.ctx,
            });
          }
        }
      }
    }
    if (this.interp && this.interp.reports.length > 0) {
      this.post({ type: 'console', lines: [...this.interp.reports] });
      this.interp.reports.length = 0;
    }
  }

  private currentLine(): number {
    return this.interp?.lastLine ?? 0;
  }

  private snapshotLocals(): Record<string, unknown> {
    if (!this.interp) return {};
    const env = this.interp.getEnv();
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(env)) {
      if (typeof v === 'function') continue;
      out[k] = v;
    }
    return out;
  }
}