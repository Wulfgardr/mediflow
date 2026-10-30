import { expect, type Locator, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { openBrowserZoomFixture } from './browser-zoom';
import { assertNoHorizontalOverflow } from '../utils';

export const settingsClosure = process.env.SETTINGS_CLOSURE === '1';
export async function closureGallery(page: Page, zoom: Awaited<ReturnType<typeof openBrowserZoomFixture>>,
    directory: string | undefined, name: string, target: Locator) {
    if (!settingsClosure) return;
    expect(directory, 'Directory esplicita per le prove aggiuntive').toBeTruthy();
    await mkdir(directory!, { recursive: true });
    for (const theme of ['giorno', 'grafite']) for (const size of ['1440', '768', '390', '320', 'zoom-200', 'zoom-400']) {
        await page.setViewportSize({ width: 1440, height: 1000 }); await zoom.setZoom(1);
        if (size.startsWith('zoom')) await zoom.setZoom(size === 'zoom-200' ? 2 : 4);
        else await page.setViewportSize({ width: Number(size), height: 1000 });
        await page.evaluate(theme => {
            const value = theme === 'giorno' ? 'light' : 'dark';
            document.documentElement.classList.remove('light', 'dark'); document.documentElement.classList.add(value);
            document.documentElement.style.colorScheme = value;
        }, theme);
        await target.evaluate(element => element.scrollIntoView({ block: 'center' }));
        const rect = await target.boundingBox();
        expect(rect).not.toBeNull();
        expect(rect!.y).toBeGreaterThanOrEqual(-1);
        expect(rect!.y + rect!.height).toBeLessThanOrEqual(await page.evaluate(() => innerHeight) + 1);
        expect(await target.evaluate(element => {
            const r = element.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            return element === hit || element.contains(hit);
        })).toBe(true);
        await assertNoHorizontalOverflow(page, [{ label: name, selector: 'document' }]);
        await page.screenshot({ path: `${directory}/${name}-${theme}-${size}.png`, animations: 'disabled' });
    }
    await page.setViewportSize({ width: 1440, height: 1000 }); await zoom.setZoom(1);
}
