import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { createFixtureService } from '../src/fixture-service.mjs';

const sentinel = `SYNTHETIC_L_${randomUUID()}`;
let allowed = [];
const observations = [];
const fixture = await createFixtureService({ sentinel, allowedOrigins: () => allowed,
  observe: event => observations.push(event) });
let html = await readFile(new URL('../dist/app.html', import.meta.url), 'utf8');
assert.equal(html.includes(sentinel), false);
html = html.replace('"__DEMO_CONNECTION__"', JSON.stringify({ endpoint: fixture.endpoint, serviceId: fixture.serviceId }));
const host = createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end('<!doctype html><title>Simulated SDK bridge (not a real client)</title><iframe title="Demo" sandbox="allow-scripts allow-same-origin" style="width:100%;height:1600px;border:0"></iframe>');
});
await new Promise(resolve => host.listen(0, '127.0.0.1', () => resolve(undefined)));
const address = host.address();
if (!address || typeof address === 'string') throw new Error('Host unavailable');
const url = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 1000 } });
const diagnostics = [];
const errors = [];
page.on('console', message => diagnostics.push(message.text()));
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(url);
  await page.evaluate(html => {
    const iframe = document.querySelector('iframe');
    window['observedMessages'] = [];
    window.addEventListener('message', event => {
      if (event.source !== iframe.contentWindow) return;
      const message = event.data;
      window['observedMessages'].push(message);
      if (message.method === 'ui/initialize') iframe.contentWindow.postMessage({ jsonrpc: '2.0', id: message.id,
        result: { protocolVersion: message.params.protocolVersion, hostInfo: { name: 'simulated-test-host', version: '1' }, hostCapabilities: {}, hostContext: { theme: 'light' } } }, location.origin);
    });
    iframe.srcdoc = html;
  }, html);
  const frame = page.frameLocator('iframe');
  await frame.locator('#connected').waitFor({ state: 'visible' });
  assert.equal(await frame.locator('#reachable').isVisible(), false);
  assert.equal(await frame.locator('#authorized').isVisible(), false);
  await frame.getByRole('button', { name: 'Verifica il servizio sintetico', exact: true }).click();
  await frame.getByRole('status').filter({ hasText: 'Servizio non verificato' }).waitFor();
  assert.equal(await frame.locator('#reachable').isVisible(), false);
  const observedOrigin = observations.at(-1).origin;
  assert.equal(observedOrigin, url);
  allowed = [observedOrigin];
  await frame.locator('#check').click();
  await frame.locator('#reachable').waitFor({ state: 'visible' });
  await frame.locator('#admit').click();
  await frame.locator('#authorized').waitFor({ state: 'visible' });
  assert.equal((await frame.locator('#local-data').textContent()).includes(sentinel), true);
  const methods = await page.evaluate(() => window['observedMessages'].map(message => message.method).filter(Boolean));
  assert.equal(methods.every(method => ['ui/initialize', 'ui/notifications/initialized', 'ui/notifications/size-changed'].includes(method)), true);
  assert.equal(JSON.stringify(await page.evaluate(() => window['observedMessages'])).includes(sentinel), false);
  assert.equal(diagnostics.join('\n').includes(sentinel), false);
  assert.equal(JSON.stringify(observations).includes(sentinel), false);
  await frame.locator('#lock').click();
  assert.equal(await frame.locator('#local-data').textContent(), '');
  assert.equal(await frame.locator('#authorized').isVisible(), false);
  let release = () => {};
  let heldResolve = (_value) => {};
  const held = new Promise(resolve => { heldResolve = resolve; });
  await page.route('**/fixture', async route => {
    const response = await route.fetch();
    heldResolve?.(undefined);
    await new Promise(resolve => { release = () => resolve(undefined); });
    await route.fulfill({ response }).catch(() => {});
  });
  await frame.locator('#check').click(); await frame.locator('#reachable').waitFor({ state: 'visible' });
  await frame.locator('#admit').click(); await held;
  await frame.locator('#lock').click(); release();
  await page.unroute('**/fixture');
  assert.equal(await frame.locator('#local-data').textContent(), '');
  assert.equal(await frame.locator('#authorized').isVisible(), false);
  await frame.locator('details').nth(1).locator('summary').click();
  await frame.getByText('Fonte inventata: lettera', { exact: false }).waitFor();
  await mkdir(new URL('../dist/evidence/', import.meta.url), { recursive: true });
  await page.screenshot({ path: new URL('../dist/evidence/simulated-giorno.png', import.meta.url).pathname, fullPage: true });
  await frame.locator('#theme').selectOption('grafite');
  await page.screenshot({ path: new URL('../dist/evidence/simulated-grafite.png', import.meta.url).pathname, fullPage: true });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const scale of [1, 2, 4]) {
      const appFrame = page.frames().find(candidate => candidate !== page.mainFrame());
      await appFrame.evaluate(scale => { document.documentElement.style.fontSize = `${scale * 100}%`; }, scale);
      assert.equal(await appFrame.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow at ${width}, scale ${scale}`);
    }
  }
  assert.deepEqual(errors, []);
  console.log('PASS simulated host: handshake, observed-origin CORS denial/admission, direct fixture, no sentinel in bridge/console/observations, lock, late reply, themes, details and responsive text. Not a real-client R/L qualification.');
} finally { await browser.close(); host.closeAllConnections(); host.close(); await fixture.close(); }
