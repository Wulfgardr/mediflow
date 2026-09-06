/* @Codex */
import { expect, test, type Page, type Route } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import * as webpackRuntime from 'next/dist/compiled/webpack/webpack.js';

/* @Codex: Exercise the actual hooks with React DOM, without a clinical server,
   database or mocked React effects. The installed Next compiler bundles only
   these two modules and the tiny synthetic reader below. */
let bundle: string;
test.beforeAll(async ({}, info) => {
  const directory = info.outputPath('hook-fixture');
  await mkdir(directory, { recursive: true });
  for (const name of ['live-query', 'live-query-scope']) {
    const source = await readFile(path.resolve('lib', `${name}.ts`), 'utf8');
    await writeFile(path.join(directory, `${name}.js`), ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText);
  }
  await writeFile(path.join(directory, 'entry.js'), `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { useLiveQuery, useLiveQueryState, notifyDbChange } from './live-query';
    const h = React.createElement;
    function Reader({ version }) {
      const read = kind => () => fetch('/read?kind=' + kind + '&version=' + version)
        .then(r => r.text()).finally(() => {
          const settled = document.getElementById('settled');
          settled.textContent = String(Number(settled.textContent) + 1);
        });
      const state = useLiveQueryState(read('state'), [version], 'initial', ['patients']);
      const legacy = useLiveQuery(read('legacy'), [version], 'initial', ['patients']);
      return h('section', null,
        h('output', { 'data-testid': 'state-data' }, state.data),
        h('output', { 'data-testid': 'legacy-data' }, legacy),
        h('output', { 'data-testid': 'error' }, state.error ? String(state.error) : ''),
        h('output', { 'data-testid': 'loading' }, String(state.loading)),
        h('button', { onClick: state.refresh }, 'Retry state'));
    }
    function App() {
      const [version, setVersion] = useState(0);
      const [mounted, setMounted] = useState(true);
      return h('main', null,
        h('button', { onClick: () => setVersion(v => v + 1) }, 'Next query'),
        h('button', { onClick: () => setMounted(false) }, 'Unmount'),
        h('button', { onClick: () => notifyDbChange('patients') }, 'Refresh patients'),
        h('button', { onClick: () => notifyDbChange('therapies') }, 'Refresh therapies'),
        mounted && h(Reader, { version }));
    }
    createRoot(document.getElementById('root')).render(h(App));
  `);
  // Next's bundled declaration exposes types only; its installed CommonJS
  // runtime exports the compiler. Keep that one dependency statically visible.
  const { webpack } = webpackRuntime as unknown as {
    webpack(options: unknown): {
      run(callback: (error: Error | null, stats: { hasErrors(): boolean; toString(): string }) => void): void;
      close(callback: () => void): void;
    };
  };
  expect(typeof webpack).toBe('function');
  await new Promise<void>((resolve, reject) => {
    const compiler = webpack({
      mode: 'production', entry: path.join(directory, 'entry.js'),
      output: { path: directory, filename: 'bundle.js' },
      resolve: { modules: [path.resolve('node_modules'), 'node_modules'] },
      optimization: { minimize: false },
    });
    compiler.run((error: Error | null, stats: { hasErrors(): boolean; toString(): string }) => {
      compiler.close(() => {
        if (error || stats.hasErrors()) reject(error || new Error(stats.toString()));
        else resolve();
      });
    });
  });
  bundle = await readFile(path.join(directory, 'bundle.js'), 'utf8');
});

async function mountReader(page: Page) {
  const errors: string[] = [];
  const reads: Route[] = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('http://live-query.test/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/read') { reads.push(route); return; }
    if (url.pathname === '/bundle.js') return route.fulfill({ contentType: 'text/javascript', body: bundle });
    return route.fulfill({ contentType: 'text/html', body: url.pathname === '/away'
      ? '<!doctype html><title>Away</title><p>Another document</p>'
      : '<!doctype html><title>Reader</title><output id="settled">0</output><div id="root"></div><script src="/bundle.js"></script>' });
  });
  await page.goto('http://live-query.test/');
  await expect.poll(() => reads.length).toBe(2);
  return { errors, reads };
}

const settle = (reads: Route[], body: string) => Promise.all(reads.map(route => route.fulfill({ body })));
const fail = (reads: Route[]) => Promise.all(reads.map(route => route.abort('failed')));
/* @Codex: An intentional network fault also emits one browser resource error
   per fetch. Assert the complete console, including those expected failures;
   an additional hook error or any unrelated error must fail the test. */
const expectedNetworkFailures = () => [
  'Failed to load resource: net::ERR_FAILED',
  'Failed to load resource: net::ERR_FAILED',
];
const transition = (page: Page, type: 'pagehide' | 'pageshow') => page.evaluate(name => {
  window.dispatchEvent(new PageTransitionEvent(name, { persisted: true }));
}, type);

