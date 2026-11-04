import { describe, expect, it } from 'vitest';
import { duplicateLayer, findLayer, newLayerEffect, pixelOwners, insertLayer, moveLayer, newFillLayer, newGroup, newPaintLayer, newProject, newTextureSet, pixelPath, placeOf, readProject, removeLayer, writeProject } from '../src';

describe('layer stacks', () => {
  const a = newPaintLayer('A', ['color']);
  const b = newFillLayer('B', ['color']);
  const g = newGroup('G', ['color']);

  it('inserts, finds, moves and removes', () => {
    let s = [a, b, g];
    s = moveLayer(s, a.id, { parent: g.id, index: 0 });
    expect(s.map((l) => l.id)).toEqual([b.id, g.id]);
    expect(placeOf(s, a.id)).toEqual({ parent: g.id, index: 0 });
    s = moveLayer(s, g.id, { parent: g.id, index: 0 });
    expect(findLayer(s, g.id)).toBeTruthy();
    s = moveLayer(s, b.id, { parent: null, index: 2 });
    expect(s.map((l) => l.id)).toEqual([g.id, b.id]);
    s = removeLayer(s, a.id);
    expect(findLayer(s, a.id)).toBeNull();
    s = insertLayer(s, a, { parent: null, index: 0 });
    expect(s[0]!.id).toBe(a.id);
  });

  it('duplicates with new ids', () => {
    const grp = { ...g, children: [a] };
    const { layer, ids } = duplicateLayer(grp);
    expect(layer.id).not.toBe(g.id);
    expect(ids.get(a.id)).toBe(layer.kind === 'group' ? layer.children[0]!.id : '');
  });
});

describe('the project file', () => {
  it('saves and reads back', async () => {
    const p = newProject('Test');
    const set = newTextureSet('Body', ['Body']);
    const paint = newPaintLayer('Paint', ['color']);
    set.layers.unshift(paint);
    p.textureSets.push(set);
    p.model = { file: 'model/a.obj', name: 'a.obj' };
    p.library.push({ id: 'm1', name: 'Stone', file: 'materials/m1.cocoamat' });
    const files = new Map([
      ['model/a.obj', new TextEncoder().encode('v 0 0 0')],
      ['materials/m1.cocoamat', new Uint8Array([1, 2, 3])],
      [pixelPath(paint.id, 'color'), new Uint8Array([9])],
    ]);
    const r = await readProject(await writeProject({ project: p, files }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.project).toEqual(p);
    expect([...r.value.files.keys()].sort()).toEqual([...files.keys()].sort());
  });

  it('refuses broken projects', async () => {
    expect((await readProject(new Uint8Array([1, 2, 3]))).ok).toBe(false);
    const p = newProject('X');
    p.model = { file: 'model/missing.obj', name: 'missing.obj' };
    const r = await readProject(await writeProject({ project: p, files: new Map() }));
    expect(r.ok ? '' : r.error).toMatch(/missing/);
  });
});

describe('a texture set as a .cocoamat', async () => {
  const { setMaterial, writeSetMaterial } = await import('../src');
  const { readCocoaMat, encodePng, evaluable, outputNodes } = await import('@cocoasurface/materials');
  it('is a valid material file that keeps the layer stack', async () => {
    const set = newTextureSet('Body', ['Body'], 512);
    const png = await encodePng(2, 2, 3, new Uint8Array(12).fill(128));
    const maps = new Map([['color', png], ['roughness', png], ['normal', png]] as const);
    const parts = setMaterial({ set, maps: new Map(maps), generator: 'CocoaSurface test' });
    const bytes = await writeSetMaterial(parts, new Map([['pixels/x/color.png', png]]));
    const r = await readCocoaMat(bytes);
    expect(r.ok ? '' : r.error).toBe('');
    if (!r.ok) return;
    expect([...outputNodes(evaluable(r.value)).keys()].sort()).toEqual(['color', 'normal', 'roughness']);
    expect(r.value.images.size).toBe(3);
    expect((r.value.manifest.extensions as { cocoasurface: { textureSet: { id: string } } }).cocoasurface.textureSet.id).toBe(set.id);
    expect(r.value.manifest.normalGreen).toBe('down');
  });
});

describe('older projects', () => {
  it('turn a painted mask and a generator into mask items', async () => {
    const p = newProject('Old');
    const set = newTextureSet('A', ['A']);
    const l = newPaintLayer('P', ['color']) as unknown as Record<string, unknown>;
    l.mask = true;
    l.generator = { source: 'curvature', level: 0.5, spread: 0.1, invert: false };
    set.layers.unshift(l as never);
    p.textureSets.push(set);
    const r = await readProject(await writeProject({ project: p, files: new Map([[pixelPath(l.id as string, 'mask'), new Uint8Array([7])]]) }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const m = r.value.project.textureSets[0]!.layers[0]!.mask!;
    expect(m.base).toBe(1);
    expect(m.items.map((i) => i.kind)).toEqual(['generator', 'paint']);
    expect(r.value.files.get(pixelPath(`${l.id}-m`, 'grey'))).toEqual(new Uint8Array([7]));
  });
});

describe('layer effects', () => {
  it('give their strokes new ids when duplicated, keep them when saved, and refuse broken ones', async () => {
    const l = newFillLayer('F', ['color', 'roughness']);
    l.effects = [newLayerEffect('paint'), newLayerEffect('fill'), newLayerEffect('levels')];
    expect(l.effects[1]!.flat?.roughness).toBeTypeOf('number');
    const { layer, ids } = duplicateLayer(l);
    expect(pixelOwners(layer)).toHaveLength(4);
    expect(ids.get(l.effects[0]!.id)).toBe(layer.effects![0]!.id);
    expect(layer.effects![0]!.id).not.toBe(l.effects[0]!.id);
    const p = newProject('P');
    p.textureSets.push({ ...newTextureSet('S', ['M']), layers: [l] });
    const r = await readProject(await writeProject({ project: p, files: new Map() }));
    expect(r.ok && r.value.project.textureSets[0]!.layers[0]!.effects?.map((e) => e.kind)).toEqual(['paint', 'fill', 'levels']);
    (l as unknown as { effects: unknown }).effects = 'x';
    expect((await readProject(await writeProject({ project: p, files: new Map() }))).ok).toBe(false);
  });
});
