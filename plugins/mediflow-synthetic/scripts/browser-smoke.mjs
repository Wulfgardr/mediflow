import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { viewModel } from '../src/fixture.mjs';

// A simulated host exercises the released App/Extensions postMessage bridge.
// This is browser evidence, not installation or actual Codex host qualification.
const html = await readFile(new URL('../dist/app.html', import.meta.url), 'utf8');
const browser = await chromium.launch({ headless: true });
try {
  for (const supported of [true, false]) {
    const page = await browser.newPage({ viewport: { width: 840, height: 820 } });
    const errors = [], requests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => requests.push(request.url()));
    await page.route('**/*', (route) => route.abort());
    await page.setContent('<html><body style="margin:0"><iframe title="Synthetic review" style="width:100%;height:810px;border:0"></iframe></body></html>');
    await page.evaluate(({ html, supported, fixture }) => {
      const iframe = document.querySelector('iframe');
      window.updates = [];
      window.addEventListener('message', (event) => {
        if (event.source !== iframe.contentWindow) return;
        const message = event.data;
        function send(value) { iframe.contentWindow.postMessage({ jsonrpc: '2.0', ...value }, '*'); }
        if (message.method === 'ui/initialize') {
          send({ id: message.id, result: { protocolVersion: message.params.protocolVersion,
            hostInfo: { name: 'synthetic-browser-test-host', version: '1' },
            hostCapabilities: supported ? { experimental: { 'openai/modelContext': {} } } : {},
            hostContext: { theme: 'light' } } });
        } else if (message.method === 'ui/notifications/initialized') {
          send({ method: 'ui/notifications/tool-result', params: { content: [], structuredContent: fixture } });
        } else if (message.method === 'ui/update-model-context') {
          window.updates.push(message.params);
          send({ id: message.id, result: { _meta: { 'openai/modelContext': { updateId: 'synthetic-browser-update-1' } } } });
        } else if (message.id !== undefined) {
          send({ id: message.id, error: { code: -32601, message: 'Not supported by synthetic test host' } });
        }
      });
      iframe.srcdoc = html;
    }, { html, supported, fixture: viewModel('review') });
    const frame = page.frameLocator('iframe');
    await frame.getByLabel('Risultato da revisionare', { exact: true }).check();
    assert.equal(await page.evaluate(() => window.updates.length), 0);
    const attach = frame.getByRole('button', { name: 'Aggiungi l’esempio alla conversazione', exact: true });
    if (supported) {
      await attach.click(); await frame.getByRole('button', { name: 'Annulla', exact: true }).click();
      assert.equal(await page.evaluate(() => window.updates.length), 0);
      await attach.click(); await frame.getByRole('button', { name: 'Conferma aggiunta', exact: true }).click();
      await frame.getByRole('status').filter({ hasText: 'Esempio aggiunto' }).waitFor();
      assert.equal(await page.evaluate(() => window.updates.length), 1);
      await attach.click(); await frame.getByRole('button', { name: 'Conferma aggiunta', exact: true }).click();
      await frame.getByRole('status').filter({ hasText: 'già stato aggiunto' }).waitFor();
      assert.equal(await page.evaluate(() => window.updates.length), 1);
      await page.screenshot({ path: new URL('../dist/synthetic-review.png', import.meta.url).pathname });
    } else {
      assert.equal(await attach.isDisabled(), true);
      assert.equal(await page.evaluate(() => window.updates.length), 0);
    }
    await page.setViewportSize({ width: 360, height: 820 });
    const appFrame = page.frames().find((candidate) => candidate !== page.mainFrame());
    assert.equal(await appFrame.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []); assert.deepEqual(requests, []);
    await page.close();
  }
  console.log('Browser bridge smoke passed: confirmation, cancellation, repeat, unsupported host, narrow layout, no network requests. Simulated host only.');
} finally { await browser.close(); }
