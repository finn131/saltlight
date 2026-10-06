import type { Cell } from '../game/world';
import { TILE_W, TILE_H, TILE_Z, project } from './iso';

export interface Camera {
  x: number;
  y: number;
  zoom: number;
  minZoom: number;
  maxZoom: number;
  worldW: number;
  worldH: number;
}

export function createCamera(worldW: number, worldH: number): Camera {
  return { x: 0, y: 0, zoom: 1, minZoom: 0.75, maxZoom: 3, worldW, worldH };
}

export function clampZoom(c: Camera, z: number): number {
  return Math.min(c.maxZoom, Math.max(c.minZoom, z));
}

export function clampPan(c: Camera): void {
  const halfW = (c.worldW * TILE_W) / 2;
  const halfH = (c.worldH * TILE_H) / 2;
  const maxX = halfW * c.zoom - TILE_W;
  const maxY = halfH * c.zoom - TILE_H;
  c.x = Math.min(maxX, Math.max(-maxX, c.x));
  c.y = Math.min(maxY, Math.max(-maxY, c.y));
}

export interface Viewport {
  originX: number;
  originY: number;
  zoom: number;
}

export function viewport(c: Camera, canvasW: number, canvasH: number): Viewport {
  return {
    originX: canvasW / 2 + c.x,
    originY: canvasH / 4 + c.y,
    zoom: c.zoom,
  };
}

export function screenBounds(v: Viewport, canvasW: number, canvasH: number) {
  const hw = TILE_W / 2 * v.zoom;
  const hh = TILE_H / 2 * v.zoom;
  const z = TILE_Z * v.zoom;
  return {
    left: v.originX - hw,
    top: v.originY - hh - z * 10,
    right: v.originX + canvasW + hw,
    bottom: v.originY + canvasH + hh + z * 10,
  };
}

export function cullCells(cells: Iterable<Cell>, v: Viewport, canvasW: number, canvasH: number): Cell[] {
  const b = screenBounds(v, canvasW, canvasH);
  const out: Cell[] = [];
  for (const c of cells) {
    const { sx, sy } = project(c.x, c.y, c.h);
    const px = v.originX + sx * v.zoom;
    const py = v.originY + sy * v.zoom;
    if (px >= b.left && px <= b.right && py >= b.top && py <= b.bottom) out.push(c);
  }
  return out;
}

export { TILE_W, TILE_H, TILE_Z };