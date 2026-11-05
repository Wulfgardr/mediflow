import { test, expect } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

test('modifica note con CF storico invalido, mantenendo il rifiuto dei cambi invalidi', async ({ page }) => {
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const id = await page.evaluate(async () => {
        const response = await fetch('/api/patients', { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ firstName: 'Ada', lastName: 'Compatibilità Sintetica', taxCode: 'RSSMRA80A01H501X' }) });
        if (response.status !== 201) throw new Error(`Creazione legacy: HTTP ${response.status}`);
        return (await response.json()).id as string;
    });
    await page.goto(`/patients/${id}/edit`);
    const code = page.getByLabel('Codice fiscale', { exact: true });
    await expect(code).toHaveValue('RSSMRA80A01H501X');
    await page.getByLabel('Note cliniche e contesto', { exact: true }).fill('Nota sintetica di compatibilità');
    await code.fill('RSSMRA80A01H501Y');
    await page.getByRole('button', { name: 'Aggiorna scheda', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Controlla il codice fiscale' })).toBeVisible();
    await code.fill('RSSMRA80A01H501X');
    const saved = page.waitForResponse(response => response.request().method() === 'PUT'
        && new URL(response.url()).pathname === `/api/patients/${id}`);
    await page.getByRole('button', { name: 'Aggiorna scheda', exact: true }).click();
    const response = await saved;
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON()).toMatchObject({ version: 1 });
    expect(response.request().postDataJSON()).not.toHaveProperty('taxCode');
    await expect(page).not.toHaveURL(new RegExp(`/patients/${id}/edit$`));
    const stored = await (await page.request.get(`/api/patients/${id}`)).json();
    expect(stored.taxCode).toBe('RSSMRA80A01H501X');
    expect(stored.identifierType).toBe('cf');
    expect(stored.version).toBe(2);
    expect(stored.notes).toMatch(/^ENC:/);
});
