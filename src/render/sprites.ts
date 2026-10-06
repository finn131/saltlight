import { TERRAIN } from '../game/terrain';
import { CROPS } from '../game/crops';
import { TILE_W, TILE_H, TILE_Z } from './iso';

export type SpriteAtlas = Record<string, OffscreenCanvas>;

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, (n >> 16) + amt));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + amt));
  const b = Math.min(255, Math.max(0, (n & 0xff) + amt));
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

export function bakeSprites(): SpriteAtlas {
  const atlas: SpriteAtlas = {};

  for (const [id, def] of Object.entries(TERRAIN)) {
    const cvs = new OffscreenCanvas(TILE_W, TILE_H + TILE_Z * 2);
    const ctx = cvs.getContext('2d')!;
    ctx.save();
    ctx.translate(TILE_W / 2, TILE_H / 2);
    ctx.beginPath();
    ctx.moveTo(0, -TILE_H / 2);
    ctx.lineTo(TILE_W / 2, 0);
    ctx.lineTo(0, TILE_H / 2);
    ctx.lineTo(-TILE_W / 2, 0);
    ctx.closePath();
    ctx.fillStyle = def.fill;
    ctx.fill();
    ctx.strokeStyle = '#3b4650';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-TILE_W / 2, 0);
    ctx.lineTo(0, TILE_H / 2);
    ctx.lineTo(0, TILE_H / 2 + TILE_Z);
    ctx.lineTo(-TILE_W / 2, TILE_Z);
    ctx.closePath();
    ctx.fillStyle = shade(def.fill, -30);
    ctx.fill();
    ctx.strokeStyle = '#3b4650';
    ctx.stroke();
    ctx.restore();
    atlas[id] = cvs;
  }

  for (const [id, def] of Object.entries(CROPS)) {
    for (let s = 0; s <= def.growthSteps; s++) {
      const cvs = new OffscreenCanvas(TILE_W, TILE_H * 2);
      const ctx = cvs.getContext('2d')!;
      ctx.save();
      ctx.translate(TILE_W / 2, TILE_H / 2);
      const h = Math.max(4, Math.round(TILE_H * (0.5 + 0.5 * (s / def.growthSteps))));
      ctx.fillStyle = def.colors.body;
      ctx.fillRect(-TILE_W / 4, -h / 2, TILE_W / 2, h);
      ctx.fillStyle = def.colors.tip;
      ctx.fillRect(-TILE_W / 4, -h / 2, TILE_W / 2, 2);
      if (def.colors.glow && s >= def.growthSteps) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = def.colors.glow;
        ctx.beginPath();
        ctx.arc(0, -h / 2, TILE_W / 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.restore();
      atlas[id + '_' + s] = cvs;
    }
  }

  return atlas;
}