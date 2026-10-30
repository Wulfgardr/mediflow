import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { trustedWebRequestHeaders } from './trusted-web-request';

export async function openBrowserZoomFixture(baseURL: string) {
    const root = await mkdtemp(join(tmpdir(), 'mediflow-browser-zoom-'));
    const extension = join(root, 'extension');
    await mkdir(extension);
    await writeFile(join(extension, 'manifest.json'), JSON.stringify({ manifest_version: 3,
        name: 'Synthetic E2E browser zoom', version: '1.0', permissions: ['tabs'],
        background: { service_worker: 'worker.js' } }));
    await writeFile(join(extension, 'worker.js'), 'chrome.runtime.onInstalled.addListener(() => {});');
    const context = await chromium.launchPersistentContext(join(root, 'profile'), {
        baseURL, channel: 'chromium', headless: true, viewport: { width: 1440, height: 1000 },
        extraHTTPHeaders: trustedWebRequestHeaders(baseURL),
        args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const page = context.pages()[0];
    return { page, async setZoom(factor: number) {
        const actual = await worker.evaluate(async factor => {
            const tabs = (globalThis as unknown as { chrome: { tabs: {
                query(filter: { active: boolean }): Promise<{ id: number }[]>;
                setZoom(id: number, zoom: number): Promise<void>;
                getZoom(id: number): Promise<number>;
            } } }).chrome.tabs;
            const [tab] = await tabs.query({ active: true });
            await tabs.setZoom(tab.id, factor);
            return tabs.getZoom(tab.id);
        }, factor);
        expect(actual).toBeCloseTo(factor, 8);
        await expect.poll(() => page.evaluate(() => innerWidth)).toBe(Math.round(1440 / factor));
    }, async close() {
        await context.close();
        await rm(root, { recursive: true, force: true });
    } };
}
