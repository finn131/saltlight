// @ts-nocheck
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(specifier + '.ts', context);
    }
    return nextResolve(specifier, context);
  },
});

const { project, drawOrder, TILE_W, TILE_H, TILE_Z } = await import('../src/render/iso.ts');
const { createCamera, clampZoom, clampPan, viewport, cullCells, screenBounds } = await import('../src/render/camera.ts');

const cell = (x, y, h) => ({ x, y, h, terrain: 'soil', plant: null, growth: 0, moisture: 0 });

// --- acceptance 4: projection offsets, including negative heights -------------------------

test('acceptance 4: h=0, h=1, h=-3 project to correct screen offsets', () => {
  assert.deepEqual(project(0, 0, 0), { sx: 0, sy: 0 });
  assert.deepEqual(project(0, 0, 1), { sx: 0, sy: -TILE_Z });
  assert.deepEqual(project(0, 0, -3), { sx: 0, sy: TILE_Z * 3 });
});

test('iso: x and y drive the diamond axes', () => {
  assert.equal(project(1, 0, 0).sx, TILE_W / 2);
  assert.equal(project(0, 1, 0).sx, -TILE_W / 2);
  assert.equal(project(1, 0, 0).sy, TILE_H / 2);
  assert.equal(project(0, 1, 0).sy, TILE_H / 2);
});

// --- acceptance 5: painter sort by (x + y) then h ----------------------------------------

test('acceptance 5: drawOrder sorts by (x+y) then h', () => {
  assert.ok(drawOrder(cell(0, 0, 0), cell(1, 1, 0)) < 0, 'lower x+y draws first');
  assert.ok(drawOrder(cell(3, 3, 0), cell(0, 0, 0)) > 0, 'higher x+y draws later');
  assert.ok(drawOrder(cell(1, 2, 0), cell(1, 2, 2)) < 0, 'same diagonal, lower h first');
  assert.equal(drawOrder(cell(1, 2, 1), cell(1, 2, 1)), 0, 'same diagonal and h is a tie');
});

test('drawOrder: a full 3x3 grid sorts back-to-front', () => {
  const grid = [];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) grid.push(cell(x, y, 0));
  grid.sort(drawOrder);
  const diagonals = grid.map((c) => c.x + c.y);
  for (let i = 1; i < diagonals.length; i++) {
    assert.ok(diagonals[i] >= diagonals[i - 1], 'diagonal index never decreases');
  }
});

test('camera: clampZoom holds the documented 0.75x to 3x range', () => {
  const cam = createCamera(20, 20);
  assert.equal(clampZoom(cam, 0.1), 0.75);
  assert.equal(clampZoom(cam, 99), 3);
  assert.equal(clampZoom(cam, 2), 2);
});

test('camera: clampPan keeps the camera inside the world box', () => {
  const cam = createCamera(20, 20);
  cam.x = 99999;
  cam.y = -99999;
  clampPan(cam, 320, 200);
  assert.ok(Number.isFinite(cam.x) && Number.isFinite(cam.y), 'pan stays finite');
  // Panning far out must still leave the world reachable, never blank the canvas.
  const vp = viewport(cam, 320, 200);
  const all = [];
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) all.push(cell(x, y, 0));
  assert.ok(cullCells(all, vp, 320, 200).length > 0, 'at least some of the world stays visible at the pan clamp');
});

// --- acceptance 7: culling ------------------------------------------------------------------

test('acceptance 7: cullCells drops cells outside the viewport', () => {
  const cam = createCamera(40, 40);
  const vp = viewport(cam, 320, 200);
  const all = [];
  for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) all.push(cell(x, y, 0));

  const visible = cullCells(all, vp, 320, 200);
  assert.ok(visible.length > 0, 'something is visible at the origin');
  assert.ok(visible.length < all.length, 'off-screen cells are culled');
  const b = screenBounds(vp, 320, 200);
  for (const c of visible) {
    const { sx, sy } = project(c.x, c.y, c.h);
    const px = vp.originX + sx * vp.zoom;
    const py = vp.originY + sy * vp.zoom;
    assert.ok(px >= b.left && px <= b.right, `px inside bounds`);
    assert.ok(py >= b.top && py <= b.bottom, `py inside bounds`);
  }
});

test('cullCells: a tighter viewport keeps fewer cells', () => {
  const cam = createCamera(40, 40);
  const all = [];
  for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) all.push(cell(x, y, 0));

  const wide = cullCells(all, viewport(cam, 1200, 900), 1200, 900);
  const tight = cullCells(all, viewport(cam, 320, 200), 320, 200);
  assert.ok(tight.length < wide.length, 'smaller canvas draws fewer cells');
});

test('cullCells: zooming out reveals more cells', () => {
  const cam = createCamera(40, 40);
  const all = [];
  for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) all.push(cell(x, y, 0));

  cam.zoom = 0.75;
  const far = cullCells(all, viewport(cam, 320, 200), 320, 200).length;
  cam.zoom = 3;
  const near = cullCells(all, viewport(cam, 320, 200), 320, 200).length;
  assert.ok(far >= near, 'zoomed out covers at least as much ground');
});