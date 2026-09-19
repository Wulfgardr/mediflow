/* @Codex */
import { defineConfig } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';

export default defineConfig({
  testDir: './e2e',
  // This is a node:test browser harness with top-level await, run only by
  // scripts/chatgpt-product-focused-tests.mjs --browser below.
  testIgnore: ['**/chatgpt-synthesis-product.spec.ts'],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: true,
  },
});
