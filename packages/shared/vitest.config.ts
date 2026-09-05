import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    // Use vmForks pool for better ESM compatibility with Node.js 24
    pool: 'vmForks',
    poolOptions: {
      vmForks: {
        memoryLimit: '512MB',
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
      },
    },
  },
});
