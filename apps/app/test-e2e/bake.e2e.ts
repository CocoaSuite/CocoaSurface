// Baking in a browser: mesh maps from a high-poly model, a generated mask, and the maps kept in the project.
// Run with `npm run test:e2e` after `npm run build:renderer`. Needs and a Chromium: set CHROMIUM to its path, or have Playwright's installed.
import { test } from 'vitest';
import { evaluable, outputNodes, readCocoaMat } from '@cocoasurface/materials';
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

function bumpy(file, R, S, bump) {
  const v = [], t = [], f = [];
  for (let j = 0; j <= S; j++)
    for (let i = 0; i <= R; i++) {
      const th = (Math.PI * j) / S, ph = (2 * Math.PI * i) / R;
      const r = 1 + bump * (0.5 + 0.5 * Math.sin(ph * 8) * Math.sin(th * 8));
      v.push(`v ${r * Math.sin(th) * Math.cos(ph)} ${r * Math.cos(th)} ${r * Math.sin(th) * Math.sin(ph)}`);
      t.push(`vt ${i / R} ${1 - j / S}`);
    }
  for (let j = 0; j < S; j++)
    for (let i = 0; i < R; i++) {
      const a = j * (R + 1) + i + 1, b = a + 1, c = a + R + 1, d = c + 1;
      f.push(`f ${a}/${a} ${b}/${b} ${c}/${c}`, `f ${b}/${b} ${d}/${d} ${c}/${c}`);
    }
  writeFileSync(file, ['o Ball', 'usemtl Skin', ...v, ...t, ...f].join('\n'));
}

test('bake from a high-poly model, drive a mask with the maps, save and reopen', async () => {
  const low = path.join(tmp, 'low.obj'), high = path.join(tmp, 'high.obj');
  bumpy(low, 32, 16, 0);
  bumpy(high, 128, 64, 0.04);
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
    const pg = await browser.newPage({ viewport: { width: 1440, height: 860 }, acceptDownloads: true });
    pg.on('pageerror', (e) => errors.push(e.message));
    pg.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    const open = async (trigger, files) => {
      const fc = pg.waitForEvent('filechooser');
      await trigger();
      await (await fc).setFiles(files);
    };
    const mapStats = (kind, name) =>
      pg.evaluate(([kind, name]) => {
        const g = [...window.surface.engine.sets.values()][0];
        const t = (kind === 'baked' ? g.baked : g.display).get(name);
        const px = g.p.read(t);
        let s = 0, s2 = 0;
        const n = px.length / 4;
        for (let i = 0; i < px.length; i += 4) {
          s += px[i];
          s2 += px[i] * px[i];
        }
        return { mean: s / n, sd: Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2)) };
      }, [kind, name]);

    await pg.goto(`http://localhost:${srv.address().port}/?inspect`);
    await open(() => pg.getByText('New project from a model…').first().click(), low);
    await pg.waitForSelector('canvas.cs-gl');
    await pg.locator('.cs-side.l select').first().selectOption('512');
    await pg.getByText('Bake mesh maps…').first().click();
    await open(() => pg.locator('.cs-box button', { hasText: 'Load' }).click(), high);
    await pg.locator('.cs-box').getByText('Use it').waitFor();
    for (const m of ['World normal', 'Position', 'Thickness', 'ID']) await pg.locator('.cs-box .cs-chip', { hasText: m }).first().click();
    await pg.locator('.cs-box select').first().selectOption('512');
    await pg.locator('.cs-box select', { has: pg.locator('option', { hasText: '256' }) }).selectOption('16');
    await pg.getByRole('button', { name: 'Bake', exact: true }).click();
    await pg.waitForFunction(() => !window.surface.get().job && window.surface.get().project.textureSets[0].bake, null, { timeout: 240_000 });
    const done = await pg.evaluate(() => window.surface.get().project.textureSets[0].bake.done);
    assert.deepEqual(done, ['normal', 'occlusion', 'curvature']);
    const normal = await mapStats('baked', 'normal');
    assert.ok(normal.sd > 2, 'the bumps of the high-poly model are in the normal map');
    const curv = await mapStats('baked', 'curvature');
    assert.ok(curv.sd > 2, 'curvature varies over the bumps');

    await pg.getByLabel('New fill layer').click();
    const rough = pg.locator('.cs-props .cs-f', { hasText: 'Roughness' }).locator('input.cs-input').last();
    await rough.fill('0');
    await rough.press('Enter');
    await pg.getByRole('button', { name: 'Add black mask' }).click();
    await pg.waitForTimeout(800);
    const hidden = await mapStats('display', 'roughness');
    await pg.locator('.cs-props .cs-chip', { hasText: 'Generator' }).click();
    await pg.waitForTimeout(1500);
    assert.ok(hidden.sd < 1, 'a black mask hides the fill everywhere');
    const masked = await mapStats('display', 'roughness');
    assert.ok(masked.sd > 1, 'the edge mask shows the fill on part of the model only');
    const noise = pg.locator('.cs-props input.cs-input[aria-label="Noise"]');
    await noise.fill('100');
    await noise.press('Enter');
    await pg.waitForTimeout(1000);
    const noisy = await mapStats('display', 'roughness');
    assert.ok(Math.abs(noisy.mean - masked.mean) > 0.5 || Math.abs(noisy.sd - masked.sd) > 0.5, 'noise breaks up the generated edge');
    assert.ok(noisy.mean >= masked.mean, 'noise only takes away from the mask (less of the fill shows)');
    await pg.locator('.cs-props .cs-f', { hasText: 'Noise type' }).locator('select').selectOption('cells');
    await pg.waitForTimeout(1000);
    const cells = await mapStats('display', 'roughness');
    assert.ok(Math.abs(cells.mean - noisy.mean) > 0.2 || Math.abs(cells.sd - noisy.sd) > 0.2, 'another noise type changes the edge');

    const d = pg.waitForEvent('download');
    await pg.keyboard.press('Control+s');
    const saved = path.join(tmp, 'baked.cocoasurf');
    await (await d).saveAs(saved);
    await pg.reload();
    await open(() => pg.getByText('Open…').first().click(), saved);
    await pg.waitForSelector('canvas.cs-gl');
    await pg.waitForTimeout(3000);
    const again = await mapStats('baked', 'normal');
    assert.ok(Math.abs(again.mean - normal.mean) < 0.5 && Math.abs(again.sd - normal.sd) < 0.5, 'baked maps come back with the project');
    assert.equal(await pg.evaluate(() => !!window.surface.get().project.highPoly), true);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    srv.close();
  }
}, 400_000);

