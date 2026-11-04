import { defineConfig } from '@playwright/test';
import { secureBrowserUse, browserChannelUse } from '../e2e/fixtures/secure-browser';
import path from 'node:path';
const output = process.env.VISUAL_091_OUTPUT!;
export default defineConfig({
  testDir: '.', testMatch: 'flows.spec.ts', workers: 1, retries: 0, timeout: 180_000,
  expect: { timeout: 15_000 },
  outputDir: path.join(output, 'flows'),
  reporter: [['./reporter.ts'], ['list'], ['json', { outputFile: path.join(output, 'results.json') }],
    ['html', { outputFolder: path.join(output, 'report'), open: 'never' }]],
  use: { ...secureBrowserUse, ...browserChannelUse, baseURL: process.env.E2E_BASE_URL,
    video: 'on', screenshot: 'only-on-failure', locale: 'it-IT' },
  projects: ['giorno', 'grafite'].flatMap(theme => [1440, 390].map(width => ({
    name: `${theme}-${width}`, use: { viewport: { width, height: 960 }, colorScheme: theme === 'giorno' ? 'light' as const : 'dark' as const },
  }))),
});
