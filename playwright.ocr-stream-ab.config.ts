import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/ocr-stream-ab.diagnostic.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['json', { outputFile: process.env.OCR_STREAM_AB_REPORT || '.codex/ocr-stream-ab/results.json' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:3123',
    headless: true,
    trace: 'off', screenshot: 'off', video: 'off',
  },
});
