/* @Codex */
import { defineConfig } from '@playwright/test';
import { playwrightTestSelection } from './scripts/playwright-test-selection.mjs';
import { browserChannelUse, secureBrowserUse } from './e2e/fixtures/secure-browser';

const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';

export default defineConfig({
  ...playwrightTestSelection(__dirname),
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 1,
  reporter: [['./scripts/e2e-quarantine-playwright.mjs'], ['list'], ['html', { open: 'never' }]],
  use: {
    ...secureBrowserUse,
    ...browserChannelUse,
    baseURL,
    // No extraHTTPHeaders: the browser sends its own Origin and Fetch Metadata,
    // and Chrome 156+ rejects every subresource when a context forges
    // Sec-Fetch-Site. API requests (page.request, request) declare trust per
    // call with trustedWebRequestHeaders / trustedArchiveWebRequestHeaders.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: true,
  },
});
