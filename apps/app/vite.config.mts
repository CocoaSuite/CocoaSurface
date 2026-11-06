import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import { defineConfig, type Plugin } from 'vite';

function csp(): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "worker-src 'self' blob:",
    "connect-src 'self' blob: data:",
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; ');
  return { name: 'csp', apply: 'build', transformIndexHtml: (html) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}">`) };
}

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react(), wasm(), csp()],
  worker: { plugins: () => [wasm()] },
  build: { outDir: '../../dist/renderer', emptyOutDir: true, target: 'chrome130', chunkSizeWarningLimit: 3000 },
  server: { port: 5190, strictPort: false },
});
