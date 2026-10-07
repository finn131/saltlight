import type { Cell } from '../world';

export interface FogOptions {
  /** Chebyshev-ish radius in tiles around the Mote that sense() can resolve. */
  radius: number;
}

export function makeFog(radius: number) {
  return {
    senseFilter(cell: Cell, mote: { x: number; y: number; h: number }): string {
      const dx = cell.x - mote.x;
      const dy = cell.y - mote.y;
      const dh = cell.h - mote.h;
      const dist = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dh));
      if (dist > radius) return 'UNKNOWN';
      return cell.terrain;
    },
  };
}

export function inFog(cell: Cell, mote: { x: number; y: number; h: number }, radius: number): boolean {
  const dx = Math.abs(cell.x - mote.x);
  const dy = Math.abs(cell.y - mote.y);
  const dh = Math.abs(cell.h - mote.h);
  return Math.max(dx, dy, dh) > radius;
}