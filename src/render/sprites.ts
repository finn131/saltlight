import { TERRAIN } from '../game/terrain';
import { CROPS } from '../game/crops';
import { TILE_W, TILE_H, TILE_Z } from './iso';

export type SpriteAtlas = Record<string, OffscreenCanvas>;

const TILE_CVS_H = TILE_H + TILE_Z * 2;

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, (n >> 16) + amt));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + amt));
  const b = Math.min(255, Math.max(0, (n & 0xff) + amt));
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function makeCanvas(w: number, h: number): OffscreenCanvas {
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error('OffscreenCanvas is unavailable; SaltLight needs a browser with Canvas OffscreenCanvas support');
  }
  const cvs = new OffscreenCanvas(w, h);
  const ctx = cvs.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable on OffscreenCanvas');
  return cvs;
}

export function bakeSprites(): SpriteAtlas {
  const atlas: SpriteAtlas = {};

  for (const [id, def] of Object.entries(TERRAIN)) {
    const cvs = makeCanvas(TILE_W, TILE_CVS_H);
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

    ctx.beginPath();
    ctx.moveTo(TILE_W / 2, 0);
    ctx.lineTo(0, TILE_H / 2);
    ctx.lineTo(0, TILE_H / 2 + TILE_Z);
    ctx.lineTo(TILE_W / 2, TILE_Z);
    ctx.closePath();
    ctx.fillStyle = shade(def.fill, -45);
    ctx.fill();
    ctx.strokeStyle = '#3b4650';
    ctx.stroke();

    if (def.glow) {
      ctx.globalCompositeOperation = 'lighter';
      const gd = ctx.createRadialGradient(0, 0, 0, 0, 0, TILE_W / 2);
      gd.addColorStop(0, def.glow);
      gd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gd;
      ctx.fillRect(-TILE_W / 2, -TILE_H / 2, TILE_W, TILE_H);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
    atlas[id] = cvs;
  }

  for (const [id, def] of Object.entries(CROPS)) {
    for (let s = 0; s <= def.growthSteps; s++) {
      const cvs = makeCanvas(TILE_W, TILE_H * 2);
      const ctx = cvs.getContext('2d')!;
      ctx.save();
      ctx.translate(TILE_W / 2, TILE_H / 2);
      const h = Math.max(4, Math.round(TILE_H * (0.5 + 0.5 * (s / def.growthSteps))));
      const quads = 3;
      for (let q = 0; q < quads; q++) {
        const qh = h / quads;
        const qy = -h / 2 + q * qh;
        ctx.fillStyle = def.colors.body;
        ctx.fillRect(-TILE_W / 4, qy, TILE_W / 2, qh);
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.strokeRect(-TILE_W / 4, qy, TILE_W / 2, qh);
      }
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

  const moteCvs = makeCanvas(TILE_W, TILE_CVS_H);
  const mctx = moteCvs.getContext('2d')!;
  mctx.save();
  mctx.translate(TILE_W / 2, TILE_H / 2);
  mctx.beginPath();
  mctx.moveTo(0, -TILE_H / 2);
  mctx.lineTo(TILE_W / 2, 0);
  mctx.lineTo(0, TILE_H / 2);
  mctx.lineTo(-TILE_W / 2, 0);
  mctx.closePath();
  mctx.fillStyle = '#f2c14e';
  mctx.fill();
  mctx.strokeStyle = '#1b2026';
  mctx.lineWidth = 3;
  mctx.stroke();
  mctx.beginPath();
  mctx.arc(0, -TILE_H / 6, TILE_W / 9, 0, Math.PI * 2);
  mctx.fillStyle = '#1b2026';
  mctx.fill();
  mctx.restore();
  atlas['mote'] = moteCvs;

  return atlas;
}