/* @Codex: real authenticated reads and lock; only response delivery is delayed. */
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { bootstrapUnlockedSession, unlockIfNeeded } from './utils';

test('locking retires the pending model footer read before its response or fallback', async ({ page }) => {
    const pin = process.env.E2E_PIN || '1234';
    await bootstrapUnlockedSession(page, pin);
    const marker = randomUUID();
    const created = await page.request.post('/api/patients', { data: {
        firstName: 'Lettura footer', lastName: `Sintetico ${marker.slice(0, 8)}`,
        taxCode: `LBL${marker.replaceAll('-', '').slice(0, 13).toUpperCase()}`,
    } });
    expect(created.status()).toBe(201);
    const patient = await created.json() as { id: string };
    const baseline = await page.request.get(`/api/patients/${patient.id}`);
    expect(baseline.status()).toBe(200);
    const { version } = await baseline.json() as { version: number };
    // @Codex: persisted insights belong to the versioned update contract;
    // patient creation intentionally does not accept this field.
    const updated = await page.request.put(`/api/patients/${patient.id}`, { data: {
        version, documentInsights: JSON.stringify([{
            id: marker, date: new Date().toISOString(), fileName: 'Evidenza sintetica',
            rawMarkdown: 'Test di cancellazione.', summary: 'Nessun dato reale.', extractedData: {},
        }]),
    } });
    expect(updated.status()).toBe(200);
    const reread = await page.request.get(`/api/patients/${patient.id}`);
    expect(reread.status()).toBe(200);
    expect((await reread.json()).documentInsights).toContain(marker);
    let received = () => {};
    const arrival = new Promise<void>(resolve => { received = resolve; });
    let release = () => {};
    const delivery = new Promise<void>(resolve => { release = resolve; });
    const reads: string[] = [];
    const aborted: string[] = [];
    const errors: Array<{ text: string; url: string; locked: boolean }> = [];
    const postLockUnauthorizedUrls = new Set<string>();
    let locked = false;
    const lateReads: string[] = [];
    page.on('console', message => {
        if (message.type() === 'error') errors.push({ text: message.text(), url: message.location().url, locked });
    });
    page.on('pageerror', error => errors.push({ text: error.message, url: '', locked }));
    page.on('response', response => {
        if (locked && response.status() === 401) postLockUnauthorizedUrls.add(response.url());
    });
    page.on('request', request => {
        const pathname = new URL(request.url()).pathname;
        if (pathname === '/api/auth/lock' && request.method() === 'POST') locked = true;
        if (pathname === '/api/settings/aiModel' || pathname === '/api/settings/aiModel_clinical') {
            reads.push(pathname);
            if (locked) lateReads.push(pathname);
        }
    });
    page.on('requestfailed', request => {
        if (new URL(request.url()).pathname === '/api/settings/aiModel_clinical') aborted.push(request.failure()?.errorText ?? '');
    });
    await page.route('**/api/settings/aiModel_clinical', async route => {
        const response = await route.fetch();
        expect([200, 404]).toContain(response.status());
        received();
        await delivery;
        await route.fulfill({ response });
    });
    try {
        await page.goto(`/patients/${patient.id}/modules#documenti`);
        await arrival;
        const confirmed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/lock');
        await page.getByRole('button', { name: 'Blocca', exact: true }).click();
        expect((await confirmed).status()).toBe(200);
        await expect(page.getByRole('heading', { name: 'Sblocca MediFlow', exact: true })).toBeVisible();
        // Development StrictMode can retire the first hook lifetime and mount the
        // replacement before the lock. Both reads are real pending page reads:
        // locking must abort every one, without a legacy fallback or a late read.
        const readsAtLock = [...reads];
        expect(readsAtLock).not.toHaveLength(0);
        expect(readsAtLock).toEqual(readsAtLock.map(() => '/api/settings/aiModel_clinical'));
        await expect.poll(() => aborted).toEqual(readsAtLock.map(() => 'net::ERR_ABORTED'));
        release();
        await page.waitForLoadState('networkidle');
        expect(reads).toEqual(readsAtLock);
        expect(lateReads).toEqual([]);
        // Chromium may report an intentionally retired authenticated read as a
        // console 401. Ignore only that response after lock when its resource
        // URL is present in the corresponding response stream.
        expect(errors.filter(error => !(error.locked
            && /401 \(Unauthorized\)/u.test(error.text)
            && error.url.length > 0
            && postLockUnauthorizedUrls.has(error.url)))).toEqual([]);
        await page.unrouteAll({ behavior: 'wait' });
        locked = false;
        await unlockIfNeeded(page, pin);
        await expect(page.getByRole('navigation', { name: 'Navigazione principale', exact: true })).toBeVisible();
        await page.waitForLoadState('networkidle');
        expect(errors).toEqual([]);
    } finally {
        release();
        await page.unrouteAll({ behavior: 'wait' });
        // Preserve a failed fixture for triage; remove only after ordinary unlock.
        if (await page.getByRole('navigation', { name: 'Navigazione principale', exact: true }).isVisible()) {
            const current = await page.request.get(`/api/patients/${patient.id}`);
            expect(current.status()).toBe(200);
            const { version } = await current.json() as { version: number };
            expect((await page.request.delete(`/api/patients/${patient.id}`, { data: { version } })).status()).toBe(200);
        }
    }
});
