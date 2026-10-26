import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { bootstrapUnlockedSession, unlockIfNeeded } from './utils';
import { trustedArchiveWebRequestHeaders } from './fixtures/trusted-web-request';

test('archived summaries do not attribute the current model, before or after locking', async ({ page }) => {
    const pin = process.env.E2E_PIN || '1234';
    await bootstrapUnlockedSession(page, pin);
    const archiveHeaders = await trustedArchiveWebRequestHeaders(page);
    const marker = randomUUID();
    const created = await page.request.post('/api/patients', { headers: archiveHeaders, data: {
        firstName: 'Lettura footer', lastName: `Sintetico ${marker.slice(0, 8)}`,
        taxCode: `LBL${marker.replaceAll('-', '').slice(0, 13).toUpperCase()}`,
    } });
    expect(created.status()).toBe(201);
    const patient = await created.json() as { id: string };
    const baseline = await page.request.get(`/api/patients/${patient.id}`);
    expect(baseline.status()).toBe(200);
    const { version } = await baseline.json() as { version: number };
    const updated = await page.request.put(`/api/patients/${patient.id}`, { headers: archiveHeaders, data: {
        version, documentInsights: JSON.stringify([{
            id: marker, date: new Date().toISOString(), fileName: 'Evidenza sintetica',
            rawMarkdown: 'Test di cancellazione.', summary: 'Nessun dato reale.', extractedData: {},
        }]),
    } });
    expect(updated.status()).toBe(200);
    const reread = await page.request.get(`/api/patients/${patient.id}`);
    expect(reread.status()).toBe(200);
    expect((await reread.json()).documentInsights).toContain(marker);
    const reads: string[] = [];
    const errors: string[] = [];
    page.on('console', message => {
        if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
        const pathname = new URL(request.url()).pathname;
        if (pathname === '/api/settings/aiModel' || pathname === '/api/settings/aiModel_clinical') {
            reads.push(pathname);
        }
    });
    try {
        await page.goto(`/patients/${patient.id}/modules#documenti`);
        await page.getByRole('button', { name: 'Sintesi archiviate · 1', exact: true }).click();
        const archive = page.getByTestId('document-insights-archive');
        await archive.getByRole('button').filter({ hasText: 'Evidenza sintetica' }).click();
        await expect(archive.getByText('Nessun dato reale.', { exact: true })).toBeVisible();
        await expect(archive).toContainText('Il modello usato per ciascuna sintesi non è registrato nell’archivio.');
        await expect(archive).not.toContainText('Modello configurato ora:');
        await page.waitForLoadState('networkidle');
        expect(reads).toEqual([]);
        const confirmed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/lock');
        await page.getByRole('button', { name: 'Blocca', exact: true }).click();
        expect((await confirmed).status()).toBe(200);
        await expect(page.getByRole('heading', { name: 'Sblocca MediFlow', exact: true })).toBeVisible();
        await expect(archive).toHaveCount(0);
        await page.waitForLoadState('networkidle');
        expect(reads).toEqual([]);
        expect(errors).toEqual([]);
        await unlockIfNeeded(page, pin);
        await expect(page.getByRole('navigation', { name: 'Navigazione principale', exact: true })).toBeVisible();
        await page.waitForLoadState('networkidle');
        expect(reads).toEqual([]);
        expect(errors).toEqual([]);
    } finally {
        if (await page.getByRole('navigation', { name: 'Navigazione principale', exact: true }).isVisible()) {
            const current = await page.request.get(`/api/patients/${patient.id}`);
            expect(current.status()).toBe(200);
            const { version } = await current.json() as { version: number };
            expect((await page.request.delete(`/api/patients/${patient.id}`, { headers: archiveHeaders, data: { version } })).status()).toBe(200);
        }
    }
});
