import { expect, test, type Page } from '@playwright/test';
import { bootstrapUnlockedSession, openPatientSection, unlockIfNeeded } from './utils';

async function patient(page: Page) {
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    return page.evaluate(async () => {
        const response = await fetch('/api/patients', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ firstName: 'Focus', lastName: 'Sintetico', taxCode: `SYN${crypto.randomUUID()}`, birthDate: '1980-01-01', diagnoses: [] }),
        });
        if (!response.ok) throw new Error(`Synthetic patient: ${response.status}`);
        return (await response.json()).id as string;
    });
}

test('conferma senza campi: focus sul ritorno, Escape e chiusura restituiscono il trigger', async ({ page }) => {
    const id = await patient(page);
    await page.goto(`/patients/${id}/entries/new`);
    const editor = page.getByRole('textbox', { name: 'Resoconto clinico', exact: true });
    await expect(editor.or(page.getByRole('heading', { name: 'Sblocca MediFlow', exact: true }))).toBeVisible();
    await unlockIfNeeded(page, process.env.E2E_PIN || '1234');
    await editor.fill('Bozza sintetica per verifica del focus.');
    const trigger = page.getByRole('link', { name: 'Torna alla scheda paziente', exact: true });
    const dialog = page.getByRole('dialog', { name: 'Lasciare la compilazione?', exact: true });
    const safe = dialog.getByRole('button', { name: 'Continua la compilazione', exact: true });
    for (const exit of ['Escape', 'Chiudi', 'Continua la compilazione']) {
        await trigger.focus(); await page.keyboard.press('Enter');
        await expect(safe).toBeFocused();
        if (exit === 'Escape') await page.keyboard.press('Escape');
        else await dialog.getByRole('button', { name: exit, exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await expect(trigger).toBeFocused();
        await expect(editor).toContainText('Bozza sintetica per verifica del focus.');
    }
});

test('conferma con motivazione: focus sul campo, guardia e ritorno al trigger', async ({ page }) => {
    test.setTimeout(90_000);
    const id = await patient(page);
    await page.evaluate(async patientId => {
        const response = await fetch('/api/entries', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ patientId, type: 'visit', date: '2026-10-27', title: 'Voce sintetica focus', content: 'Contenuto sintetico da conservare.' }),
        });
        if (!response.ok) throw new Error(`Synthetic entry: ${response.status}`);
    }, id);
    await page.goto(`/patients/${id}/modules`);
    await expect(page.getByRole('navigation', { name: 'Sezioni della vista', exact: true }).or(page.getByRole('heading', { name: 'Sblocca MediFlow', exact: true }))).toBeVisible({ timeout: 45_000 });
    await unlockIfNeeded(page, process.env.E2E_PIN || '1234');
    await openPatientSection(page, 'diario');
    const row = page.locator('#diario article').filter({ hasText: 'Contenuto sintetico da conservare.' });
    const trigger = row.getByRole('button', { name: 'Azioni voce Voce sintetica focus', exact: true });
    const dialog = page.getByRole('dialog');
    let writes = 0;
    page.on('request', request => { if (request.method() !== 'GET' && /\/api\/entries\//u.test(request.url())) writes += 1; });
    for (const exit of ['Escape', 'Chiudi', 'Annulla']) {
        await trigger.focus(); await page.keyboard.press('ArrowDown');
        await page.getByRole('menuitem', { name: 'Elimina voce clinica con motivazione', exact: true }).click();
        const reason = dialog.getByRole('textbox');
        const destructive = dialog.getByRole('button', { name: 'Elimina', exact: true });
        await expect(reason).toBeFocused(); await expect(reason).toHaveValue('');
        await expect(destructive).toBeDisabled();
        await reason.fill('   '); await expect(destructive).toBeDisabled();
        await reason.fill('Motivazione sintetica'); await expect(destructive).toBeEnabled();
        await expect(reason).toBeFocused(); await page.keyboard.press('Enter');
        await expect(dialog).toBeVisible();
        if (exit === 'Escape') await page.keyboard.press('Escape');
        else await dialog.getByRole('button', { name: exit, exact: true }).click();
        await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
        await expect(row).toBeVisible();
    }
    expect(writes).toBe(0);
});
