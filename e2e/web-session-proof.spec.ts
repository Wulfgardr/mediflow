import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { expect, test } from '@playwright/test';
import { bootstrapUnlockedSession, openPatientSection, unlockIfNeeded } from './utils';

test.use({ trace: 'off', video: 'off', screenshot: 'off' });

test.beforeEach(({ baseURL }) => {
    const dataDirectory = process.env.MEDIFLOW_DATA_DIR;
    test.skip(!baseURL || new URL(baseURL).hostname !== '127.0.0.1' || !dataDirectory || !isAbsolute(dataDirectory)
        || process.env.MEDIFLOW_E2E_DISABLE_LEGACY_COPY !== '1' || !existsSync(join(dataDirectory, 'SYNTHETIC_ONLY')),
    'Richiede un runtime locale con archivio sintetico.');
});

test('il medico accede, legge una scheda, registra una nota e scarica il backup', async ({ page }) => {
    test.setTimeout(120_000);
    const pin = process.env.E2E_PIN || '1234';
    const note = 'Nota sintetica per la verifica della sessione Web.';
    await bootstrapUnlockedSession(page, pin);

    const patientId = await page.evaluate(async () => {
        const marker = crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
        const response = await fetch('/api/patients', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                firstName: 'Medica', lastName: 'Sintetica', taxCode: `TST${marker}A`, birthDate: '1980-01-01',
            }),
        });
        if (response.status !== 201) throw new Error(`Synthetic patient: HTTP ${response.status}`);
        return (await response.json()).id as string;
    });

    await page.goto(`/patients/${patientId}/modules`);
    await expect(page.getByRole('heading', { name: 'Sblocca MediFlow' })).toBeVisible();
    await unlockIfNeeded(page, pin);
    await expect(page.getByTestId('lume-scheda-header')).toContainText('Medica');
    await openPatientSection(page, 'diario');
    await page.getByRole('link', { name: 'Nuova voce', exact: true }).click();

    await page.getByRole('combobox', { name: 'Tipo di voce' }).selectOption('note');
    await page.getByRole('textbox', { name: 'Resoconto clinico', exact: true }).fill(note);
    await page.getByRole('button', { name: 'Rivedi', exact: true }).click();
    const persisted = page.waitForResponse(response =>
        new URL(response.url()).pathname === '/api/entries' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Conferma e registra', exact: true }).click();
    const saved = await persisted;
    expect(saved.status()).toBe(201);
    const entryId = (await saved.json()).id as string;
    await expect(page.getByRole('region', { name: 'Esito della registrazione' })).toContainText(note);
    await page.getByRole('link', { name: 'Chiudi la voce', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/patients/${patientId}/modules$`));
    await openPatientSection(page, 'diario');
    await expect(page.locator('#diario')).toContainText(note);

    await page.getByRole('link', { name: 'Impostazioni', exact: true }).click();
    await page.locator('a[href="/settings/backup"]:visible').first().click();
    await page.getByRole('checkbox', { name: /Il file portabile contiene/ }).check();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Scarica Backup', exact: true }).click();
    const backup = await download;
    expect(backup.suggestedFilename()).toMatch(/\.mediflow$/u);
    try {
        expect(await backup.failure()).toBeNull();
        const stream = await backup.createReadStream();
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(Buffer.from(chunk));
        const artifact = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        expect(artifact.payload.patients.some((record: { id: string }) => record.id === patientId)).toBe(true);
        expect(artifact.payload.entries.some((record: { id: string; type: string }) => record.id === entryId && record.type === 'note')).toBe(true);
    } finally { await backup.delete(); }

    const peer = await page.context().newPage();
    await peer.goto(`/patients/${patientId}/modules`);
    await peer.getByRole('button', { name: 'Rinnova accesso', exact: true }).click();
    await expect(peer.getByTestId('lume-scheda-header')).toContainText('Medica');
    await peer.getByRole('button', { name: 'Blocca', exact: true }).click();
    await expect(peer.getByRole('heading', { name: 'Sblocca MediFlow' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sblocca MediFlow' })).toBeVisible();
});

test('il client API locale autorizzato legge la lista pazienti', async ({ baseURL }) => {
    const token = process.env.MEDIFLOW_SESSION_PROOF_SYNTHETIC_API_TOKEN;
    if (!token || !baseURL) {
        test.skip(true, 'Richiede il token generato dal runner sintetico.');
        return;
    }
    const response = await fetch(new URL('/api/v1/patients', baseURL), {
        headers: { Authorization: `Bearer ${token}` },
        redirect: 'error',
    });
    expect(response.status).toBe(200);
});
