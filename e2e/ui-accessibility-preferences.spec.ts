import { join } from 'node:path';
import type { Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { expect, test } from './fixtures/isolated-runtime';
import { documentRequests } from './fixtures/trusted-web-request';
import { bootstrapUnlockedSession, unlockIfNeeded } from './utils';

const motion = 'uiReduceMotion';
const transparency = 'uiReduceTransparency';
const pin = '1234';

async function mountPreferences(page: Page, open: () => Promise<unknown>) {
    const reads = [motion, transparency].map(key => page.waitForResponse(response =>
        new URL(response.url()).pathname === '/api/settings/' + key && response.request().method() === 'GET'));
    await open();
    for (const response of await Promise.all(reads)) expect(response.status()).toBe(200);
    await page.waitForLoadState('networkidle');
}

test('accessibility defaults are read-only and legacy preferences migrate once', async ({ page, isolatedRuntime }) => {
    await mountPreferences(page, () => bootstrapUnlockedSession(page, pin));
    const db = new Database(join(isolatedRuntime.dataDirectory, 'medical.db'), { fileMustExist: true });
    const values = () => db.prepare('SELECT key, value FROM settings WHERE key IN (?, ?) ORDER BY key').all(motion, transparency);
    const audits = () => db.prepare("SELECT subject_ref FROM audit_events WHERE event_type = 'settings.updated' AND subject_ref IN (?, ?) ORDER BY subject_ref")
        .pluck().all(motion, transparency);
    const persist = db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    const reload = async () => { await page.reload(); await unlockIfNeeded(page, pin); };
    try {
        expect(values()).toEqual([]);
        expect(audits()).toEqual([]);

        persist.run(motion, 'true');
        persist.run(transparency, ' False ');
        await mountPreferences(page, reload);
        await expect(page.locator('html')).toHaveAttribute('data-ui-reduce-motion', 'true');
        await expect(page.locator('html')).toHaveAttribute('data-ui-reduce-transparency', 'false');
        expect(values()).toEqual([{ key: motion, value: 'true' }, { key: transparency, value: ' False ' }]);
        expect(audits()).toEqual([]);

        db.prepare('DELETE FROM settings WHERE key=?').run(motion);
        persist.run(transparency, 'true');
        await mountPreferences(page, reload);
        expect(values()).toEqual([{ key: motion, value: 'true' }, { key: transparency, value: 'false' }]);
        expect(audits()).toEqual([motion, transparency]);

        const web = documentRequests(page);
        const alreadyApplied = await Promise.all([
            web.put('/api/settings/' + motion, { data: { value: true, expectedValue: null } }),
            web.put('/api/settings/' + transparency, { data: { value: false, expectedValue: 'true' } }),
        ]);
        expect(alreadyApplied.map(response => response.status())).toEqual([200, 200]);
        await mountPreferences(page, reload);
        expect(values()).toEqual([{ key: motion, value: 'true' }, { key: transparency, value: 'false' }]);
        expect(audits()).toEqual([motion, transparency]);
    } finally { db.close(); }
});
