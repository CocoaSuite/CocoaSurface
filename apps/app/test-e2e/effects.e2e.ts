// Layer effects, group masks and blend modes, and the brush tools, in a browser.
import { test } from 'vitest';
import { encodePng } from '@cocoasurface/materials';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const here = import.meta.dirname;
const dist = path.join(here, '../dist/renderer');
const tmp = mkdtempSync(path.join(tmpdir(), 'cs-fx-'));
const types = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.html': 'text/html' };

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

test('effects on layers, group masks and blends, fill, smudge and blur tools', async () => {
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
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [];
  try {
    const pg = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    pg.on('pageerror', (e) => errors.push(e.message));
    pg.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    const open = async (trigger, files) => {
      const fc = pg.waitForEvent('filechooser');
      await trigger();
      await (await fc).setFiles(files);
    };
    const rough = async () => {
      await pg.waitForTimeout(200);
      await pg.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      return pg.evaluate(() => {
        const g = [...window.surface.engine.sets.values()][0];
        const px = g.p.read(g.display.get('roughness'));
        let s = 0, s2 = 0;
        const n = px.length / 4;
        for (let i = 0; i < px.length; i += 4) (s += px[i]), (s2 += px[i] * px[i]);
        return { mean: s / n, sd: Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2)) };
      });
    };
    const field = async (label, v) => {
      const f = pg.locator(`.cs-props input.cs-input[aria-label="${label}"]`).first();
      await f.fill(String(v));
      await f.press('Enter');
      await pg.waitForTimeout(400);
    };
    const chip = async (name) => {
      await pg.locator('.cs-props .cs-chip', { hasText: new RegExp(`^${name}$`) }).click();
      await pg.waitForTimeout(400);
    };
    const toLayer = async () => {
      await pg.locator('.cs-pane').getByRole('button', { name: 'Layer', exact: true }).click();
      await pg.waitForTimeout(200);
    };
    const box = async () => {
      const b = await pg.locator('canvas.cs-gl').boundingBox();
      return { cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
    };
    const stroke = async () => {
      const { cx, cy } = await box();
      await pg.mouse.move(cx - 100, cy);
      await pg.mouse.down();
      for (let i = 0; i <= 20; i++) await pg.mouse.move(cx - 100 + i * 10, cy);
      await pg.mouse.up();
      await pg.waitForTimeout(500);
    };

    await pg.goto(`http://localhost:${srv.address().port}/?inspect`);
    await open(() => pg.getByText('New project from a model…').first().click(), model);
    await pg.waitForSelector('canvas.cs-gl');
    await pg.locator('.cs-side.l select').first().selectOption('512');

    // Effects on a fill layer.
    await pg.getByLabel('New fill layer').click();
    await field('Roughness', 0);
    assert.ok((await rough()).mean < 5, 'the fill shows');
    await chip('Invert');
    assert.ok((await rough()).mean > 250, 'an Invert effect inverts the layer');
    await field('Strength', 50);
    assert.ok(Math.abs((await rough()).mean - 128) < 6, 'its strength mixes it in');
    await pg.locator('.cs-pane').getByRole('button', { name: 'Delete' }).last().click();
    await pg.waitForTimeout(400);
    assert.ok((await rough()).mean < 5, 'deleting it brings the fill back');

    await chip('Levels');
    await field('Black point', 0);
    await field('White point', 50);
    await toLayer();
    await field('Roughness', 25);
    assert.ok(Math.abs((await rough()).mean - 128) < 6, 'Levels stretch the layer');

    await chip('Paint');
    await pg.locator('.cs-props input.cs-input[aria-label="Brush roughness"]').fill('100');
    await pg.locator('.cs-props input.cs-input[aria-label="Brush roughness"]').press('Enter');
    const beforePaint = await rough();
    await stroke();
    const painted = await rough();
    assert.ok(painted.mean > beforePaint.mean && painted.sd > 5, 'a Paint effect draws on a fill layer');

    await chip('Blur');
    await field('Radius', 20);
    const blurred = await rough();
    assert.ok(blurred.sd < painted.sd, 'a Blur effect softens the layer');

    // Save and reopen: the effect's strokes come back.
    const d = pg.waitForEvent('download');
    await pg.keyboard.press('Control+s');
    const saved = path.join(tmp, 'fx.cocoasurf');
    await (await d).saveAs(saved);
    await pg.reload();
    await open(() => pg.getByText('Open…').first().click(), saved);
    await pg.waitForSelector('canvas.cs-gl');
    await pg.waitForTimeout(3000);
    const reopened = await rough();
    assert.ok(Math.abs(reopened.mean - blurred.mean) < 1 && Math.abs(reopened.sd - blurred.sd) < 1, 'effects come back with the project');

    // Groups: a mask on a group hides the layers in it; other blend modes blend the group as one.
    await pg.locator('.cs-lr', { hasText: 'Fill 2' }).hover();
    await pg.locator('.cs-lr', { hasText: 'Fill 2' }).locator('button[aria-label="Hide"]').click();
    await pg.locator('.cs-lr', { hasText: 'Base' }).click();
    await pg.getByLabel('New group').click();
    await pg.getByLabel('New fill layer').click();
    await field('Roughness', 50);
    assert.ok(Math.abs((await rough()).mean - 128) < 4, 'a fill in a group shows');
    await pg.locator('.cs-lr', { hasText: 'Group 1' }).click();
    await pg.getByRole('button', { name: 'Add black mask' }).click();
    await pg.waitForTimeout(500);
    await toLayer();
    assert.ok(Math.abs((await rough()).mean - 153) < 4, 'a black group mask hides its layers');
    await pg.locator('.cs-props').getByRole('button', { name: 'Edit the mask' }).click();
    await pg.locator('.cs-props').getByRole('radio', { name: 'White' }).first().click();
    const shownTop = await rough();
    assert.ok(Math.abs(shownTop.mean - 128) < 4, 'a white one shows them');
    await toLayer();
    await pg.locator('.cs-side.r .cs-props select').first().selectOption('multiply');
    await pg.waitForTimeout(400);
    const multiplied = await rough();
    assert.ok(Math.abs(multiplied.mean - 77) < 4, 'a multiply group blends as one with the stack');

    // Fill, smudge and blur tools on a new paint layer.
    await pg.locator('.cs-lr', { hasText: 'Group 1' }).click();
    await pg.locator('.cs-lr', { hasText: 'Group 1' }).hover();
    await pg.locator('.cs-lr', { hasText: 'Group 1' }).locator('button[aria-label="Hide"]').click();
    await pg.locator('.cs-lr', { hasText: 'Base' }).click();
    await pg.getByLabel('New paint layer').click();
    await pg.locator('.cs-props input.cs-input[aria-label="Brush roughness"]').fill('0');
    await pg.locator('.cs-props input.cs-input[aria-label="Brush roughness"]').press('Enter');
    const under = await rough();
    await pg.getByLabel('Fill', { exact: true }).click();
    const { cx, cy } = await box();
    await pg.mouse.click(cx, cy);
    await pg.waitForTimeout(500);
    const filled = await rough();
    assert.ok(filled.mean < 3 && filled.mean < under.mean, 'the fill tool fills the island');
    await pg.keyboard.press('Control+z');
    await pg.waitForTimeout(400);
    assert.ok(Math.abs((await rough()).mean - under.mean) < 1, 'and undoes');

    await pg.getByLabel('Paint', { exact: true }).click();
    await stroke();
    const line = await rough();
    await pg.getByLabel('Blur', { exact: true }).click();
    await pg.locator('.cs-brushbar input[aria-label="Size"]').fill('200');
    await pg.locator('.cs-brushbar input[aria-label="Size"]').press('Enter');
    for (let k = 0; k < 3; k++) await stroke();
    const soft = await rough();
    assert.ok(Math.abs(soft.sd - line.sd) > 0.3 || Math.abs(soft.mean - line.mean) > 0.3, 'the blur tool changes the strokes');
    await pg.getByLabel('Smudge', { exact: true }).click();
    const { cx: x0, cy: y0 } = await box();
    await pg.mouse.move(x0, y0 - 60);
    await pg.mouse.down();
    for (let i = 0; i <= 20; i++) await pg.mouse.move(x0, y0 - 60 + i * 6);
    await pg.mouse.up();
    await pg.waitForTimeout(500);
    const smudged = await rough();
    assert.ok(Math.abs(smudged.mean - soft.mean) > 0.1, 'the smudge tool drags the strokes');

    // Tips and stencils: how much of a fresh layer one stroke covers.
    const covered = () =>
      pg.evaluate(() => {
        const s = window.surface.get();
        const g = window.surface.engine.sets.get(s.setId);
        const t = g.pixels.get(s.layerId)?.get('roughness');
        if (!t) return 0;
        const px = g.p.read(t);
        let n = 0;
        for (let i = 3; i < px.length; i += 4) n += px[i];
        return n / 255;
      });
    const fresh = async () => {
      await pg.locator('.cs-lr', { hasText: 'Base' }).click();
      await pg.getByLabel('New paint layer').click();
      await stroke();
      return covered();
    };
    await pg.getByLabel('Paint', { exact: true }).click();
    await pg.locator('.cs-brushbar input[aria-label="Size"]').fill('60');
    await pg.locator('.cs-brushbar input[aria-label="Size"]').press('Enter');
    const round = await fresh();
    await pg.locator('.cs-props').getByRole('radio', { name: 'Square' }).click();
    const square = await fresh();
    assert.ok(square > round * 1.1, 'a square tip covers more than a round one');
    const half = new Uint8Array(64 * 64);
    for (let i = 0; i < half.length; i++) half[i] = i % 64 < 32 ? 0 : 255;
    const picture = path.join(tmp, 'half.png');
    writeFileSync(picture, await encodePng(64, 64, 1, half));
    await pg.locator('.cs-props .cs-f', { hasText: 'Picture' }).last().getByRole('button').first().click();
    await open(() => pg.locator('.cs-props').getByRole('button', { name: 'Your own picture…' }).click(), picture);
    await pg.waitForTimeout(300);
    await field('Stencil size', 3);
    const stencilled = await fresh();
    assert.ok(stencilled > square * 0.3 && stencilled < square * 0.7, 'a half-black stencil stops half the stroke');
    await pg.locator('.cs-props').getByRole('button', { name: 'Remove stencil' }).click();

    // The built-in library: a star tip from the alphas, and a checker pattern in an Image effect.
    await pg.locator('.cs-props').getByRole('radio', { name: 'Picture' }).click();
    await pg.locator('.cs-props .cs-f').filter({ has: pg.locator('xpath=./span[text()="Picture"]') }).first().getByRole('button', { name: 'Choose…' }).click();
    await pg.locator('.cs-props .cs-acell[aria-label="Star"]').click();
    const star = await fresh();
    assert.ok(star > 0 && star < square * 0.8, 'a library alpha shapes the brush');
    await pg.locator('.cs-lr', { hasText: 'Base' }).click();
    await pg.getByLabel('New fill layer').click();
    await chip('Image');
    await pg.locator('.cs-props .cs-f', { hasText: 'Image' }).getByRole('button', { name: 'Choose…' }).click();
    await pg.locator('.cs-props').getByRole('radio', { name: 'Patterns' }).click();
    await pg.locator('.cs-props .cs-acell[aria-label="Checker"]').click();
    const checker = await rough();
    assert.ok(checker.sd > 40, 'a library pattern in an Image effect');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    srv.close();
  }
}, 300_000);
