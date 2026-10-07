import type { Cell } from '../world';

export interface CurrentOptions {
  /** Per-tick drift in tiles, before resistance. */
  strength: number;
  /** 0..1 reduction from the currentResist upgrade. */
  resist: number;
  /** Drift direction by depth band (h). Returns unit steps. */
  directionAt(h: number): { dx: number; dy: number };
}

/**
 * Chapter 2 current: the trench pushes the Mote one step per tick, so a naive
 * path drifts. Deterministic given the Mote's h, so a program that reads
 * position() and corrects can hold a route.
 */
export function makeCurrent(opts: CurrentOptions) {
  const scale = Math.max(0, 1 - opts.resist);
  return {
    moveDrift(cell: Cell, _mote: { x: number; y: number; h: number }) {
      const d = opts.directionAt(cell.h);
      return { dx: Math.round(d.dx * opts.strength * scale), dy: Math.round(d.dy * opts.strength * scale) };
    },
  };
}

// The default trench bands: strongest near the surface, reversing mid-trench.
export function trenchDirection(h: number): { dx: number; dy: number } {
  if (h >= 0) return { dx: 1, dy: 0 };
  if (h >= -4) return { dx: 0, dy: 1 };
  return { dx: -1, dy: 0 };
}