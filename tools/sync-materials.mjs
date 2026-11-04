// Refresh packages/materials from a CocoaWorlds checkout: node tools/sync-materials.mjs ../CocoaWorlds
import { cpSync, readdirSync } from 'node:fs';
import path from 'node:path';

const cw = path.resolve(process.argv[2] ?? '../CocoaWorlds');
const here = path.resolve(import.meta.dirname, '..');
const src = path.join(cw, 'packages/materials/src');
for (const f of readdirSync(src)) cpSync(path.join(src, f), path.join(here, 'packages/materials/src', f));
const docs = path.join(cw, 'docs/cocoamat');
const fix = path.join(here, 'packages/materials/test/fixtures');
cpSync(path.join(docs, 'nodes.json'), path.join(fix, 'nodes.json'));
for (const f of readdirSync(path.join(docs, 'samples'))) if (f.endsWith('.cocoamat')) cpSync(path.join(docs, 'samples', f), path.join(fix, f));
console.log(`Copied Cocoa Materials from ${cw}. Run npm test.`);
