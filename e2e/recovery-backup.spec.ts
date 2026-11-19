import fs from 'node:fs';
import { test, expect } from './fixtures/isolated-runtime';
import { bootstrapUnlockedSession } from './utils';
import { trustedWebRequestHeaders } from './fixtures/trusted-web-request';

test.describe.configure({ retries: 0 });
const phrase = 'Passphrase recupero soltanto sintetica';

test('complete backup is encrypted in the browser and verification never claims a proven restore', async ({ page, baseURL }, testInfo) => {
    await page.route('**/api/siss/session-status', route => route.fulfill({ json: { status: 'unavailable', source: 'fixture', checkpoints: [] } }));
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    expect((await page.request.post('/api/system/recovery-backup', { data: {}, headers: trustedWebRequestHeaders(baseURL) })).status()).toBe(401);
    await page.setViewportSize({ width: 390, height: 844 });
    await bootstrapUnlockedSession(page, '1234', {
        displayName: 'Medico Sintetico Recupero', ambulatoryName: 'Studio Sintetico Recupero', passphrase: phrase,
    });
    const navigation = page.getByRole('navigation', { name: 'Navigazione principale', exact: true });
    await expect(navigation).toBeVisible();
    await navigation.locator('summary').filter({ hasText: /^Altro$/u }).click();
    await page.getByRole('link', { name: 'Impostazioni', exact: true }).click();
    await page.locator('a[href="/settings/backup"]:visible').click();
    const panel = page.getByRole('region', { name: 'Backup completo di recupero', exact: true });
    await expect(panel).toBeVisible();
    const requested = page.waitForRequest(request =>
        new URL(request.url()).pathname === '/api/system/recovery-backup' && request.method() === 'POST');
    const downloadEvent = page.waitForEvent('download');
    await panel.getByRole('button', { name: 'Crea backup completo cifrato', exact: true }).click();
    const download = await downloadEvent;
    const artifactPath = testInfo.outputPath('synthetic.mediflow-recovery'); await download.saveAs(artifactPath);
    const bytes = fs.readFileSync(artifactPath);
    expect(bytes.subarray(0, 8).toString()).toBe('MDFREC01');
    expect(bytes.includes(Buffer.from('SQLite format 3'))).toBe(false);
    expect(bytes.includes(Buffer.from('Medico Sintetico Recupero'))).toBe(false);
    await expect(panel.getByRole('status')).toContainText('Non è ancora stato provato un ripristino.');
    await panel.getByTestId('recovery-backup-verify').setInputFiles(artifactPath);
    await expect(panel.getByRole('status')).toContainText('Cifratura e integrità del file verificate');
    await expect(panel.getByRole('status')).toContainText('Il ripristino non è ancora provato');
    bytes[bytes.length - 1] ^= 1;
    await panel.getByTestId('recovery-backup-verify').setInputFiles({ name: 'altered.mediflow-recovery', mimeType: 'application/octet-stream', buffer: bytes });
    await expect(panel.getByRole('status')).toContainText('File non verificato');
    await panel.getByText('Recupero su un computer nuovo', { exact: true }).click();
    await expect(panel).toContainText('il programma non può impedire l’uso di una copia su un altro computer');
    await panel.screenshot({ path: testInfo.outputPath('recovery-backup-mobile.png') });
    expect((await requested).postData() ?? '').not.toContain(phrase);
    expect(pageErrors).toEqual([]);
});
