import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const browser = await chromium.launch({ headless: true, channel: 'chromium' });
const outcomes = [];
const only = process.argv.find(arg => arg.startsWith('--case='))?.slice(7);
async function check(name, query, run) {
  if (only && only !== name) return;
  const page = await browser.newPage({ colorScheme: 'dark' });
  const responses = [];
  page.on('response', async response => {
    if (response.url().endsWith('/mcp') && response.headers()['content-type']?.includes('application/json')) {
      try {
        const body = await response.json(); responses.push(body);
        const html = body.result?.contents?.[0]?.text;
        const binding = html?.match(/\{"view":"([^"]+)","gestureKey":/);
        if (binding) await page.evaluate(view => { window['cardViewForTest'] = view; }, binding[1]);
      } catch {}
    }
  });
  await page.addInitScript(() => {
    window['contextRequests'] = [];
    window.addEventListener('message', event => {
      if (event.data?.method === 'ui/update-model-context') window['contextRequests'].push(event.data.params);
    });
  });
  try {
    if (name.includes('expiry')) await page.clock.install();
    await page.goto(`http://localhost:8080/card.html?${query}`);
    const frame = await (async () => {
      for (let i = 0; i < 100; i++) {
        for (const frame of page.frames()) if (await frame.locator('#share').count()) return frame;
        await page.waitForTimeout(30);
      }
      throw new Error('reference host did not mount the resource');
    })();
    await frame.waitForFunction(() => !document.querySelector('#share').hasAttribute('disabled'));
    assert.equal(await frame.locator('#card').isHidden(), true);
    assert.deepEqual(await page.evaluate(() => window['contextRequests']), []);
    await run({ page, frame, responses });
    outcomes.push({ name, pass: true });
  } catch (error) { outcomes.push({ name, pass: false, error: error.message }); }
  finally { await page.close(); }
}
async function share(frame) {
  await frame.locator('#share').click();
  await frame.locator('#card').waitFor({ state: 'visible' });
}
try {
  await check('inline', 'inline', async ({ frame, responses }) => {
    assert.ok(responses.some(r => r.result?.content?.[0]?.text === 'Apri la vista per scegliere se condividere la scheda sintetica.'));
    await share(frame);
  });
  await check('delivery', '', async ({ page, frame, responses }) => {
    await frame.locator('#share').evaluate(button => button.click());
    assert.deepEqual(await page.evaluate(() => window['contextRequests']), [], 'untrusted gesture must not deliver');
    await share(frame);
    const payload = responses.find(r => r.result?.structuredContent)?.result;
    const requests = await page.evaluate(() => window['contextRequests']);
    assert.equal(requests.length, 1, 'consent sends exactly one context update');
    assert.deepEqual(requests[0], { content: [{ type: 'text', text: payload._meta.approvedPayload }] });
    assert.deepEqual(JSON.parse(requests[0].content[0].text), payload.structuredContent);
    assert.deepEqual(await page.evaluate(() => window['cardContexts']), requests, 'official reference host accepts the exact context');
    await frame.locator('#revoke').click();
    await frame.locator('#share').evaluate(button => button.click());
    assert.equal((await page.evaluate(() => window['contextRequests'])).length, 1, 'revocation cannot deliver again');
  });
  for (const operation of ['open', 'revoke', 'prepare']) await check(`late-share-${operation}`, '', async ({ page, frame }) => {
    let release = () => {}, seen = () => {}, session;
    const held = new Promise(resolve => { release = () => resolve(undefined); });
    const intercepted = new Promise(resolve => { seen = () => resolve(undefined); });
    await page.route('**/mcp', async route => {
      const request = route.request();
      const body = request.method() === 'POST' ? request.postDataJSON() : undefined;
      if (body?.params?.arguments?.operation !== 'share') return route.continue();
      session = request.headers()['mcp-session-id'];
      const response = await route.fetch();
      assert.equal((await response.json()).result.isError, undefined);
      seen(); await held; await route.fulfill({ response });
    });
    await frame.locator('#share').click(); await intercepted;
    try {
      const result = await page.evaluate(async ({ session, operation }) => {
        const response = await fetch('http://localhost:3017/mcp', { method: 'POST', headers: {
          'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Session-Id': session,
        }, body: JSON.stringify({ jsonrpc: '2.0', id: 9100, method: 'tools/call', params: {
          name: operation === 'open' ? 'mediflow_synthetic_card_open' : 'mediflow_synthetic_card',
          arguments: operation === 'open' ? {} : { operation, view: window['cardViewForTest'] },
        } }) });
        return response.json();
      }, { session, operation });
      assert.equal(result.result.isError, undefined, 'authoritative owner transition completed');
    } finally { release(); }
    await frame.waitForFunction(() => !document.querySelector('#status').textContent.includes('in corso'));
    assert.deepEqual(await page.evaluate(() => window['contextRequests']), [], 'no late context after owner invalidation');
    assert.deepEqual(await page.evaluate(() => window['cardContexts']), []);
    assert.equal(await frame.locator('#card').isHidden(), true);
    assert.equal(await frame.locator('#card').textContent(), '');
  });
  for (const phase of ['before', 'denied', 'revoked']) await check(`frame-boundary-${phase}`, '', async ({ page, frame, responses }) => {
    if (phase === 'denied') {
      await frame.locator('#deny').click();
      await frame.waitForFunction(() => document.querySelector('#status').textContent === 'Nessun contenuto condiviso.');
    }
    if (phase === 'revoked') {
      await share(frame); await frame.locator('#revoke').click();
      await frame.waitForFunction(() => document.querySelector('#status').textContent === 'Scheda chiusa.');
    }
    const baseline = await page.evaluate(() => window['cardContexts']);
    const chosen = `ATTACKER_CHOSEN_SYNTHETIC_BYTES_${phase}`;
    const reply = await frame.evaluate(text => new Promise(resolve => {
      const listen = event => { if (event.data?.id === 8101) { window.removeEventListener('message', listen); resolve(event.data); } };
      window.addEventListener('message', listen);
      window.parent.postMessage({ jsonrpc: '2.0', id: 8101, method: 'ui/update-model-context', params: { content: [{ type: 'text', text }] } }, '*');
    }), chosen);
    assert.deepEqual(reply.result, {}, 'bridge trusts the frame, not broker HMAC');
    assert.deepEqual(await page.evaluate(() => window['cardContexts']), [...baseline, { content: [{ type: 'text', text: chosen }] }]);
    const approved = responses.filter(r => r.result?._meta?.approvedPayload);
    assert.equal(approved.length, phase === 'revoked' ? 1 : 0);
    assert.equal(await frame.locator('#card').textContent(), '');
    assert.equal(await frame.locator('#card').isHidden(), true);
  });
  await check('frame-csp', '', async ({ page, frame }) => {
    await frame.evaluate(() => {
      const button = document.createElement('button'); button.id = 'csp-probe'; button.textContent = 'CSP probe';
      button.addEventListener('click', async () => {
        window['__inlineProbe'] = false;
        const script = document.createElement('script'); script.textContent = "window['__inlineProbe'] = true"; document.head.append(script);
        let evalBlocked = false; try { window.eval('1 + 1'); } catch { evalBlocked = true; }
        const external = document.createElement('script'); external.src = 'https://untrusted.invalid/card.js';
        const externalBlocked = await new Promise(resolve => { external.onload = () => resolve(false); external.onerror = () => resolve(true); document.head.append(external); });
        window['__cspResult'] = { inlineBlocked: !window['__inlineProbe'], evalBlocked, externalBlocked };
      });
      document.querySelector('main').append(button);
    });
    await frame.locator('#csp-probe').click();
    await frame.waitForFunction(() => window['__cspResult']);
    assert.deepEqual(await frame.evaluate(() => window['__cspResult']), { inlineBlocked: true, evalBlocked: true, externalBlocked: true });
    await share(frame);
    assert.equal((await page.evaluate(() => window['cardContexts'])).length, 1, 'hashed bundle remains functional');
  });
  for (const failure of ['missing-attempt', 'denied', 'missing-receipt', 'wrong-attempt']) await check(`delivery-${failure}`, '', async ({ page, frame }) => {
    await page.route('**/mcp', async route => {
      const request = route.request();
      const body = request.method() === 'POST' ? request.postDataJSON() : undefined;
      const operation = body?.params?.arguments?.operation;
      if (operation !== 'deliver' && !(failure === 'missing-attempt' && operation === 'share')) return route.continue();
      const response = await route.fetch(); const data = await response.json();
      if (failure === 'missing-attempt') delete data.result._meta.attemptId;
      if (failure === 'denied') data.result = { isError: true, content: [{ type: 'text', text: 'denied' }] };
      if (failure === 'missing-receipt') delete data.result._meta;
      if (failure === 'wrong-attempt') data.result._meta.attemptId = '0'.repeat(64);
      await route.fulfill({ response, json: data });
    });
    await frame.locator('#share').click();
    await frame.waitForFunction(() => document.querySelector('#status').textContent.includes('non disponibile'));
    assert.deepEqual(await page.evaluate(() => window['contextRequests']), []);
    assert.deepEqual(await page.evaluate(() => window['cardContexts']), []);
    assert.equal(await frame.locator('#card').textContent(), '');
    assert.equal(await frame.locator('#card').isHidden(), true);
  });
  await check('theme', '', async ({ page, frame }) => {
    await page.evaluate(() => window['cardBridge'].sendHostContextChange({ theme: 'dark', styles: { variables: { '--color-background-primary': '#101216', '--color-text-primary': '#e9ecef' } } }));
    await frame.waitForFunction(() => document.documentElement.dataset.theme === 'grafite');
    await frame.locator('#theme').selectOption('giorno');
    assert.equal(await frame.locator('main').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)', 'Giorno uses its Lume field despite a dark host');
    assert.equal(await frame.locator('main').evaluate(el => getComputedStyle(el).color), 'rgb(20, 22, 26)');
    await frame.locator('#theme').selectOption('grafite');
    assert.equal(await frame.locator('main').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(26, 29, 34)');
    await page.evaluate(() => window['cardBridge'].sendHostContextChange({ theme: 'light' }));
    await frame.waitForFunction(() => document.documentElement.dataset.theme === 'giorno');
    assert.equal(await frame.locator('main').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)');
  });
  await check('placeholders', '', async ({ frame, responses }) => {
    await share(frame);
    assert.match(JSON.stringify(responses.find(r => r.result?.structuredContent)), /MF_PII_/);
    for (const theme of ['giorno', 'grafite']) {
      await frame.locator('#theme').selectOption(theme);
      assert.doesNotMatch(await frame.locator('#card').textContent(), /MF_PII_/);
      assert.match(await frame.locator('#card').textContent(), /\[omesso\]/);
    }
  });
  await check('expiry', '', async ({ frame, page }) => {
    await share(frame);
    await page.clock.fastForward(31_000);
    assert.equal(await frame.locator('#card').isVisible(), true, 'shared card survives the decision deadline');
    assert.match(await frame.locator('#status').innerText(), /condivisa/);
    await frame.locator('#revoke').click();
    assert.equal(await frame.locator('#card').isHidden(), true);
  });
  await check('undecided-expiry', '', async ({ frame, page }) => {
    await page.clock.fastForward(31_000);
    assert.equal(await frame.locator('#share').isDisabled(), true);
    assert.equal(await frame.locator('#card').isHidden(), true);
    assert.deepEqual(await page.evaluate(() => window['contextRequests']), []);
  });
  for (const kind of ['input', 'result']) await check(`turn-${kind}`, 'thread', async ({ page, frame }) => {
    await share(frame);
    await page.evaluate(kind => kind === 'input'
      ? window['cardBridge'].sendToolInput({ arguments: {} })
      : window['cardBridge'].sendToolResult({ content: [{ type: 'text', text: 'Apri la vista per scegliere se condividere la scheda sintetica.' }] }), kind);
    await frame.locator('#card').waitFor({ state: 'hidden', timeout: 1500 });
    assert.match(await frame.locator('#status').innerText(), /Nuovo turno/);
    assert.equal((await page.evaluate(() => window['contextRequests'])).length, 1);
  });
  await check('denied-context', 'reject-context', async ({ page, frame }) => {
    await frame.locator('#share').click();
    await frame.waitForFunction(() => /non disponibile|non supporta/.test(document.querySelector('#status').textContent));
    assert.equal(await frame.locator('#card').isHidden(), true);
    assert.deepEqual(await page.evaluate(() => window['cardContexts']), []);
  });
} finally { await browser.close(); }
const output = new URL('../dist/card-evidence/', import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(new URL('desktop-regressions.json', output), JSON.stringify(outcomes, null, 2) + '\n');
console.log(JSON.stringify(outcomes, null, 2));
assert.ok(outcomes.length && outcomes.every(result => result.pass), 'desktop regressions');
