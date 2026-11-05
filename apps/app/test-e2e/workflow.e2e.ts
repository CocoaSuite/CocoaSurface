// The main workflow in a browser: open a model, paint, use a .cocoamat in a fill layer, undo, save, reopen,
// and export the texture set and the fill's material as .cocoamat files that the CocoaWorlds reader accepts.
// Run with `npm run test:e2e` after `npm run build:renderer`. Needs and a Chromium: set CHROMIUM to its path, or have Playwright's installed.
import { test } from 'vitest';
import { encodePng, evaluable, outputNodes, readCocoaMat } from '@cocoasurface/materials';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const here = import.meta.dirname;
const dist = path.join(here, '../dist/renderer');
const fixtures = path.join(here, '../../../packages/materials/test/fixtures');
const tmp = mkdtempSync(path.join(tmpdir(), 'cs-e2e-'));

function sphere(file) {
  const v = [], t = [], f = [], R = 32, S = 16;
  for (let j = 0; j <= S; j++)
    for (let i = 0; i <= R; i++) {
      const th = (Math.PI * j) / S, ph = (2 * Math.PI * i) / R;
      v.push(`v ${Math.sin(th) * Math.cos(ph)} ${Math.cos(th)} ${Math.sin(th) * Math.sin(ph)}`);
      t.push(`vt ${i / R} ${1 - j / S}`);
    }
  for (let j = 0; j < S; j++)
    for (let i = 0; i < R; i++) {
      const a = j * (R + 1) + i + 1, b = a + 1, c = a + R + 1, d = c + 1;
      f.push(`f ${a}/${a} ${b}/${b} ${c}/${c}`, `f ${b}/${b} ${d}/${d} ${c}/${c}`);
    }
  writeFileSync(file, ['o Ball', 'usemtl Skin', ...v, ...t, ...f].join('\n'));
}

const types = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.html': 'text/html' };

test('paint, fill with a material, save, reopen and export', async () => {
  const model = path.join(tmp, 'ball.obj');
  sphere(model);
  const srv = createServer(async (q, r) => {
    const u = decodeURIComponent(q.url.split('?')[0]);
    const p = path.join(dist, u === '/' ? 'index.html' : u);
    try {
      r.setHeader('content-type', types[path.extname(p)] ?? 'application/octet-stream');
      r.end(await readFile(p));
    } catch {
      r.statusCode = 404;
      r.end();
    }
  }).listen(0);
  const port = srv.address().port;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }, 300_000);
  const errors = [];
  try {
    const pg = await browser.newPage({ viewport: { width: 1440, height: 860 }, acceptDownloads: true }, 300_000);
    pg.on('pageerror', (e) => errors.push(e.message));
    pg.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    const open = async (trigger, files) => {
      const fc = pg.waitForEvent('filechooser');
      await trigger();
      await (await fc).setFiles(files);
    };
    const download = async (trigger, name) => {
      const d = pg.waitForEvent('download');
      await trigger();
      const file = path.join(tmp, name);
      await (await d).saveAs(file);
      return file;
    };
    const stats = () =>
      pg.evaluate(() => {
        const g = [...window.surface.engine.sets.values()][0];
        const o = {};
        for (const [k, t] of g.display) {
          const px = g.p.read(t);
          let s = 0;
          for (let i = 0; i < px.length; i += 4) s += px[i] + px[i + 1] + px[i + 2];
          o[k] = Math.round(s / (px.length / 4));
        }
        return o;
      }, 300_000);

    await pg.goto(`http://localhost:${port}/?inspect`);
    await open(() => pg.getByText('New project from a model…').first().click(), model);
    await pg.waitForSelector('canvas.cs-gl');
    await pg.getByRole('button', { name: 'Texture Set Settings' }).click();
    await pg.locator('.cs-tsets select').first().selectOption('512');
    await pg.waitForTimeout(500);
    const base = await stats();

    await pg.getByLabel('New paint layer').click();
    const box = await pg.locator('canvas.cs-gl').boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await pg.mouse.move(cx - 120, cy);
    await pg.mouse.down();
    for (let i = 0; i <= 24; i++) await pg.mouse.move(cx - 120 + i * 10, cy + Math.sin(i / 4) * 30);
    await pg.mouse.up();
    await pg.waitForTimeout(500);
    const painted = await stats();
    assert.notEqual(painted.color, base.color, 'painting changes the colour');

    await open(() => pg.getByLabel('Import materials').click(), [path.join(fixtures, 'bricks.cocoamat')]);
    await pg.locator('.cs-shitem').first().waitFor();
    await pg.locator('.cs-shitem').first().dblclick();
    await pg.waitForTimeout(3000);
    const filled = await stats();
    assert.notEqual(filled.color, painted.color, 'the material fills the layer');

    await pg.keyboard.press('Control+z');
    await pg.waitForTimeout(1000);
    assert.deepEqual(await stats(), painted, 'undo takes the fill away');
    await pg.keyboard.press('Control+Shift+z');
    await pg.waitForTimeout(2500);
    assert.deepEqual(await stats(), filled, 'redo puts it back');

    const saved = await download(() => pg.keyboard.press('Control+s'), 'saved.cocoasurf');
    await pg.locator('.cs-lr', { hasText: 'Red bricks' }).click();
    const exported = await download(() => pg.getByText('Export with these values…').click(), 'bricks-out.cocoamat');
    await pg.getByRole('button', { name: 'File' }).click();
    const setFile = await download(() => pg.getByText('Export texture set as material…').click(), 'set.cocoamat');

    await pg.reload();
    await open(() => pg.getByText('Open…').first().click(), saved);
    await pg.waitForSelector('canvas.cs-gl');
    await pg.waitForTimeout(4000);
    assert.deepEqual(await stats(), filled, 'the reopened project looks the same');
    assert.ok(await pg.evaluate(() => [...window.surface.engine.sets.values()][0].pixels.size > 0), 'painted pixels come back');

    for (const f of [exported, setFile]) {
      const r = await readCocoaMat(new Uint8Array(readFileSync(f)));
      assert.equal(r.ok, true, r.ok ? '' : r.error);
      assert.ok(outputNodes(evaluable(r.value)).size > 0);
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    srv.close();
  }
}, 300_000);

