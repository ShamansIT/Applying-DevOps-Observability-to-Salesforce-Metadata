import { defineConfig } from 'vitest/config';

// Test and coverage config. Coverage thresholds are CI regression gate: drop below them fails
// run. Excluded from coverage: barrels (re-exports only), extension host glue and live
// Salesforce adapter (both need VS Code or real org, covered by e2e smoke and manual runs), and
// pure type declarations. e2e suite runs under @vscode/test-electron, not vitest, so it is excluded
// from test run here.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/e2e/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: [
        '**/index.ts',
        '**/cli-run.ts',
        'src/extension/index.ts',
        'src/ingestion/salesforceConnection.ts',
        'src/core/types.ts',
      ],
      reporter: ['text-summary', 'text', 'html'],
      thresholds: {
        lines: 85,
        statements: 85,
        functions: 85,
        branches: 70,
      },
    },
  },
});
