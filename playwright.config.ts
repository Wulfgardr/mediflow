/* @Codex */
import { defineConfig } from '@playwright/test';
import { playwrightTestSelection } from './scripts/playwright-test-selection.mjs';
import { trustedWebRequestHeaders } from './e2e/fixtures/trusted-web-request';

const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';

export default defineConfig({
  ...playwrightTestSelection(__dirname),
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 1,
  reporter: [['./scripts/e2e-quarantine-playwright.mjs'], ['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    // page.request shares these with its browser context but does not create
    // browser Origin/Fetch Metadata on its own.
    extraHTTPHeaders: trustedWebRequestHeaders(baseURL),
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: true,
  },
});
