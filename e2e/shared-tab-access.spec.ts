import { expect, test } from './fixtures/isolated-runtime';
import { bootstrapUnlockedSession, openPatientSection, openUnlockedDocument, unlockIfNeeded } from './utils';
import { documentRequests } from './fixtures/trusted-web-request';
import type { Page } from '@playwright/test';
import { agentVisitPassphrase, agentVisitPin } from './agent-visit-utils';

const pinAccount = test.extend({ existingPin: agentVisitPin });

async function saveSharedNote(page: Page, note: string) {
    await page.getByRole('combobox', { name: 'Tipo di voce' }).selectOption('note');
    await page.getByRole('textbox', { name: 'Resoconto clinico', exact: true }).fill(note);
    await page.getByRole('button', { name: 'Rivedi', exact: true }).click();
    const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/entries' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Conferma e registra', exact: true }).click();
    expect((await saved).status()).toBe(201);
}

pinAccount('renewing tab B preserves tab A authority and transfers the key without another passphrase', async ({ page, context, isolatedRuntime }, testInfo) => {
    test.setTimeout(120000);
    await bootstrapUnlockedSession(page, agentVisitPin);
    await page.getByRole('complementary', { name: 'MediFlow', exact: true }).getByRole('link', { name: 'Impostazioni', exact: true }).click();
    await page.getByRole('link', { name: 'Accesso', exact: true }).click();
    await page.getByLabel('PIN attuale', { exact: true }).first().fill(agentVisitPin);
    await page.getByLabel('Nuova passphrase', { exact: true }).fill(agentVisitPassphrase);
    await page.getByLabel('Conferma nuova passphrase', { exact: true }).fill(agentVisitPassphrase);
    await page.getByRole('button', { name: 'Prepara il nuovo kit', exact: true }).click();
    const kit = page.getByTestId('recovery-kit');
    const download = page.waitForEvent('download');
    await kit.getByRole('button', { name: 'Scarica kit di recupero' }).click();
    await download;
    await kit.getByRole('checkbox').check();
    await kit.getByRole('button', { name: 'Attiva la nuova passphrase' }).click();
    await page.getByRole('button', { name: 'Rinnova accesso', exact: true }).click();
    await expect(page.getByLabel('Passphrase', { exact: true })).toBeEnabled();
    await page.getByLabel('Passphrase', { exact: true }).fill(agentVisitPassphrase);
    await page.getByRole('button', { name: 'Sblocca', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Navigazione principale', exact: true })).toBeVisible();
    const second = await context.newPage();
    try {
        await second.goto(isolatedRuntime.url);
        await expect(second.getByRole('button', { name: 'Rinnova accesso', exact: true })).toBeVisible();
        const locks: string[] = [];
        context.on('request', request => { if (request.url().endsWith('/api/auth/lock')) locks.push(request.url()); });
        await second.getByRole('button', { name: 'Rinnova accesso', exact: true }).click();
        await expect(second.getByRole('navigation', { name: 'Navigazione principale', exact: true })).toBeVisible();
        const authority = await documentRequests(page).get('/api/auth/check');
        expect(authority.status()).toBe(200);
        expect((await authority.json()).hasSession).toBe(true);
        expect(locks).toEqual([]);
        await expect(page.getByRole('navigation', { name: 'Navigazione principale', exact: true })).toBeVisible();
        const patientId = await page.evaluate(async () => {
            const response = await fetch('/api/patients', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ firstName: 'Persona', lastName: 'SinteticaSchede', taxCode: 'RSSMRA80A01F205X', birthDate: '1980-01-01T00:00:00.000Z', address: '', phone: '', diagnoses: [] }) });
            if (!response.ok) throw new Error('SYNTHETIC_PATIENT_FAILED');
            return (await response.json()).id as string;
        });
        await page.getByRole('navigation', { name: 'Navigazione principale', exact: true }).getByRole('link', { name: 'Pazienti', exact: true }).click();
        await page.getByRole('option', { name: /SinteticaSchede/ }).press('Enter');
        await expect(page).toHaveURL(new RegExp(`/patients/${patientId}/modules$`));
        await page.getByRole('link', { name: 'Nuova voce', exact: true }).click();
        await saveSharedNote(page, 'SYNTHETIC_SHARED_TAB_CLINICAL_NOTE');
        await second.getByRole('complementary', { name: 'MediFlow', exact: true }).getByRole('link', { name: 'Pazienti', exact: true }).click();
        await second.getByRole('option', { name: /SinteticaSchede/ }).click();
        await second.getByRole('link', { name: 'Apri scheda paziente', exact: true }).click();
        await openPatientSection(second, 'diario');
        await expect(second.getByText('SYNTHETIC_SHARED_TAB_CLINICAL_NOTE', { exact: true })).toBeVisible();
        await second.screenshot({ path: testInfo.outputPath('voce-aperta-con-la-chiave-condivisa.png'), fullPage: true });
        await page.getByRole('complementary', { name: 'MediFlow', exact: true }).getByRole('link', { name: 'Impostazioni', exact: true }).click();
        await page.getByRole('link', { name: 'Agenti', exact: true }).click();
        await page.getByLabel('PIN di conferma', { exact: true }).fill(agentVisitPin);
        await page.getByLabel('Autorizzo il passaggio di documenti e trascrizioni al fornitore scelto', { exact: true }).check();
        const creation = page.waitForResponse(response => response.url().endsWith('/api/agent-mandates') && response.request().method() === 'POST');
        await page.getByRole('button', { name: 'Crea mandato', exact: true }).click();
        expect((await creation).status()).toBe(201);
        await second.getByRole('complementary', { name: 'MediFlow', exact: true }).getByRole('link', { name: 'Impostazioni', exact: true }).click();
        await second.getByRole('link', { name: 'Agenti', exact: true }).click();
        await second.getByLabel('PIN di conferma', { exact: true }).fill(agentVisitPin);
        await second.getByLabel('Autorizzo il passaggio di documenti e trascrizioni al fornitore scelto', { exact: true }).check();
        const secondCreation = second.waitForResponse(response => response.url().endsWith('/api/agent-mandates') && response.request().method() === 'POST');
        await second.getByRole('button', { name: 'Crea mandato', exact: true }).click();
        expect((await secondCreation).status()).toBe(201);
        await second.screenshot({ path: testInfo.outputPath('seconda-scheda-sbloccata.png'), fullPage: true });
        await page.getByRole('button', { name: /Blocca/ }).first().click();
        await expect.poll(async () => (await (await documentRequests(second).get('/api/auth/check')).json()).hasSession).toBe(false);
        await expect(second.getByLabel('Passphrase', { exact: true })).toBeVisible({ timeout: 20000 });
    } finally { await second.close(); }
});

