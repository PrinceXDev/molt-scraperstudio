import { defineConfig } from 'vitest/config';

export default defineConfig({
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
