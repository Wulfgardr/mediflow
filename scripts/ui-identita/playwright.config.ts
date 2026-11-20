import { defineConfig } from '@playwright/test';
import { browserChannelUse, secureBrowserUse } from '../../e2e/fixtures/secure-browser';
import { bancoPaths } from './banco-paths.mjs';
const artifacts = process.env.MF_BANCO_ARTIFACTS || process.env.MF_BANCO_RESULTS_DIR || bancoPaths().scratch;
const httpPort = process.env.MF_BANCO_HTTP_PORT || '3100';
if (process.env.CI || process.env.PLAYWRIGHT_ALLOW_EXTERNAL_NETWORK === '1') throw new Error('Solo browser locale con sandbox e rete loopback');
export default defineConfig({
  testDir: '.', testMatch: ['web-capture.spec.ts', 'web-regression.spec.ts'], workers: 1, retries: 0, timeout: 600000,
  expect: { timeout: 20000 }, outputDir: `${artifacts}/playwright-results`,
  reporter: [['list'], ['json', { outputFile: `${artifacts}/web-results.json` }]],
  use: { ...secureBrowserUse, ...browserChannelUse, baseURL: `http://127.0.0.1:${httpPort}`, locale: 'it-IT', screenshot: 'only-on-failure' },
  projects: ['giorno', 'grafite'].flatMap(theme => [1440, 390].map(width => ({
    name: `${theme}-${width}`,
    grepInvert: width === 390 ? /@largo|@giorno-largo/ : theme === 'giorno' ? /@stretto/ : /@stretto|@giorno-largo/,
    use: { viewport: { width, height: 960 }, colorScheme: theme === 'giorno' ? 'light' as const : 'dark' as const },
  }))),
});
