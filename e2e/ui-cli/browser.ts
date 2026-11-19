import { chromium, type Browser, type Locator, type Page } from 'playwright';
import { setTimeout as wait } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isolatedChromeLaunch } from '../fixtures/secure-browser.ts';
import type { Action, Target } from './commands.ts';

export async function openBrowser(origin: string): Promise<{ browser: Browser; page: Page; failures: object[] }> {
  const browser = await chromium.launch(isolatedChromeLaunch(origin));
  try {
    const context = await browser.newContext({
      serviceWorkers: 'block',
      acceptDownloads: true,
      viewport: { width: 1320, height: 880 },
    });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin
      ? route.continue() : route.abort('blockedbyclient'));
    await context.routeWebSocket('**/*', socket => socket.close());
    const failures: object[] = [];
    context.on('response', response => {
      const address = new URL(response.url());
      if (address.origin === origin && address.pathname.startsWith('/api/') && response.status() >= 400 && failures.length < 20) {
        failures.push({ path: address.pathname, method: response.request().method(), status: response.status() });
      }
    });
    const page = await context.newPage();
    context.on('page', popup => { if (popup !== page) void popup.close().catch(() => {}); });
    page.setDefaultTimeout(5_000);
    await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    return { browser, page, failures };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

async function control(page: Page, target: Target, allowAbsent: boolean): Promise<Locator> {
  let within: Page | Locator = page;
  for (const part of Array.isArray(target) ? target : [target]) {
    const match: Locator = 'role' in part
      ? within.getByRole(part.role as Parameters<Page['getByRole']>[0], { name: part.name, exact: true })
      : within.getByLabel(part.label, { exact: true });
    if (!allowAbsent) await until(async () => await match.count() > 0,
      () => `Controllo assente: ${JSON.stringify(part)}`);
    const count = await match.count();
    if (count > 1) throw new Error(`Controllo ambiguo (${count} corrispondenze): ${JSON.stringify(part)}`);
    if (count === 0 && !allowAbsent) throw new Error(`Controllo assente: ${JSON.stringify(part)}`);
    within = match;
  }
  return within as Locator;
}

async function until(read: () => Promise<boolean>, message: () => string) {
  const end = performance.now() + 5_000;
  do {
    if (await read()) return;
    await wait(50);
  } while (performance.now() < end);
  throw new Error(message());
}

function pageAddress(page: Page): string {
  const address = new URL(page.url());
  return address.pathname + address.search + address.hash;
}

export async function drive(page: Page, action: Action, output: string): Promise<unknown> {
  const target = 'target' in action && action.target
    ? await control(page, action.target, action.op === 'expect' && action.state === 'hidden')
    : undefined;
  switch (action.op) {
    case 'discover':
      return { view: pageAddress(page), tree: await (target ?? page.locator('body')).ariaSnapshot() };
    case 'click':
      await target!.click();
      break;
    case 'focus':
      await target!.focus();
      await until(async () => await target!.and(page.locator(':focus')).count() === 1, () => 'Focus non raggiunto.');
      break;
    case 'scroll':
      await target!.scrollIntoViewIfNeeded();
      if (action.deltaY !== undefined) {
        await target!.hover();
        await page.mouse.wheel(0, action.deltaY);
      }
      break;
    case 'fill':
      await target!.fill(action.value);
      break;
    case 'select':
      await target!.selectOption({ label: action.value });
      break;
    case 'check':
      await target!.check();
      break;
    case 'press':
      if (target) await target.press(action.key);
      else await page.keyboard.press(action.key);
      break;
    case 'uploadText': {
      const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 5_000 }), target!.click()]);
      await chooser.setFiles({ name: `${action.file}.txt`, mimeType: 'text/plain', buffer: Buffer.from(action.value) });
      break;
    }
    case 'download': {
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 5_000 }), target!.click()]);
      const file = await download.path();
      if (!file) throw new Error('Download non disponibile.');
      const content = await readFile(file);
      await download.delete();
      return { view: pageAddress(page), name: download.suggestedFilename(), bytes: content.length,
        sha256: createHash('sha256').update(content).digest('hex') };
    }
    case 'screenshot': {
      const file = `${action.file}.png`;
      await page.screenshot({ path: join(output, file), animations: 'allow' });
      return { view: pageAddress(page), file };
    }
    case 'expect': {
      const matched = {
        visible: () => target!.isVisible(),
        hidden: async () => !await target!.isVisible(),
        focused: async () => await target!.and(page.locator(':focus')).count() === 1,
        enabled: () => target!.isEnabled(),
        selected: async () => await target!.getAttribute('aria-selected') === 'true',
        expanded: async () => await target!.getAttribute('aria-expanded') === 'true',
      };
      await until(matched[action.state], () => `Stato atteso non raggiunto: ${action.state}.`);
      return { view: pageAddress(page), state: action.state };
    }
    case 'expectText':
    case 'expectValue': {
      const read = action.op === 'expectText' ? () => target!.textContent() : () => target!.inputValue();
      await until(async () => {
        const actual = await read();
        return action.op === 'expectText' && action.contains ? (actual ?? '').includes(action.value) : actual === action.value;
      }, () => 'Il contenuto atteso non corrisponde.');
      return { view: pageAddress(page), verified: action.op };
    }
    case 'back':
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10_000 });
      break;
  }
  return { view: pageAddress(page) };
}
