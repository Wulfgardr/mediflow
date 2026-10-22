import { chromium } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';

const baseline = process.argv.includes('--baseline');
const label = process.argv.find(arg => arg.startsWith('--label='))?.split('=')[1] ?? (baseline ? 'before' : 'after');
assert.match(label, /^[a-z-]+$/);
const count = Number(process.argv.find(arg => arg.startsWith('--runs='))?.split('=')[1] ?? 5);
assert.ok(Number.isInteger(count) && count >= 1 && count <= 5);
const output = new URL('../dist/evidence/', import.meta.url);
await mkdir(output, { recursive: true });
const html = await readFile(new URL('../dist/app.html', import.meta.url));
const browser = await chromium.launch({ headless: true });
const runs = [];
try {
  for (let run = 0; run < count; run++) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference' });
    await page.addInitScript(() => {
      const metrics = window['metrics'] = { sizes: [], toolStart: 0, scrollCalls: 0, focusCalls: 0, animations: [], frames: [], reveals: [], animationGaps: [], followResize: false };
      const fetchOriginal = window.fetch;
      window.fetch = (...args) => {
        if (typeof args[1]?.body === 'string' && args[1].body.includes('"tools/call"')) metrics.toolStart = performance.timeOrigin + performance.now();
        return fetchOriginal(...args);
      };
      window.addEventListener('message', event => {
        if (event.data?.method === 'ui/notifications/size-changed') { metrics.sizes.push({ at: performance.now(), ...event.data.params }); if (metrics.followResize) window.scrollTo(0, document.documentElement.scrollHeight); }
      });
      /** @type {Array<[object, string, string]>} */
      const observedMethods = [[Element.prototype, 'scrollIntoView', 'scrollCalls'], [HTMLElement.prototype, 'focus', 'focusCalls']];
      for (const [prototype, method, counter] of observedMethods) {
        const original = prototype[method];
        prototype[method] = function (...args) { metrics[counter]++; return original.apply(this, args); };
      }
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (...args) { metrics.animations.push(args[1]); return animate.apply(this, args); };
      let last;
      function tick(now) {
        if (last !== undefined) {
          metrics.frames.push(now - last);
          if (metrics.reveals.some(reveal => now - reveal.start < Number(reveal.duration) + 32)) metrics.animationGaps.push(now - last);
        }
        last = now; requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
    await page.goto('http://localhost:8080/?server=mediflow-chat-demo&tool=mediflow_chat_demo_open&call=true');
    await page.waitForFunction(() => document.querySelector('iframe'));
    let appFrame;
    for (let attempt = 0; attempt < 100; attempt++) {
      for (const frame of page.frames()) {
        if (await frame.locator('#patient').count()) { appFrame = frame; break; }
      }
      if (appFrame) break;
      await page.waitForTimeout(50);
    }
    assert.ok(appFrame, 'reference host must mount the real UI resource');
    await appFrame.locator('#connected').waitFor({ state: 'visible' });
    await appFrame.evaluate(() => {
      const starts = new WeakMap();
      document.addEventListener('animationstart', event => {
        const reveal = { duration: event.target['getAnimations']()[0]?.effect.getTiming().duration, start: performance.now(), elapsedMs: 0 };
        starts.set(event.target, reveal);
        window['metrics'].reveals.push(reveal);
      });
      document.addEventListener('animationend', event => {
        const reveal = starts.get(event.target);
        if (reveal) reveal.elapsedMs = performance.now() - reveal.start;
      });
    });
    await page.waitForTimeout(500);
    const firstPaint = await appFrame.evaluate(() => performance.timeOrigin + performance.getEntriesByName('first-contentful-paint')[0].startTime);
    const toolStart = await page.evaluate(() => window['metrics'].toolStart);
    assert.ok(toolStart > 0 && firstPaint > toolStart, 'measure from actual tools/call to card FCP');
    const summary = appFrame.getByText('Promemoria dimostrativo', { exact: true });
    await summary.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, 300));
    await page.waitForTimeout(100);
    const scrollBefore = await page.evaluate(() => scrollY);
    const sizesBefore = await page.evaluate(() => window['metrics'].sizes.length);
    const nodesBefore = await appFrame.evaluate(() => {
      window['mainBefore'] = document.querySelector('main');
      window['summaryBefore'] = Array.from(document.querySelectorAll('summary')).find(e => e.textContent === 'Promemoria dimostrativo');
      return { scroll: document.scrollingElement.scrollTop, focus: document.activeElement.tagName };
    });
    const interactions = [];
    for (let click = 0; click < 6; click++) {
      await appFrame.evaluate(() => {
        window['latency'] = new Promise(resolve => document.addEventListener('click', event => {
          const start = event.timeStamp;
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - start)));
        }, { once: true, capture: true }));
      });
      await summary.click();
      interactions.push(await appFrame.evaluate(() => window['latency']));
      await page.waitForTimeout(350);
    }
    const themeLatencies = [];
    for (const theme of ['grafite', 'giorno']) {
      await appFrame.evaluate(() => {
        window['latency'] = new Promise(resolve => document.addEventListener('change', event => {
          const start = event.timeStamp;
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - start)));
        }, { once: true, capture: true }));
      });
      await appFrame.locator('#theme').selectOption(theme);
      themeLatencies.push(await appFrame.evaluate(() => window['latency']));
    }
    await page.waitForTimeout(350);
    const host = await page.evaluate(() => ({ ...window['metrics'], scroll: scrollY }));
    const app = await appFrame.evaluate(() => {
      const main = document.querySelector('main');
      const rect = main.getBoundingClientRect();
      return { ...window['metrics'], sameMain: main === window['mainBefore'], sameSummary: window['summaryBefore'].isConnected,
        left: rect.left, right: innerWidth - rect.right, background: getComputedStyle(document.body).backgroundColor,
        scroll: document.scrollingElement.scrollTop, active: document.activeElement.tagName };
    });
    const measured = { toolToCardFcpMs: firstPaint - toolStart, interactionsMs: interactions, themeMs: themeLatencies,
      resizeMessages: host.sizes.length - sizesBefore, scrollBefore, scrollAfter: host.scroll,
      app: { sameMain: app.sameMain, sameSummary: app.sameSummary, focusCalls: app.focusCalls, scrollCalls: app.scrollCalls,
        left: app.left, right: app.right, scrollBefore: nodesBefore.scroll, scrollAfter: app.scroll, active: app.active },
      hostAnimationDurationsMs: host.animations.slice(sizesBefore).map(a => typeof a === 'number' ? a : a?.duration),
      animationDurationsMs: app.reveals.map(reveal => reveal.duration), animationElapsedMs: app.reveals.map(reveal => reveal.elapsedMs), animationFrameGapsMs: app.animationGaps,
      maxFrameGapMs: Math.max(...app.frames), jankFrames: app.animationGaps.filter(ms => ms > 50).length };
    await page.evaluate(() => { window.scrollTo(0, 300); window['metrics'].followResize = true; });
    const policyBefore = await page.evaluate(() => scrollY);
    await summary.click();
    await page.waitForTimeout(350);
    measured.resizeFollowPolicy = { before: policyBefore, after: await page.evaluate(() => scrollY) };
    await page.evaluate(() => { window['metrics'].followResize = false; });
    runs.push(measured);
    if (run === 0) {
      await page.screenshot({ path: new URL(`reference-${label}.png`, output).pathname, fullPage: true });
      await appFrame.locator('#theme').selectOption('grafite');
      await page.screenshot({ path: new URL(`reference-${label}-grafite.png`, output).pathname, fullPage: true });
    }
    if (!baseline && run === 0 && !label.startsWith('negative-')) {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await summary.click();
      assert.equal(await appFrame.evaluate(() => document.getAnimations().length), 0, 'reduced motion disables reveals');
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await appFrame.waitForTimeout(100);
        assert.equal(await appFrame.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal overflow');
        await appFrame.locator('.diagnostics summary').click();
        await appFrame.locator('#origin').waitFor({ state: 'visible' });
        await appFrame.locator('.diagnostics summary').click();
      }
      await page.getByTitle('Switch to dark mode', { exact: true }).click();
      await appFrame.waitForFunction(() => document.documentElement.dataset.theme === 'grafite');
      assert.equal(await appFrame.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(26, 26, 26)', 'host surface is applied');
      await appFrame.locator('main').focus();
      const before = await appFrame.locator('main').evaluate(el => el.scrollTop);
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowDown');
      await appFrame.waitForTimeout(150);
      assert.notEqual(await appFrame.locator('main').evaluate(el => el.scrollTop), before, 'keyboard can scroll the reader');
    }
    await page.close();
  }
} finally { await browser.close(); }
const result = { label, node: process.version, browser: browser.version(), htmlBytes: html.byteLength, gzipBytes: gzipSync(html).byteLength, runs };
await writeFile(new URL(`reference-${label}.json`, output), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ...result, runs: runs.map(({ animationFrameGapsMs, ...run }) => ({ ...run, animationFrames: animationFrameGapsMs.length })) }, null, 2));
if (!baseline) {
  assert.ok(result.gzipBytes < 250_000, 'bundle gzip budget: 250000 bytes');
  for (const run of runs) {
    assert.ok(run.toolToCardFcpMs < 300, 'local tool-to-card FCP budget: 300ms');
    assert.ok(Math.max(...run.interactionsMs, ...run.themeMs) < 75, 'interaction presentation upper bound: 75ms');
    assert.ok(run.animationDurationsMs.length > 0, 'disclosure reveal animation was measured');
    assert.ok(run.animationDurationsMs.every(ms => ms <= 150), 'animation duration budget: 150ms');
    assert.ok(Math.max(0, ...run.animationFrameGapsMs) < 80, 'animation frame gap budget: 80ms');
    assert.ok(run.animationElapsedMs.every(ms => ms > 0 && ms < 180), 'animation completion budget: 180ms');
    assert.ok(run.jankFrames / Math.max(1, run.animationFrameGapsMs.length) < 0.05, 'animation jank budget: under 5% frames above 50ms');
    assert.equal(run.resizeFollowPolicy.after, run.resizeFollowPolicy.before, 'resize-follow conversation scroll must stay stable');
    assert.equal(run.resizeMessages, 0, 'disclosure and theme must not notify a resize');
    assert.equal(run.scrollAfter, run.scrollBefore, 'host conversation scroll must stay stable');
    assert.ok(run.app.sameMain && run.app.sameSummary, 'card DOM must remain connected');
    assert.equal(run.app.left, 0, 'no outer left band');
    assert.equal(run.app.right, 0, 'no outer right band');
  }
}
