import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { test as standalone } from './fixtures/isolated-runtime';
import { documentRequests } from './fixtures/trusted-web-request';
import { bootstrapUnlockedSession, onboardingPassphrase, openPatientSection, unlockIfNeeded } from './utils';

standalone.use({ trace: 'off', video: 'off', screenshot: 'off' });

async function recordNote(page: Page, note: string): Promise<string> {
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
    return entryId;
}

async function documentSession(page: Page): Promise<string | undefined> {
    const observed = page.waitForRequest(request => new URL(request.url()).pathname === '/api/auth/check');
    expect(await (await documentRequests(page).get('/api/auth/check')).json()).toMatchObject({ hasSession: true });
    return (await observed).headers()['x-mediflow-web-session'];
}

async function lockAndWaitForConfirmation(page: Page): Promise<void> {
    const received = page.waitForResponse(response =>
        new URL(response.url()).pathname === '/api/auth/lock' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Blocca', exact: true }).click();
    const response = await received;
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ state: 'server_invalidation_confirmed' });
    await expect(page.getByRole('heading', { name: 'Sblocca MediFlow' })).toBeVisible();
}

standalone('al primo avvio il medico accede, legge una scheda, registra una nota e scarica il backup', async ({ page, isolatedRuntime }) => {
    standalone.setTimeout(180_000);
    const pin = process.env.E2E_PIN || '1234';
    const note = 'Nota sintetica per la verifica della sessione Web.';
    const operator = { displayName: 'Ada E2E', ambulatoryName: 'Studio E2E Sessione' };
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Chi sei?' })).toBeVisible();
    await bootstrapUnlockedSession(page, pin, operator);
    const profile = await page.evaluate(async () => {
        const response = await fetch('/api/auth/profile');
        if (!response.ok) throw new Error(`Synthetic profile: HTTP ${response.status}`);
        return response.json();
    });
    expect(profile).toMatchObject(operator);
    await lockAndWaitForConfirmation(page);
    await bootstrapUnlockedSession(page, pin, operator);

    const navigation = page.getByRole('navigation', { name: 'Navigazione principale', exact: true });
    await navigation.getByRole('link', { name: 'Agenda', exact: true }).click();
    await navigation.getByRole('link', { name: 'Pazienti', exact: true }).click();
    await page.getByRole('link', { name: 'Nuova scheda', exact: true }).click();
    await page.getByRole('textbox', { name: /^Nome\b/u }).fill('Medica');
    await page.getByRole('textbox', { name: /^Cognome\b/u }).fill('Sintetica');
    await page.getByLabel('Identificativo', { exact: true }).selectOption('none');
    await page.getByRole('checkbox', { name: 'Conosco solo l’anno' }).check();
    await page.getByRole('spinbutton', { name: 'Anno di nascita stimato' }).fill('1980');
    await page.getByRole('button', { name: 'Crea scheda', exact: true }).click();
    await expect(page.getByRole('complementary', { name: 'Lente paziente: Sintetica Medica', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Apri scheda paziente', exact: true }).click();
    await expect(page).toHaveURL(/\/patients\/[^/]+\/modules$/u);
    const patientId = new URL(page.url()).pathname.split('/')[2];
    await expect(page.getByTestId('lume-scheda-header')).toContainText('Medica');
    await openPatientSection(page, 'diario');
    const entryId = await recordNote(page, note);
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
        const exportedNote = artifact.payload.entries.find((record: { id: string }) => record.id === entryId);
        expect(exportedNote).toMatchObject({ id: entryId, type: 'note', content: expect.stringMatching(/^ENC:/u) });
    } finally { await backup.delete(); }

    await standalone.step('la ricarica di /settings/backup lascia entrare con la credenziale senza bloccare le schede', async () => {
        await expect(page).toHaveURL(/\/settings\/backup$/u);
        await page.reload();
        await expect(page.getByRole('heading', { name: 'Sblocca MediFlow' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Blocca tutte le schede', exact: true })).toBeHidden();
        const passphrase = page.getByLabel('Passphrase', { exact: true });
        await expect(passphrase).toBeEnabled();
        await passphrase.fill(onboardingPassphrase(pin, operator));
        await page.getByRole('button', { name: 'Sblocca', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Sblocca MediFlow' })).toBeHidden();
        await expect(page).toHaveURL(/\/settings\/backup$/u);
        await expect(page.getByRole('button', { name: 'Scarica Backup', exact: true })).toBeVisible();
    });

    const peer = await page.context().newPage();
    await peer.goto(`/patients/${patientId}/modules`);
    await expect(peer.getByRole('heading', { name: 'Sblocca MediFlow' })).toBeVisible();
    await peer.getByRole('button', { name: 'Rinnova accesso', exact: true }).click();
    await expect(peer.getByTestId('lume-scheda-header')).toContainText('Medica');
    await openPatientSection(peer, 'diario');
    await expect(peer.locator('#diario')).toContainText(note);
    const peerNote = 'Nota sintetica dalla seconda scheda.';
    await recordNote(peer, peerNote);
    await openPatientSection(peer, 'diario');
    await expect(peer.locator('#diario')).toContainText(peerNote);
    await standalone.step('una scheda ricaricata rinnova l’accesso e ritrova la stessa sessione', async () => {
        const session = await documentSession(peer);
        expect(session).toMatch(/^[a-f0-9]{64}$/u);
        await page.reload();
        await expect(page.getByRole('heading', { name: 'Sblocca MediFlow' })).toBeVisible();
        await page.getByRole('button', { name: 'Rinnova accesso', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Sblocca MediFlow' })).toBeHidden();
        await expect(page).toHaveURL(/\/settings\/backup$/u);
        expect(await documentSession(page)).toBe(session);
    });
    await lockAndWaitForConfirmation(peer);
    await expect(page.getByRole('heading', { name: 'Sblocca MediFlow' })).toBeVisible();
    expect(await (await documentRequests(page).get('/api/auth/check')).json()).toMatchObject({ hasSession: false });

    await standalone.step('il riavvio richiede un nuovo accesso e conserva il diario', async () => {
        await unlockIfNeeded(peer, pin, operator);
        const session = () => documentRequests(peer).get('/api/auth/check').then(response => response.json());
        expect(await session()).toMatchObject({ hasSession: true });
        await isolatedRuntime.restart();
        expect(await session()).toMatchObject({ hasSession: false });
        await peer.reload();
        await expect(peer.getByRole('heading', { name: 'Sblocca MediFlow' })).toBeVisible();
        await expect(peer.getByLabel('Passphrase', { exact: true })).toBeEnabled();
        await unlockIfNeeded(peer, pin, operator);
        await openPatientSection(peer, 'diario');
        await expect(peer.locator('#diario')).toContainText(note);
        await expect(peer.locator('#diario')).toContainText(peerNote);
    });
});

const pinAccount = standalone.extend({ existingPin: '24682468' });

pinAccount('con il PIN transitorio la ricarica di /settings/backup lascia la pagina sbloccata finché la sessione vale', async ({ page }) => {
    pinAccount.setTimeout(120_000);
    await bootstrapUnlockedSession(page, '24682468');
    await page.getByRole('link', { name: 'Impostazioni', exact: true }).click();
    await page.locator('a[href="/settings/backup"]:visible').first().click();
    await expect(page.getByRole('button', { name: 'Scarica Backup', exact: true })).toBeVisible();
    const session = await documentSession(page);

    await page.reload();
    await expect(page).toHaveURL(/\/settings\/backup$/u);
    await expect(page.getByRole('button', { name: 'Scarica Backup', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sblocca MediFlow' })).toBeHidden();
    expect(await documentSession(page)).toBe(session);

    await lockAndWaitForConfirmation(page);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Sblocca MediFlow' })).toBeVisible();
    expect(await (await documentRequests(page).get('/api/auth/check')).json()).toMatchObject({ hasSession: false });
});

standalone('il client API locale legge la lista pazienti con il proprio token e senza la prova del documento', async ({ isolatedRuntime }) => {
    const endpoint = new URL('/api/v1/patients', isolatedRuntime.url);
    const anonymous = await fetch(endpoint, { redirect: 'error' });
    expect(anonymous.status).toBe(401);
    const tokenFile = join(isolatedRuntime.dataDirectory, 'local-api-token');
    expect(existsSync(tokenFile)).toBe(true);
    const token = readFileSync(tokenFile, 'utf8').trim();
    expect(token).toMatch(/^[a-f0-9]{64}$/u);
    const forged = await fetch(endpoint, { headers: { Authorization: `Bearer ${'0'.repeat(64)}` }, redirect: 'error' });
    expect(forged.status).toBe(401);
    const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error' });
    expect(response.status).toBe(200);
});