for (const donor of ['fresh', 'restored', 'legacy'] as const) pinAccount('a renewed tab can rotate the PIN and recover the same note with a ' + donor + ' donor session', async ({ page, context, isolatedRuntime }) => {
    await bootstrapUnlockedSession(page, agentVisitPin);
    const patientId = await page.evaluate(async () => {
        const response = await fetch('/api/patients', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ firstName: 'Persona', lastName: 'Sintetica PIN', taxCode: 'RSSMRA80A01F205X', birthDate: '1980-01-01T00:00:00.000Z', address: '', phone: '', diagnoses: [] }) });
        if (!response.ok) throw new Error('SYNTHETIC_PATIENT_FAILED');
        return (await response.json()).id as string;
    });
    await openUnlockedDocument(page, `/patients/${patientId}/modules`, agentVisitPin);
    await page.getByRole('link', { name: 'Nuova voce', exact: true }).click();
    const note = 'SYNTHETIC_PIN_ROTATION_NOTE';
    await saveSharedNote(page, note);
    if (donor === 'legacy') await page.evaluate(() => {
        const stored = JSON.parse(sessionStorage.getItem('mediflow_session_key')!);
        sessionStorage.setItem('mediflow_session_key', JSON.stringify(stored.jwk ?? stored));
    });
    if (donor !== 'fresh') {
        await page.reload();
        await expect(page.getByRole('navigation', { name: 'Navigazione principale', exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Sblocca MediFlow' })).toBeHidden();
    }
    const second = await context.newPage();
    try {
        await second.goto(isolatedRuntime.url + '/settings/accesso');
        await second.getByRole('button', { name: 'Rinnova accesso', exact: true }).click();
        const replacement = '86428642';
        const fillPinChange = async (pin: string) => {
            const currentPin = second.locator('#current-pin');
            if (!await currentPin.isVisible()) await second.getByRole('button', { name: 'Cambio PIN', exact: true }).click();
            await currentPin.fill(pin);
            await second.locator('#new-pin').fill(replacement);
            await second.locator('#confirm-pin').fill(replacement);
        };
        const changePin = second.getByRole('button', { name: 'Aggiorna PIN', exact: true });
        let status = 0;
        second.on('response', response => {
            if (response.url().endsWith('/api/auth/change-pin') && response.request().method() === 'POST') status = response.status();
        });
        if (donor === 'fresh') {
            await fillPinChange('12344321');
            await changePin.click();
            await expect(second.getByText('PIN attuale non valido o chiave non verificabile.', { exact: true })).toBeVisible();
            expect(status).toBe(0);
        }
        if (donor === 'legacy') {
            await fillPinChange(agentVisitPin);
            await changePin.click();
            await expect(second.getByText('Per cambiare il PIN, blocca le schede e accedi con il PIN attuale.', { exact: true })).toBeVisible();
            expect(status).toBe(0);
            await second.getByRole('button', { name: 'Blocca', exact: true }).click();
            await expect(second.getByLabel('PIN operatore', { exact: true })).toBeVisible();
            await unlockIfNeeded(second, agentVisitPin);
        }
        await fillPinChange(agentVisitPin);
        await changePin.click();
        await expect.poll(() => status).toBe(200);
        await expect(second.getByLabel('PIN operatore', { exact: true })).toBeVisible();
        await unlockIfNeeded(second, replacement);
        await openUnlockedDocument(second, `/patients/${patientId}/modules`, replacement);
        await openPatientSection(second, 'diario');
        await expect(second.getByText(note, { exact: true })).toBeVisible();
    } finally { await second.close(); }
});
