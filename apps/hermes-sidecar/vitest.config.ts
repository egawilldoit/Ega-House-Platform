import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/types/**', 'src/fixtures/**'],
    },
    testTimeout: 10_000,
    hookTimeout: 10_000,
    setupFiles: ['test/setup.ts'],
  },
});