function box(file, name, s) {
  const faces = [[[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]]];
  const v = [], t = [], n = [], f = [];
  faces.forEach(([nn, a, b], k) => {
    const ox = (k % 3) / 3 + 0.01, oy = Math.floor(k / 3) / 2 + 0.01;
    for (const [u, w] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      v.push(`v ${[0, 1, 2].map((i) => s * (nn[i] + (2 * u - 1) * a[i] + (2 * w - 1) * b[i])).join(' ')}`);
      t.push(`vt ${ox + u * 0.313} ${oy + w * 0.48}`);
    }
    n.push(`vn ${nn.join(' ')}`);
    const i = k * 4 + 1, m = k + 1;
    f.push(`f ${i}/${i}/${m} ${i + 1}/${i + 1}/${m} ${i + 2}/${i + 2}/${m}`, `f ${i}/${i}/${m} ${i + 2}/${i + 2}/${m} ${i + 3}/${i + 3}/${m}`);
  });
  writeFileSync(file, [`o ${name}`, 'usemtl Box', ...v, ...t, ...n, ...f].join('\n'));
}

test('bevel shader, name matching and automatic cages', async () => {
  const low = path.join(tmp, 'box_low.obj'), high = path.join(tmp, 'box_high.obj');
  box(low, 'Box_low', 1);
  box(high, 'Box_high', 1.02);
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
    const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    pg.on('pageerror', (e) => errors.push(e.message));
    pg.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    const open = async (trigger, files) => {
      const fc = pg.waitForEvent('filechooser');
      await trigger();
      await (await fc).setFiles(files);
    };
    const sd = (name) =>
      pg.evaluate((name) => {
        const g = [...window.surface.engine.sets.values()][0];
        const px = g.p.read(g.baked.get(name));
        let s = 0, s2 = 0, black = 0;
        const n = px.length / 4;
        for (let i = 0; i < px.length; i += 4) {
          s += px[i];
          s2 += px[i] * px[i];
          if (px[i] + px[i + 1] + px[i + 2] === 0) black++;
        }
        return { sd: Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2)), black: black / n };
      }, name);
    await pg.goto(`http://localhost:${srv.address().port}/?inspect`);
    await open(() => pg.getByText('New project from a model…').first().click(), low);
    await pg.waitForSelector('canvas.cs-gl');
    await pg.locator('.cs-side.l select').first().selectOption('512');
    await pg.locator('.cs-side.l .cs-seg button', { hasText: 'Skew' }).click();
    const box2 = await pg.locator('canvas.cs-gl').boundingBox();
    await pg.mouse.move(box2.x + box2.width / 2 - 60, box2.y + box2.height / 2);
    await pg.mouse.down();
    for (let i = 0; i <= 12; i++) await pg.mouse.move(box2.x + box2.width / 2 - 60 + i * 10, box2.y + box2.height / 2);
    await pg.mouse.up();
    await pg.waitForTimeout(500);
    const skew = await pg.evaluate(() => {
      const g = [...window.surface.engine.sets.values()][0];
      const px = g.p.read(g.pixels.get('#bake').get('skew'));
      let n = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i] > 128) n++;
      return n;
    });
    assert.ok(skew > 100, 'skew paints onto the model');
    assert.equal(await pg.evaluate(() => window.surface.get().view.mode), 'bake:skew');
    await pg.locator('.cs-side.l').getByRole('radio', { name: 'Off', exact: true }).click();
    await pg.getByText('Bake mesh maps…').first().click();
    await open(() => pg.locator('.cs-box button', { hasText: 'Load' }).click(), high);
    await pg.locator('.cs-box').getByText('Match names').waitFor();
    assert.match(await pg.locator('.cs-cages').innerText(), /Box_low/);
    assert.doesNotMatch(await pg.locator('.cs-cages').innerText(), /no pair/);
    await pg.locator('.cs-box .cs-sec', { hasText: 'Bevel shader' }).getByRole('button', { name: 'Add' }).click();
    const radius = pg.locator('.cs-box .cs-f', { hasText: 'Radius' }).locator('input.cs-input');
    await radius.fill('3');
    await radius.press('Enter');
    const dist = pg.locator('.cs-box input.cs-input[aria-label="Cage distance, % of the model"]');
    await dist.fill('5');
    await dist.press('Enter');
    await pg.waitForTimeout(300);
    const cp = await pg.evaluate(() => window.surface.get().cagePreview);
    assert.ok(Math.abs(cp.front - 0.05) < 1e-6 && !cp.autoCage && !Object.keys(cp.cages).length, 'the cage distance slider sets every cage');
    assert.equal(await pg.locator('.cs-cages input').first().inputValue(), '5');
    await pg.getByLabel("Measure each mesh's cage before baking").check();
    for (const m of ['Position', 'Thickness']) await pg.locator('.cs-box .cs-chip', { hasText: m }).first().click();
    await pg.locator('.cs-box select').first().selectOption('512');
    await pg.locator('.cs-box select', { has: pg.locator('option', { hasText: '256' }) }).selectOption('16');
    await pg.getByRole('button', { name: 'Bake', exact: true }).click();
    await pg.waitForFunction(() => !window.surface.get().job && window.surface.get().project.textureSets[0].bake, null, { timeout: 280_000 });
    const st = await pg.evaluate(() => window.surface.get().project.textureSets[0].bake.settings);
    assert.ok(st.cages.Box_low.front > 0.005, 'the cage reaches the high-poly box, which sits 2% out');
    const id = await sd('id');
    assert.ok(id.black < 0.01, 'every texel found its high-poly surface');
    const curv = await sd('curvature');
    assert.ok(curv.sd > 3, 'the bevel rounds the box edges, so curvature shows them');
    const nrm = await sd('normal');
    assert.ok(nrm.sd > 2, 'the bevel bends the normals near the edges');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    srv.close();
  }
}, 400_000);