test('document navigation retires interrupted reads from both hooks', async ({ page }) => {
  const { errors } = await mountReader(page);
  const failures: string[] = [];
  page.on('requestfailed', request => {
    if (new URL(request.url()).pathname === '/read') failures.push(request.failure()?.errorText ?? '');
  });
  await page.goto('http://live-query.test/away');
  await expect.poll(() => failures.length).toBe(2);
  expect(failures).toEqual(['net::ERR_ABORTED', 'net::ERR_ABORTED']);
  expect(errors).toEqual([]);
});

test('active failures remain visible and explicit retry recovers', async ({ page }) => {
  const { errors, reads } = await mountReader(page);
  await fail(reads);
  await expect(page.getByTestId('error')).toContainText('TypeError: Failed to fetch');
  await expect(page.getByTestId('loading')).toHaveText('false');
  expect(errors.some(error => error.startsWith('useLiveQuery failed TypeError: Failed to fetch'))).toBe(true);
  expect(errors.some(error => error.startsWith('useLiveQueryState failed TypeError: Failed to fetch'))).toBe(true);
  const count = errors.length;
  await page.getByRole('button', { name: 'Retry state' }).click();
  await expect.poll(() => reads.length).toBe(3);
  await expect(page.getByTestId('loading')).toHaveText('true');
  await settle(reads.slice(2), 'recovered');
  await expect(page.getByTestId('state-data')).toHaveText('recovered');
  await expect(page.getByTestId('error')).toBeEmpty();
  await expect(page.getByTestId('loading')).toHaveText('false');
  expect(errors).toHaveLength(count);
});

test('superseded reads cannot report errors or overwrite current results', async ({ page }) => {
  const { errors, reads } = await mountReader(page);
  await page.getByRole('button', { name: 'Next query' }).click();
  await expect.poll(() => reads.length).toBe(4);
  await settle(reads.slice(2), 'current');
  await fail(reads.slice(0, 2));
  await expect(page.locator('#settled')).toHaveText('4');
  await expect(page.getByTestId('state-data')).toHaveText('current');
  await expect(page.getByTestId('legacy-data')).toHaveText('current');
  await expect(page.getByTestId('error')).toBeEmpty();
  expect(errors).toEqual(expectedNetworkFailures());
});

test('restored documents requery and never revive a previous generation', async ({ page }) => {
  const { errors, reads } = await mountReader(page);
  await transition(page, 'pagehide');
  // A scoped invalidation while suspended must not start another read.
  await page.getByRole('button', { name: 'Refresh patients' }).click();
  expect(reads).toHaveLength(2);
  await transition(page, 'pageshow');
  await expect.poll(() => reads.length).toBe(4);
  await settle(reads.slice(2), 'restored');
  await settle(reads.slice(0, 2), 'obsolete');
  await expect(page.locator('#settled')).toHaveText('4');
  await expect(page.getByTestId('state-data')).toHaveText('restored');
  await expect(page.getByTestId('legacy-data')).toHaveText('restored');
  await expect(page.getByTestId('loading')).toHaveText('false');
  expect(errors).toEqual([]);
  await page.getByRole('button', { name: 'Refresh therapies' }).click();
  expect(reads).toHaveLength(4);
  await page.getByRole('button', { name: 'Refresh patients' }).click();
  await expect.poll(() => reads.length).toBe(6);
});

test('pagehide rejection cannot update error or loading before restoration', async ({ page }) => {
  const { errors, reads } = await mountReader(page);
  await transition(page, 'pagehide');
  await fail(reads);
  await expect(page.locator('#settled')).toHaveText('2');
  await expect(page.getByTestId('error')).toBeEmpty();
  await expect(page.getByTestId('loading')).toHaveText('true');
  await transition(page, 'pageshow');
  await expect.poll(() => reads.length).toBe(4);
  await settle(reads.slice(2), 'fresh');
  await expect(page.getByTestId('state-data')).toHaveText('fresh');
  await expect(page.getByTestId('error')).toBeEmpty();
  expect(errors).toEqual(expectedNetworkFailures());
});

test('beforeunload alone and tab hiding do not cancel active errors', async ({ page }) => {
  const { errors, reads } = await mountReader(page);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('beforeunload', { cancelable: true }));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await fail(reads);
  await expect(page.getByTestId('error')).toContainText('Failed to fetch');
  expect(errors.some(error => error.startsWith('useLiveQuery failed'))).toBe(true);
  expect(errors.some(error => error.startsWith('useLiveQueryState failed'))).toBe(true);
});

test('unmount releases lifecycle listeners and retires pending reads', async ({ page }) => {
  const { errors, reads } = await mountReader(page);
  await page.getByRole('button', { name: 'Unmount' }).click();
  await expect(page.getByTestId('state-data')).toHaveCount(0);
  await transition(page, 'pagehide');
  await transition(page, 'pageshow');
  await fail(reads);
  await expect(page.locator('#settled')).toHaveText('2');
  expect(reads).toHaveLength(2);
  expect(errors).toEqual(expectedNetworkFailures());
});
