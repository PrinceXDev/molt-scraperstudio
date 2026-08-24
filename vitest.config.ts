import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      // Mirrors `apps/web/tsconfig.json`'s `"@/*": ["./*"]`. Vitest resolves
      // modules through Vite, which has no knowledge of that `paths` entry on
      // its own — without this, any `apps/web` source file that imports via
      // `@/...` (the convention used throughout that app, matching Next's own
      // resolution of it) fails to load the moment a test pulls it in, even
      // indirectly through another module's import chain.
      { find: '@', replacement: fileURLToPath(new URL('./apps/web', import.meta.url)) },
    ],
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      // The detection core is the part a judge should be able to trust on
      // sight, so it is held to a real bar rather than a token one.
      thresholds: {
        'packages/health/src/**': {
          statements: 95,
          branches: 90,
          functions: 100,
          lines: 95,
        },
      },
    },
  },
});
