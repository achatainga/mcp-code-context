import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    reporters: ['basic'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'dist-tests/',
        '**/*.spec.ts',
        '**/*.test.ts',
        'tests/',
        'scripts/'
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80
      }
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    outputTruncateLength: 80
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
});
