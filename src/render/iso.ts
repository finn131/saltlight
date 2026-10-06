import type { Cell } from '../game/world';

export const TILE_W = 64;
export const TILE_H = 32;
export const TILE_Z = 16;

export function project(x: number, y: number, h: number): { sx: number; sy: number } {
  return {
    sx: (x - y) * (TILE_W / 2),
    sy: (x + y) * (TILE_H / 2) - h * TILE_Z,
  };
}

export function drawOrder(a: Cell, b: Cell): number {
  const da = a.x + a.y;
  const db = b.x + b.y;
  if (da !== db) return da - db;
  return a.h - b.h;
}