import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
      },
      exclude: [
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/migrations/**',
        '**/node_modules/**',
        '**/dist/**',
        'src/index.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@auditar/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
});
