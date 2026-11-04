// This package is a copy of CocoaWorlds' packages/materials. Its node catalog must match the one CocoaWorlds
// publishes (test/fixtures/nodes.json, from docs/cocoamat/nodes.json); `npm run sync-materials` refreshes both.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { changedNodes, evaluable, nodeCatalog, readCocoaMat, writeCocoaMat, type Catalog } from '../src';

const FIX = new URL('./fixtures/', import.meta.url);
const published = JSON.parse(readFileSync(new URL('nodes.json', FIX), 'utf8')) as Catalog;
const samples = readdirSync(FIX).filter((f) => f.endsWith('.cocoamat'));

describe('the copy of Cocoa Materials', () => {
  it('has the same nodes as CocoaWorlds', () => {
    const own = nodeCatalog();
    expect(own.version).toBe(published.version);
    expect(own.library).toBe(published.library);
    expect(own.nodes.map((n) => [n.type, n.hash])).toEqual(published.nodes.map((n) => [n.type, n.hash]));
  });

  for (const name of samples)
    it(`reads ${name}, changes a parameter and writes it back without losing anything`, async () => {
      const bytes = new Uint8Array(readFileSync(new URL(name, FIX)));
      const r = await readCocoaMat(bytes);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const f = r.value;
      expect(changedNodes(f)).toEqual({ missing: [], different: [] });
      evaluable(f);
      const manifest = { ...f.manifest, extensions: { other: { keep: 1 } }, futureField: 'kept' };
      const p = manifest.parameters.find((q) => q.kind === 'number');
      if (p) p.value = (p.min ?? 0) + ((p.max ?? 1) - (p.min ?? 0)) / 3;
      const out = await readCocoaMat(await writeCocoaMat({ manifest, graph: f.graph, nodes: f.nodes, images: f.images }));
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(out.value.graph).toEqual(f.graph);
      expect(out.value.manifest.extensions).toEqual({ other: { keep: 1 } });
      expect(out.value.manifest.futureField).toBe('kept');
      if (p) expect(out.value.manifest.parameters.find((q) => q.id === p.id)!.value).toBeCloseTo(p.value as number);
      expect([...out.value.images.keys()]).toEqual([...f.images.keys()]);
    });
});
