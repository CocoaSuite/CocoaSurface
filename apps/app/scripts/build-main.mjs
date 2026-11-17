import { build, context } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const root = path.dirname(import.meta.dirname);
const watch = process.argv.includes('--watch');
const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], logLevel: 'info', absWorkingDir: root };
const entries = [
  { entryPoints: ['src/main/main.ts'], outfile: 'dist/main/main.cjs' },
  { entryPoints: ['src/preload/preload.ts'], outfile: 'dist/main/preload.js' },
];
// The window icon sits beside main.cjs, so it ships inside the packaged app too.
mkdirSync(path.join(root, 'dist/main'), { recursive: true });
copyFileSync(path.join(root, 'build/icon.png'), path.join(root, 'dist/main/icon.png'));
if (watch) for (const e of entries) await (await context({ ...common, ...e })).watch();
else await Promise.all(entries.map((e) => build({ ...common, ...e })));
