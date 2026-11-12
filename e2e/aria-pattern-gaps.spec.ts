import { expect, test, type Page } from '@playwright/test';
import { bootstrapUnlockedSession, unlockIfNeeded } from './utils';

// Two gaps found by running @ui-sdk/core/testing checkPattern on the real widgets,
// then confirmed with the real keyboard: menu type-ahead and the exemption search name.
const PIN = process.env.E2E_PIN || '1234';

async function patient(page: Page) {
    return page.evaluate(async () => {
        const response = await fetch('/api/patients', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ firstName: 'Tasto', lastName: 'Sintetico', taxCode: `SYN${crypto.randomUUID()}`, birthDate: '1980-01-01', diagnoses: [] }),
        });
        if (!response.ok) throw new Error(`Synthetic patient: ${response.status}`);
        return (await response.json()).id as string;
    });
}

test('menu Azioni scheda: una lettera porta alla voce che comincia con essa', async ({ page }) => {
    await bootstrapUnlockedSession(page, PIN);
    const id = await patient(page);
    await page.goto(`/patients/${id}/modules`);
    await unlockIfNeeded(page, PIN);
    const trigger = page.getByTestId('lume-scheda-header').getByRole('button', { name: 'Azioni', exact: true });
    await trigger.focus();
    await page.keyboard.press('ArrowDown');
    const menu = page.getByRole('menu', { name: 'Azioni scheda', exact: true });
    const item = (name: string) => menu.getByRole('menuitem', { name, exact: true });
    await expect(item('Accesso assistente')).toBeFocused();
    await page.keyboard.press('g');
    await expect(item('Gestisci checkup')).toBeFocused();
    await page.keyboard.press('E');
    await expect(item('Esporta FHIR')).toBeFocused();
    await page.keyboard.press('a');
    await expect(item('Archivia')).toBeFocused();
    await page.keyboard.press('a');
    await expect(item('Accesso assistente')).toBeFocused();
    await page.keyboard.press('z');
    await expect(item('Accesso assistente')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
});

test('ricerca esenzioni: il nome resta quando il placeholder sparisce', async ({ page }) => {
    await bootstrapUnlockedSession(page, PIN);
    await page.goto('/patients/new');
    await unlockIfNeeded(page, PIN);
    const search = page.getByRole('combobox', { name: 'Cerca codice o descrizione esenzione', exact: true });
    await expect(search).toHaveAttribute('aria-label', 'Cerca codice o descrizione esenzione');
    await search.fill('diab');
    await expect(search).toHaveAccessibleName('Cerca codice o descrizione esenzione');
});
