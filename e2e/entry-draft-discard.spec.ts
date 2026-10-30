import { expect, test } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

for (const storageFailure of [false, true]) {
    test(`explicit draft discard removes the browser copy before leaving, storage failure=${storageFailure}`, async ({ page }) => {
        await bootstrapUnlockedSession(page, '1234');
        const patient = await page.evaluate(async () => {
            const response = await fetch('/api/patients', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ firstName: 'Scarto', lastName: 'Sintetico', taxCode: `DSC${crypto.randomUUID().replaceAll('-', '').slice(0, 13)}`, birthDate: '1980-01-01' }) });
            if (response.status !== 201) throw new Error(`Synthetic patient: ${response.status}`);
            return response.json();
        });
        const path = `/patients/${patient.id}/entries/new`;
        await page.goto(path);
        const editor = page.getByRole('textbox', { name: 'Resoconto clinico', exact: true });
        await editor.fill('Bozza sintetica da scartare esplicitamente');
        const draftKeys = () => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('mediflow:entry-draft:')));
        await expect.poll(draftKeys).toHaveLength(1);
        const back = page.getByRole('link', { name: 'Torna alla scheda paziente', exact: true });
        await back.click();
        await page.getByRole('button', { name: 'Continua la compilazione', exact: true }).click();
        await expect(editor).toContainText('Bozza sintetica');
        await expect.poll(draftKeys).toHaveLength(1);
        if (storageFailure) await page.evaluate(() => {
            const remove = Storage.prototype.removeItem;
            Storage.prototype.removeItem = function (key: string) {
                if (key.startsWith('mediflow:entry-draft:')) throw new Error('Synthetic storage failure');
                return remove.call(this, key);
            };
            (window as unknown as { restoreDraftStorage: () => void }).restoreDraftStorage = () => { Storage.prototype.removeItem = remove; };
        });
        await back.click();
        await page.getByRole('button', { name: 'Esci senza salvare', exact: true }).click();
        if (storageFailure) {
            await expect(page.getByText('Bozza non eliminata. La compilazione resta aperta.', { exact: true })).toBeVisible();
            await expect(page).toHaveURL(new RegExp(`${path}$`));
            await expect(editor).toContainText('Bozza sintetica');
            await expect.poll(draftKeys).toHaveLength(1);
            await page.evaluate(() => (window as unknown as { restoreDraftStorage: () => void }).restoreDraftStorage());
            await back.click();
            await page.getByRole('button', { name: 'Esci senza salvare', exact: true }).click();
        }
        await expect(page).toHaveURL(new RegExp(`/patients/${patient.id}/modules$`));
        await expect.poll(draftKeys).toHaveLength(0);
        await page.goto(path);
        await expect(editor).toHaveText('');
        await page.reload();
        await expect(editor).toHaveText('');
        expect(await page.evaluate(async id => (await fetch(`/api/entries?patientId=${id}`)).json(), patient.id)).toEqual([]);
    });
}
