import { WorkerRuntime } from './workerProtocol';

// This file is the Web Worker entry point.
// It wires WorkerRuntime to the real postMessage/onmessage.
if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  const runtime = new WorkerRuntime((msg) => self.postMessage(msg));
  self.onmessage = (e: MessageEvent) => runtime.handle(e.data);
}

export { WorkerRuntime } from './workerProtocol';
export type { PROTOCOL_VERSION, ToWorker, FromWorker, Scheduler } from './workerProtocol';