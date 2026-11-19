import { defineConfig } from 'vitest/config';

// Only platform-independent modules are unit-tested here; screens are checked
// by typecheck and the `expo export` bundle build.
export default defineConfig({ test: { include: ['src/lib/**/*.test.ts'] } });
