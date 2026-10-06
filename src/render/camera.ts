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

// The diamond is symmetric about sx=0 but spans 0..extent in sy, so the world
// centre sits at sy = extent/2, not 0. Pan bounds derive from that offset.
// ponytail: bounds keep one tile of the world on screen; overscroll past the
// edge is intentional so the island rim is reachable.
export function worldExtents(c: Camera): { extentX: number; extentY: number } {
  return {
    extentX: (Math.max(c.worldW, c.worldH) - 1) * TILE_W,
    extentY: (c.worldW + c.worldH - 2) * (TILE_H / 2),
  };
}

export function clampPan(c: Camera, canvasW: number, canvasH: number): void {
  const { extentX, extentY } = worldExtents(c);
  const halfW = (extentX * c.zoom) / 2;
  const halfH = (extentY * c.zoom) / 2;
  const maxX = Math.max(0, halfW + canvasW / 2 - TILE_W);
  const maxY = Math.max(0, halfH + canvasH / 2 - TILE_H);
  c.x = Math.min(maxX, Math.max(-maxX, c.x));
  c.y = Math.min(maxY, Math.max(-maxY, c.y));
}

export interface Viewport {
  originX: number;
  originY: number;
  zoom: number;
}

export function viewport(c: Camera, canvasW: number, canvasH: number): Viewport {
  const { extentY } = worldExtents(c);
  return {
    originX: canvasW / 2 + c.x,
    originY: canvasH / 2 - (extentY * c.zoom) / 2 + c.y,
    zoom: c.zoom,
  };
}

export function screenBounds(v: Viewport, canvasW: number, canvasH: number) {
  const hw = (TILE_W / 2) * v.zoom;
  const hh = (TILE_H / 2) * v.zoom;
  const z = TILE_Z * v.zoom;
  return {
    left: v.originX - hw - z,
    top: v.originY - hh - z,
    right: v.originX + canvasW + hw + z,
    bottom: v.originY + canvasH + hh + z,
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