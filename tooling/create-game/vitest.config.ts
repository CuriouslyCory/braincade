import { defineConfig } from 'vitest/config';

// Template tests run inside generated games, not here.
export default defineConfig({ test: { include: ['src/**/*.test.ts'] } });
