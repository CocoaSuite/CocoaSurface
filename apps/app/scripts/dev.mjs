import { spawn } from 'node:child_process';
import path from 'node:path';
import { createServer } from 'vite';

const root = path.dirname(import.meta.dirname);
const server = await createServer({ root: path.join(root, 'src/renderer'), configFile: path.join(root, 'vite.config.mts') });
await server.listen();
const url = server.resolvedUrls.local[0];
spawn(process.execPath, [path.join(root, 'scripts/build-main.mjs'), '--watch'], { stdio: 'inherit' });
setTimeout(() => {
  const el = spawn(path.join(root, '../../node_modules/.bin/electron'), ['.'], { cwd: root, stdio: 'inherit', env: { ...process.env, CS_DEV_URL: url } });
  el.on('exit', () => process.exit(0));
}, 1500);
