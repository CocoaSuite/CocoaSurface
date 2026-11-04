import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['test-e2e/**/*.e2e.ts'], environment: 'node', testTimeout: 400_000, fileParallelism: false } });
