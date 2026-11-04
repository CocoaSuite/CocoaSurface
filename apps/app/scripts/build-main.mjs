import { build, context } from 'esbuild';
import path from 'node:path';

const root = path.dirname(import.meta.dirname);
const watch = process.argv.includes('--watch');
const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], logLevel: 'info', absWorkingDir: root };
const entries = [
  { entryPoints: ['src/main/main.ts'], outfile: 'dist/main/main.cjs' },
  { entryPoints: ['src/preload/preload.ts'], outfile: 'dist/main/preload.js' },
];
if (watch) for (const e of entries) await (await context({ ...common, ...e })).watch();
else await Promise.all(entries.map((e) => build({ ...common, ...e })));
