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
    await pg.getByRole('button', { name: 'Texture Set Settings' }).click();
    await pg.locator('.cs-tsets select').first().selectOption('512');
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
    await pg.getByRole('button', { name: 'Texture Set Settings' }).click();
    await pg.locator('.cs-tsets select').first().selectOption('512');
    await pg.locator('.cs-tsets .cs-seg button', { hasText: 'Skew' }).click();
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
    await pg.locator('.cs-tsets').getByRole('radio', { name: 'Off', exact: true }).click();
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

function cylinder(file, R, n, h, low, bevel = 0) {
  const v = [], t = [], vn = [], f = [];
  let k = 0;
  const vert = (p, uv, nn) => (v.push(`v ${p[0]} ${p[1]} ${p[2]}`), t.push(`vt ${uv[0]} ${uv[1]}`), vn.push(`vn ${nn[0]} ${nn[1]} ${nn[2]}`), ++k);
  const quad = (a, b, c, d) => f.push(`f ${a}/${a}/${a} ${b}/${b}/${b} ${c}/${c}/${c}`, `f ${a}/${a}/${a} ${c}/${c}/${c} ${d}/${d}/${d}`);
  // Rings up the side: radius, height, normal tilt. A bevel adds a ring that leans toward the cap.
  const rings = bevel ? [[R - bevel, -h, -1], [R, -h + bevel, 0], [R, h - bevel, 0], [R - bevel, h, 1]] : [[R, -h, 0], [R, h, 0]];
  const rows = rings.map(([r, y, tilt], j) =>
    Array.from({ length: n + 1 }, (_, i) => {
      const a = (2 * Math.PI * i) / n, l = Math.hypot(1, tilt);
      return vert([r * Math.cos(a), y, r * Math.sin(a)], [i / n, 0.35 + (0.6 * j) / (rings.length - 1)], [Math.cos(a) / l, tilt / l, Math.sin(a) / l]);
    }),
  );
  for (let j = 0; j + 1 < rows.length; j++) for (let i = 0; i < n; i++) quad(rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]);
  for (const [r, y, cu, s] of [[R - bevel, h, 0.22, 1], [R - bevel, -h, 0.77, -1]]) {
    const c = vert([0, y, 0], [cu, 0.16], [0, s, 0]);
    const rim = Array.from({ length: n + 1 }, (_, i) => (2 * Math.PI * i) / n).map((a) => vert([r * Math.cos(a), y, r * Math.sin(a)], [cu + 0.14 * Math.cos(a), 0.16 + 0.14 * Math.sin(a)], [0, s, 0]));
    for (let i = 0; i < n; i++) f.push(s > 0 ? `f ${c}/${c}/${c} ${rim[i + 1]}/${rim[i + 1]}/${rim[i + 1]} ${rim[i]}/${rim[i]}/${rim[i]}` : `f ${c}/${c}/${c} ${rim[i]}/${rim[i]}/${rim[i]} ${rim[i + 1]}/${rim[i + 1]}/${rim[i + 1]}`);
  }
  writeFileSync(file, [`o Can_${low ? 'low' : 'high'}`, 'usemtl Can', ...v, ...t, ...vn, ...f].join('\n'));
}

test('a round high-poly model baked onto a few-sided low-poly one has clean rims', async () => {
  const low = path.join(tmp, 'can_low.obj'), high = path.join(tmp, 'can_high.obj');
  cylinder(low, 1.07, 6, 1, true);
  cylinder(high, 1, 64, 1, false, 0.12);
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
  try {
    const pg = await browser.newPage({ viewport: { width: 1440, height: 860 } });
    const open = async (trigger, files) => {
      const fc = pg.waitForEvent('filechooser');
      await trigger();
      await (await fc).setFiles(files);
    };
    // How much the normal map's green wobbles along a row just under the top rim of the side.
    const wobble = () =>
      pg.evaluate(() => {
        const g = [...window.surface.engine.sets.values()][0];
        const t = g.baked.get('normal');
        const px = g.p.read(t), w = t.width;
        let worst = 0;
        for (const v of [0.94, 0.93, 0.92, 0.36, 0.37]) {
          const y = Math.floor(v * w);
          let s = 0, s2 = 0, n = 0;
          for (let x = Math.floor(w * 0.02); x < w * 0.98; x++) {
            const gr = px[(y * w + x) * 4 + 1];
            s += gr;
            s2 += gr * gr;
            n++;
          }
          worst = Math.max(worst, Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2)));
        }
        return worst;
      });
    const bake = async (meshFirst) => {
      await pg.getByText(/Bake (mesh maps|again)…/).first().click();
      if (!(await pg.locator('.cs-box').getByText('Use it').count()) && !(await pg.locator('.cs-cages').count())) {
        await open(() => pg.locator('.cs-box button', { hasText: 'Load' }).click(), high);
        await pg.locator('.cs-cages').waitFor();
      }
      for (const m of ['World normal', 'Position', 'Occlusion', 'Curvature', 'Thickness', 'ID']) {
        const c = pg.locator('.cs-box .cs-chip', { hasText: m }).first();
        if ((await c.getAttribute('aria-pressed')) === 'true') await c.click();
      }
      await pg.locator('.cs-box select').first().selectOption('512');
      const sw = pg.getByLabel("Cast along the mesh's own normals first");
      if (meshFirst) await sw.check();
      else await sw.uncheck();
      await pg.getByRole('button', { name: 'Bake', exact: true }).click();
      await pg.waitForFunction(() => !window.surface.get().job && window.surface.get().project.textureSets[0].bake, null, { timeout: 240_000 });
      await pg.waitForTimeout(300);
      return wobble();
    };
    await pg.goto(`http://localhost:${srv.address().port}/?inspect`);
    await open(() => pg.getByText('New project from a model…').first().click(), low);
    await pg.waitForSelector('canvas.cs-gl');
    await pg.getByRole('button', { name: 'Texture Set Settings' }).click();
    await pg.locator('.cs-tsets select').first().selectOption('512');
    const averaged = await bake(false);
    const meshFirst = await bake(true);
    assert.ok(meshFirst < 4 && meshFirst < averaged * 0.5, `mesh normals first keeps the rims straight (${meshFirst.toFixed(1)} against ${averaged.toFixed(1)})`);
  } finally {
    await browser.close();
    srv.close();
  }
}, 600_000);