test('masks: black and white, painted, generated and image items', async () => {
  const model = path.join(tmp, 'ball2.obj');
  sphere(model);
  const half = new Uint8Array(64 * 64);
  for (let i = 0; i < half.length; i++) half[i] = i % 64 < 32 ? 0 : 255;
  const picture = path.join(tmp, 'half.png');
  writeFileSync(picture, await encodePng(64, 64, 1, half));
  const srv = createServer(async (q, r) => {
    const u = decodeURIComponent(q.url.split('?')[0]);
    const p = path.join(dist, u === '/' ? 'index.html' : u);
    try {
      r.setHeader('content-type', types[path.extname(p)] ?? 'application/octet-stream');
      r.end(await readFile(p));
    } catch {
      r.statusCode = 404;
      r.end();
    }
  }).listen(0);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [];
  try {
    const pg = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    pg.on('pageerror', (e) => errors.push(e.message));
    pg.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    const open = async (trigger, files) => {
      const fc = pg.waitForEvent('filechooser');
      await trigger();
      await (await fc).setFiles(files);
    };
    const rough = () =>
      pg.evaluate(() => {
        const g = [...window.surface.engine.sets.values()][0];
        const px = g.p.read(g.display.get('roughness'));
        let s = 0, s2 = 0;
        const n = px.length / 4;
        for (let i = 0; i < px.length; i += 4) (s += px[i]), (s2 += px[i] * px[i]);
        return { mean: s / n, sd: Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2)) };
      });
    await pg.goto(`http://localhost:${srv.address().port}/?inspect`);
    await open(() => pg.getByText('New project from a model…').first().click(), model);
    await pg.waitForSelector('canvas.cs-gl');
    await pg.getByRole('button', { name: 'Texture Set Settings' }).click();
    await pg.locator('.cs-tsets select').first().selectOption('512');
    await pg.getByLabel('New fill layer').click();
    const r0 = pg.locator('.cs-props .cs-f', { hasText: 'Roughness' }).locator('input.cs-input').last();
    await r0.fill('0');
    await r0.press('Enter');
    await pg.waitForTimeout(500);
    const shown = await rough();
    assert.ok(shown.mean < 5, 'with no mask the fill shows everywhere');

    await pg.getByRole('button', { name: 'Add black mask' }).click();
    await pg.waitForTimeout(500);
    const hidden = await rough();
    assert.ok(hidden.mean > 140, 'a black mask hides it');

    const box = await pg.locator('canvas.cs-gl').boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await pg.mouse.move(cx - 100, cy);
    await pg.mouse.down();
    for (let i = 0; i <= 20; i++) await pg.mouse.move(cx - 100 + i * 10, cy);
    await pg.mouse.up();
    await pg.waitForTimeout(500);
    const drawn = await rough();
    assert.ok(drawn.mean < hidden.mean && drawn.sd > 5, 'painting white in the mask shows the fill there');

    await pg.locator('.cs-props .cs-chip', { hasText: 'Image' }).click();
    await pg.locator('.cs-props .cs-f', { hasText: 'Image' }).getByRole('button').first().click();
    await open(() => pg.locator('.cs-props').getByRole('button', { name: 'Your own picture…' }).click(), picture);
    await pg.waitForTimeout(1500);
    const pictured = await rough();
    assert.ok(Math.abs(pictured.mean - 153 / 2) < 25, 'an image in the mask shows half the fill');

    await pg.locator('.cs-props').getByRole('radio', { name: 'White', exact: true }).first().click();
    await pg.waitForTimeout(300);

    const d = pg.waitForEvent('download');
    await pg.keyboard.press('Control+s');
    const saved = path.join(tmp, 'masks.cocoasurf');
    await (await d).saveAs(saved);
    const before = await rough();
    await pg.reload();
    await open(() => pg.getByText('Open…').first().click(), saved);
    await pg.waitForSelector('canvas.cs-gl');
    await pg.waitForTimeout(3000);
    const after = await rough();
    assert.ok(Math.abs(after.mean - before.mean) < 1, 'the mask comes back with the project');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    srv.close();
  }
}, 300_000);
