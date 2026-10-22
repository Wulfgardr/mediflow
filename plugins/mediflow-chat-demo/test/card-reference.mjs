import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import os from 'node:os';
const scenario = process.argv.find(arg => arg.startsWith('--scenario='))?.split('=')[1];
const deliveryDelay = process.argv.includes('--negative-delivery');
const negative = process.argv.includes('--negative-feedback');
const synchronousWork = process.argv.includes('--negative-longtask');
const count = Number(process.argv.find(arg => arg.startsWith('--runs='))?.split('=')[1] ?? 30);
assert.ok(Number.isInteger(count) && count >= 30);
const output = new URL('../dist/card-evidence/', import.meta.url);
await mkdir(output, { recursive: true });
const html = await readFile(new URL('../dist/card.html', import.meta.url));
assert.ok(gzipSync(html).byteLength < 250_000, 'bundle gzip <250000 bytes');
const browser = await chromium.launch({ headless: true, channel: 'chromium' });
const runs = [];
async function mounted(page) {
  await page.waitForFunction(() => document.querySelector('iframe'));
  for (let attempt = 0; attempt < 150; attempt++) {
    for (const frame of page.frames()) if (await frame.locator('#share').count()) return frame;
    await page.waitForTimeout(30);
  }
  console.log(await page.locator('body').innerText());
  console.log(page.frames().map(frame => frame.url()));
  throw new Error('reference host did not mount the UI resource');
}
async function latency(frame, page, action, event = 'click') {
  await frame.evaluate(event => {
    window['latency'] = new Promise(resolve => document.addEventListener(event, e => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - e.timeStamp)));
    }, { once: true, capture: true }));
  }, event);
  await action();
  return frame.evaluate(() => window['latency']);
}
const warmContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
try {
  for (const activeScenario of scenario ? [scenario] : ['forgery', 'turn', 'tool-call']) {
    const page = await warmContext.newPage();
    const calls = [];
    page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/mcp')) calls.push(request.postDataJSON()); });
    let release = () => {}, received = () => {};
    const held = new Promise(resolve => { release = () => resolve(undefined); });
    const seen = new Promise(resolve => { received = () => resolve(undefined); });
    if (activeScenario === 'turn' || activeScenario === 'tool-call') await page.route('**/mcp', async route => {
      const request = route.request();
      const body = request.method() === 'POST' ? request.postDataJSON() : undefined;
      if (body?.params?.arguments?.operation === 'prepare') {
        const response = await route.fetch(); received(); await held; await route.fulfill({ response });
      } else await route.continue();
    });
    await page.goto('http://localhost:8080/card.html');
    const frame = await mounted(page);
    if (activeScenario === 'turn' || activeScenario === 'tool-call') {
      await seen;
      if (activeScenario === 'tool-call') await page.evaluate(() => window['cardBridge'].sendToolInput({ arguments: { operation: 'prepare' } }));
      else await page.evaluate(() => window['cardBridge'].sendToolResult({ content: [{ type: 'text', text: 'Nuovo turno.' }] }));
      await page.waitForTimeout(50); release();
      await page.waitForTimeout(150);
      assert.equal(await frame.locator('#share').isDisabled(), true, 'Astra P2: held preparation cannot revive the previous turn');
      assert.match(await frame.locator('#status').innerText(), /Nuovo turno/);
      assert.equal(await frame.locator('#card').isHidden(), true);
    } else {
      await frame.waitForFunction(() => !document.querySelector('#share').hasAttribute('disabled'));
      assert.equal(await frame.locator('script').count(), 0, 'bootstrap key is absent from the readable DOM');
      const view = calls.find(call => call.params?.arguments?.operation === 'prepare').params.arguments.view;
      const result = await frame.evaluate(async view => {
        let next = 8000;
        const forge = args => new Promise(resolve => {
          const id = next++;
          const listener = event => { if (event.data?.id === id) { window.removeEventListener('message', listener); resolve(event.data.result); } };
          window.addEventListener('message', listener);
          window.parent.postMessage({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'mediflow_synthetic_card', arguments: args } }, '*');
        });
        const prepared = await forge({ operation: 'prepare', view });
        const nonce = prepared?._meta?.consentNonce;
        return forge({ operation: 'share', view, ...(nonce ? { nonce } : {}) });
      }, view);
      assert.equal(result?.structuredContent, undefined, 'Astra P2: forged frame messages cannot mint consent, even with the attempt nonce');
      assert.equal(result?.isError, true);
      assert.equal(await frame.locator('#card').isHidden(), true);
    }
    await page.close();
  }
  for (const temperature of ['cold', 'warm']) for (let run = 0; run < (scenario ? 0 : count); run++) {
    const context = temperature === 'cold' ? await browser.newContext({ viewport: { width: 1440, height: 1000 } }) : undefined;
    const page = await (context ?? warmContext).newPage();
    if (deliveryDelay) await page.route('**/mcp', async route => {
      const body = route.request().method() === 'POST' ? route.request().postDataJSON() : undefined;
      if (body?.params?.arguments?.operation === 'share') { const response = await route.fetch(); await new Promise(resolve => setTimeout(resolve, 2200)); await route.fulfill({ response }); }
      else await route.continue();
    });
    page.on('pageerror', error => console.log('REFERENCE_PAGE_ERROR', error.message));
    await page.addInitScript(() => {
      window['metrics'] = { sizes: 0, frames: [], results: [], tasks: [] };
      window.addEventListener('message', event => {
        window['metrics'].frames.push(event.data);
        if (event.data?.method === 'ui/notifications/size-changed') window['metrics'].sizes++;
        if (event.data?.method === 'ui/notifications/tool-result') window['metrics'].results.push(event.data.params);
      });
      new PerformanceObserver(list => window['metrics'].tasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration, name: e.name, attribution: e['attribution']?.map(a => ({ name: a.name, type: a.containerType, src: a.containerSrc })) })))).observe({ type: 'longtask', buffered: true });
    });
    const responses = [];
    page.on('response', async response => {
      if (response.url().endsWith('/mcp') && response.headers()['content-type']?.includes('application/json')) {
        try { responses.push(await response.json()); } catch {}
      }
    });
    const start = performance.now();
    await page.goto('http://localhost:8080/card.html');
    const frame = await mounted(page);
    await frame.evaluate(() => {
      window['widgetTasks'] = [];
      new PerformanceObserver(list => window['widgetTasks'].push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration, name: e.name, attribution: e['attribution']?.map(a => ({ name: a.name, type: a.containerType, src: a.containerSrc })) })))).observe({ type: 'longtask', buffered: true });
    });
    await frame.locator('#share').waitFor({ state: 'visible' });
    await frame.waitForFunction(() => !document.querySelector('#share').hasAttribute('disabled'));
    const readyMs = performance.now() - start;
    assert.equal(await frame.locator('#card').isHidden(), true, 'no bytes before consent');
    await frame.locator('#share').evaluate(button => button.click());
    assert.equal(await frame.locator('#card').isHidden(), true, 'programmatic click cannot consent');
    assert.equal(responses.some(frame => frame.result?.structuredContent), false);
    if (negative) await frame.evaluate(() => document.querySelector('#share').addEventListener('click', () => { const end = performance.now() + 150; while (performance.now() < end) {} }, { capture: true }));
    if (synchronousWork) await frame.evaluate(() => document.querySelector('#share').addEventListener('click', () => {
      const end = performance.now() + 75;
      while (performance.now() < end) {}
    }, { capture: true }));
    const shareStart = performance.now();
    const feedbackMs = await latency(frame, page, () => frame.locator('#share').click());
    if (negative) assert.ok(feedbackMs <= 100, 'click feedback budget mutation');
    await frame.locator('#card').waitFor({ state: 'visible' });
    await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const shareMs = performance.now() - shareStart;
    const usefulMs = readyMs + shareMs;
    assert.match(await frame.locator('#status').innerText(), /condivisa/);
    const delivered = responses.find(frame => frame.result?.structuredContent)?.result;
    const actual = delivered?.structuredContent;
    assert.deepEqual(await page.evaluate(() => window['cardContexts']), [{ content: [{ type: 'text', text: delivered._meta.approvedPayload }] }], 'accepted context retains the exact broker serialization');
    assert.ok(actual, 'capture real broker result across MCP HTTP');
    assert.equal(JSON.stringify(responses).includes('IDENTIFYING_SENTINEL'), false);
    const rendered = await frame.locator('#card').textContent();
    for (const value of [actual.pseudonym, ...actual.therapies.flatMap(t => [t.medicine, t.dose, t.frequency]), ...actual.history.flatMap(h => [h.condition, h.note, h.relativeTime, h.sourceRef]), ...actual.measures.flatMap(m => [m.kind, m.value, m.unit])]) assert.ok(rendered.includes(String(value).replace(/\{\{MF_PII_[^{}]+\}\}/gu, '[omesso]')), value);
    const before = await page.evaluate(() => ({ y: scrollY, sizes: window['cardSizes'].length }));
    const detailMs = await latency(frame, page, () => frame.locator('summary').first().click());
    const themes = [];
    for (const theme of ['grafite', 'giorno']) {
      themes.push(await latency(frame, page, () => frame.locator('#theme').selectOption(theme), 'change'));
      assert.equal(await frame.evaluate(() => document.documentElement.dataset.theme), theme);
    }
    const after = await page.evaluate(() => ({ y: scrollY, sizes: window['cardSizes'].length }));
    assert.deepEqual(after, before, 'no host scroll or resize on disclosure/theme');
    const rect = await frame.locator('main').evaluate(el => ({ left: el.getBoundingClientRect().left, right: innerWidth - el.getBoundingClientRect().right }));
    assert.deepEqual(rect, { left: 0, right: 0 });
    const tasks = await frame.evaluate(() => window['widgetTasks']);
    if (tasks.some(task => task.duration > 50)) console.log('LONGTASK', JSON.stringify(tasks));
    runs.push({ temperature, readyMs, shareMs, usefulMs, feedbackMs, detailMs, themes, tasks });
    if (run === 0 && temperature === 'warm') {
      for (const width of [390, 768, 1440]) for (const theme of ['giorno', 'grafite']) {
        await page.setViewportSize({ width, height: 1000 });
        await frame.locator('#theme').selectOption(theme);
        assert.equal(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'host viewport must also fit');
        assert.equal(await frame.evaluate(() => innerWidth), width, 'exercise the actual requested view width');
        await page.screenshot({ path: new URL(`${theme}-${width}.png`, output).pathname, fullPage: true });
      }
      await frame.locator('summary').first().focus();
      const open = await frame.locator('details').first().getAttribute('open');
      await page.keyboard.press('Enter');
      assert.notEqual(await frame.locator('details').first().getAttribute('open'), open, 'keyboard toggles details');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await frame.locator('summary').first().click();
      assert.equal(await frame.evaluate(() => document.getAnimations().length), 0);
      await page.evaluate(() => window['cardBridge'].sendToolResult({ content: [{ type: 'text', text: 'Nuovo turno.' }] }));
      await frame.waitForFunction(() => document.querySelector('#card').hasAttribute('hidden'));
      assert.equal(await frame.locator('#card').isHidden(), true, 'next-turn notification clears the old view');

      assert.equal(await frame.locator('#card').isHidden(), true);
    }
    await page.close(); await context?.close();
  }
  if (!scenario) {
  const latePage = await warmContext.newPage();
  let release = () => {}, received = () => {};
  const held = new Promise(resolve => { release = () => resolve(undefined); });
  const seen = new Promise(resolve => { received = () => resolve(undefined); });
  await latePage.route('**/mcp', async route => {
    const request = route.request();
    const body = request.method() === 'POST' ? request.postDataJSON() : undefined;
    if (body?.method === 'tools/call' && body.params?.arguments?.operation === 'share') {
      const response = await route.fetch(); received(); await held;
      await route.fulfill({ response });
    } else await route.continue();
  });
  await latePage.goto('http://localhost:8080/card.html');
  const lateFrame = await mounted(latePage);
  await lateFrame.waitForFunction(() => !document.querySelector('#share').hasAttribute('disabled'));
  await lateFrame.locator('#share').focus(); await latePage.keyboard.press('Enter');
  await Promise.race([seen, new Promise((_, reject) => setTimeout(() => reject(new Error('late-response fixture did not intercept share')), 5_000))]);
  await lateFrame.locator('#revoke').click();
  release(); await latePage.waitForTimeout(150);
  assert.equal(await lateFrame.locator('#card').isHidden(), true, 'a late approved response cannot repopulate a closed view');
  assert.equal(await lateFrame.locator('#status').innerText(), 'Scheda chiusa.');
  await latePage.close();
  }
} finally { await browser.close(); }
if (scenario) { console.log(`PASS: Astra ${scenario} scenario`); process.exit(0); }
const summary = values => { const sorted = values.toSorted((a,b) => a-b); return { p50: sorted[Math.ceil(sorted.length * .5)-1], p95: sorted[Math.ceil(sorted.length * .95)-1], max: sorted.at(-1) }; };
const serverLog = await readFile(new URL('../.local/reference-server.log', import.meta.url), 'utf8');
const preparationMs = [...serverLog.matchAll(/^REFERENCE_PREPARATION_MS ([0-9.]+)$/gm)].map(match => Number(match[1]));
assert.equal(preparationMs.length, count * 2 + 5, 'every broker preparation, including adversarial and late-response scenarios, must be measured');
const report = { node: process.version, browser: browser.version(), browserChannel: 'chromium', hardware: { cpu: os.cpus()[0].model, ram: os.totalmem(), os: os.release() },
  scope: 'Current broker card only. Simulated neural runner. Extended ADR workload and desktop R NOT QUALIFIED.',
  gzipBytes: gzipSync(html).byteLength, preparationMs, preparation: summary(preparationMs), runs, summaries: Object.fromEntries(['cold','warm'].map(t => [t, summary(runs.filter(r => r.temperature === t).map(r => r.usefulMs))])),
  feedback: summary(runs.map(r => r.feedbackMs)), interaction: summary(runs.flatMap(r => [r.detailMs, ...r.themes])) };
await writeFile(new URL('reference.json', output), JSON.stringify(report, null, 2) + '\n');
assert.ok(report.summaries.cold.p95 <= 5_000, 'cold useful view <=5s p95');
assert.ok(report.summaries.warm.p95 <= 2_000, 'warm useful view <=2s p95');
assert.equal(report.runs.flatMap(r => r.tasks).filter(t => t.name === 'self' && t.duration > 50).length, 0, 'no attributable widget long task >50ms');
assert.ok(report.preparation.p95 <= 2_000, 'current broker card preparation <=2s p95; simulated neural runner');
assert.ok(report.feedback.p95 <= 100, 'click feedback <=100ms p95');
assert.ok(report.interaction.p95 <= 200, 'disclosure/theme <=200ms p95');
console.log(JSON.stringify({ ...report, runs: runs.length }, null, 2));
