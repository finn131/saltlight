import type { ToWorker, FromWorker, ErrorPhase } from './workerProtocol';
import type { WorldJSON, CellDelta } from './game/world';
import type { MoteJSON } from './game/drone';

export type WorkerHandlers = {
  ready?: (version: string) => void;
  started?: (programId: string) => void;
  tick?: (
    cells: CellDelta[],
    mote: { x: number; y: number; h: number; facing: string },
    state: { credits: number; inventory: Record<string, number>; upgrades: Record<string, number> }
  ) => void;
  event?: (kind: string, x: number, y: number, h: number, data: Record<string, unknown>) => void;
  console?: (lines: string[]) => void;
  stepped?: (line: number, locals: Record<string, unknown>) => void;
  paused?: () => void;
  resumed?: () => void;
  snapshot?: (data: { requestId: string; world: WorldJSON; mote: MoteJSON; locals: Record<string, unknown> }) => void;
  error?: (data: { message: string; line: number; col: number; phase: ErrorPhase }) => void;
  aborted?: (data: { reason: 'op_cap'; ops: number }) => void;
};

export class WorkerClient {
  private worker: Worker;
  private handlers: WorkerHandlers;
  private source = '';
  private factory: () => Worker;

  constructor(handlers: WorkerHandlers = {}, factory?: () => Worker) {
    this.handlers = handlers;
    this.factory = factory ?? (() => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }));
    this.worker = this.factory();
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.dispatch(e.data);
  }

  private dispatch(msg: FromWorker): void {
    switch (msg.type) {
      case 'ready': return this.handlers.ready?.(msg.version);
      case 'started': return this.handlers.started?.(msg.programId);
      case 'tick': return this.handlers.tick?.(msg.cells, msg.mote, { credits: msg.credits, inventory: msg.inventory, upgrades: msg.upgrades });
      case 'event': return this.handlers.event?.(msg.kind, msg.x, msg.y, msg.h, msg.data);
      case 'console': return this.handlers.console?.(msg.lines);
      case 'stepped': return this.handlers.stepped?.(msg.line, msg.locals);
      case 'paused': return this.handlers.paused?.();
      case 'resumed': return this.handlers.resumed?.();
      case 'snapshot': return this.handlers.snapshot?.(msg as never);
      case 'error': return this.handlers.error?.(msg);
      case 'aborted': return this.handlers.aborted?.(msg);
    }
  }

  private send(msg: ToWorker): void {
    this.worker.postMessage(msg);
  }

  init(world: WorldJSON, mote: MoteJSON): void {
    this.send({ type: 'init', world, mote });
  }

  run(source: string, programId: string): void {
    this.source = source;
    this.send({ type: 'run', source, programId });
  }

  pause(): void { this.send({ type: 'pause' }); }
  resume(): void { this.send({ type: 'resume' }); }
  step(slices = 1): void { this.send({ type: 'step', slices }); }
  setSpeed(multiplier: number): void { this.send({ type: 'setSpeed', multiplier }); }
  snapshot(requestId: string): void { this.send({ type: 'snapshot', requestId }); }

  /** Program text lives on the main thread, not the worker (Phase 3.7). */
  getSource(): string { return this.source; }

  /** Terminate and respawn the worker, keeping the source intact. */
  restart(): void {
    const src = this.source;
    this.worker.terminate();
    this.worker = this.factory();
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.dispatch(e.data);
    this.source = src;
  }

  terminate(): void {
    this.worker.terminate();
  }
}