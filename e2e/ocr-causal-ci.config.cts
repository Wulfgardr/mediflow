// Temporary synthetic diagnostic overlay; original oracle, streaming and retries remain unchanged.
import path from 'node:path';
import { defineConfig } from '@playwright/test';
import original from '../playwright.config';

export default defineConfig({
  ...original,
  testDir: __dirname,
  outputDir: path.join(process.env.RUNNER_TEMP || '/tmp', 'ocr-causal-private-results'),
  workers: 1,
  reporter: [['list']],
  use: { ...original.use, trace: 'off', screenshot: 'off', video: 'off' },
});
