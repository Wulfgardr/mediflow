import { expect, test } from '@playwright/test';
import { sealDiaryEntry } from './fixtures/sealed-diary-entry';
import { assertNoHorizontalOverflow, bootstrapUnlockedSession, openPatientSection } from './utils';

test('due rettifiche e rilettura selettiva nella scheda del paziente', async ({ page }, info) => {
    test.setTimeout(150_000);
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const patient = await page.evaluate(async () => {
        const taxCode = crypto.randomUUID();
        const response = await fetch('/api/patients', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ firstName: 'Rettifiche', lastName: 'Paziente sintetico', birthDate: '1980-01-01', taxCode }),
        });
        if (!response.ok) throw new Error(`Synthetic patient: ${response.status}`);
        return { id: (await response.json()).id as string, taxCode };
    });
    const navigation = page.getByRole('navigation', { name: 'Navigazione principale', exact: true });
    await navigation.getByRole('link', { name: 'Agenda', exact: true }).click();
    await navigation.getByRole('link', { name: 'Pazienti', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Cerca nella lista pazienti' }).fill(patient.taxCode);
    await page.getByRole('option').filter({ hasText: 'Rettifiche' }).click();
    await page.getByRole('link', { name: 'Apri scheda paziente', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/patients/${patient.id}/modules$`));
    await openPatientSection(page, 'diario');
    await page.getByRole('link', { name: 'Nuova voce', exact: true }).click();
    const original = 'Inizio della nota sintetica. ' + 'Riga clinica inventata per verificare la rilettura. '.repeat(90) + 'Fine prima versione.';
    await page.getByRole('textbox', { name: 'Resoconto clinico', exact: true }).fill(original);
    await page.getByRole('button', { name: 'Rivedi', exact: true }).click();
    await page.getByRole('button', { name: 'Conferma e registra', exact: true }).click();
    await page.getByRole('link', { name: 'Chiudi la voce', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Chiudi la voce', exact: true })).toBeHidden();
    await openPatientSection(page, 'diario');
    const rows = page.locator('#diario article');
    await expect(rows).toHaveCount(1);
    const row = rows.first();
    await expect(row).toContainText('Fine prima versione.');
    const historyToggle = row.getByRole('button', { name: 'Storico delle rettifiche' });
    await historyToggle.click();
    await expect(row.getByText('Lo storico inizia con la prima rettifica registrata dalla versione 0.9.1.')).toBeVisible();
    await historyToggle.click();

    const correction = row.getByRole('textbox', { name: 'Testo della rettifica' });
    await row.getByRole('button', { name: 'Rettifica', exact: true }).click();
    await correction.fill('Bozza annullata e mai registrata.');
    await row.getByRole('button', { name: 'Annulla', exact: true }).click();
    await expect(row).toContainText('Fine prima versione.');

    const texts = ['Seconda versione sintetica e leggibile.', 'Terza versione sintetica e leggibile.'];
    for (const text of texts) {
        await row.getByRole('button', { name: 'Rettifica', exact: true }).click();
        await correction.fill(text);
        const committed = page.waitForResponse(response => response.request().method() === 'PUT'
            && new URL(response.url()).pathname.startsWith('/api/entries/'));
        await row.getByRole('button', { name: 'Salva rettifica' }).click();
        const response = await committed;
        expect(response.status()).toBe(200);
        const request = response.request();
        const retry = await page.evaluate(async ({ url, body, generation }) => (await fetch(url, {
            method: 'PUT', headers: { 'content-type': 'application/json', 'x-mediflow-archive-generation': generation }, body,
        })).status, { url: request.url(), body: request.postData(), generation: request.headers()['x-mediflow-archive-generation'] });
        expect(retry).toBe(409);
        await expect(row).toContainText(text);
    }

    await page.setViewportSize({ width: 390, height: 850 });
    await historyToggle.click();
    const history = row.getByRole('region', { name: 'Versioni della nota' });
    await expect(history.getByRole('group', { name: 'Seleziona versione' }).getByRole('button'))
        .toHaveText(['Versione 1', 'Versione 2', 'Versione attuale 3']);
    await history.getByRole('button', { name: 'Versione 1', exact: true }).click();
    await expect(history).toContainText('Fine prima versione.');
    await expect(history).toContainText('Sostituita il');
    await expect(history.locator('time')).toHaveCount(2);
    await assertNoHorizontalOverflow(page, [{ label: 'Storico', selector: '[aria-label="Versioni della nota"]' }]);
    await page.screenshot({ path: info.outputPath('storico-versione-precedente.png') });
    await history.getByRole('button', { name: 'Versione 2', exact: true }).click();
    await expect(history).toContainText(texts[0]);
    await history.getByRole('button', { name: 'Versione attuale 3', exact: true }).click();
    await expect(history).toContainText(texts[1]);
    await expect(history.getByRole('textbox')).toHaveCount(0);
    await expect(row).not.toContainText('Bozza annullata');

    const backup = await page.evaluate(async patientId => {
        const response = await fetch('/api/system/backup-restore', { cache: 'no-store' });
        if (!response.ok) throw new Error(`Synthetic backup: ${response.status}`);
        const body = await response.text();
        const { payload } = JSON.parse(body);
        const current = payload.entries.find((entry: { patientId: string }) => entry.patientId === patientId);
        return { current, history: payload.entryRevisions.filter((row: { entryId: string }) => row.entryId === current.id)
            .sort((first: { version: number }, second: { version: number }) => first.version - second.version),
        containsPlainText: ['Fine prima versione.', 'Seconda versione sintetica e leggibile.', 'Terza versione sintetica e leggibile.'].some(text => body.includes(text)) };
    }, patient.id);
    expect(backup.current.version).toBe(3);
    expect(backup.current.content).toMatch(/^ENC:/u);
    expect(backup.history.map((row: { version: number }) => row.version)).toEqual([1, 2]);
    for (const row of backup.history) {
        expect(row.content).toMatch(/^ENC:/u);
        expect(row.correctedBy).toBeTruthy();
    }
    expect(backup.containsPlainText).toBe(false);
});

test('rettifica note già registrate con formattazione o testo semplice', async ({ page }) => {
    test.setTimeout(150_000);
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const patientId = await page.evaluate(async () => {
        const response = await fetch('/api/patients', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ firstName: 'Formato', lastName: 'Paziente sintetico', birthDate: '1980-01-01', taxCode: crypto.randomUUID() }),
        });
        if (!response.ok) throw new Error(`Synthetic patient: ${response.status}`);
        return (await response.json()).id as string;
    });

    const plainText = 'PA <120 e A & B\n**Controllo sintetico**';
    const notes = [
        { title: 'Nota formattata', content: '<p data-fixture="remove"><strong>Controllo sintetico</strong> <mark>rivisto</mark></p>' },
        { title: 'Nota semplice', content: plainText },
    ];
    for (const note of notes) {
        const body = await sealDiaryEntry(page, { ...note, patientId, type: 'visit', setting: 'ambulatory', date: new Date().toISOString() });
        const status = await page.evaluate(async entry => (await fetch('/api/entries', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(entry),
        })).status, body);
        expect(status).toBe(201);
    }

    await page.goto(`/patients/${patientId}/modules`);
    await openPatientSection(page, 'diario');
    const row = (title: string) => page.locator('#diario article').filter({ hasText: title });
    const rich = row(notes[0].title);
    await rich.getByRole('button', { name: 'Rettifica', exact: true }).click();
    const richEditor = rich.getByRole('textbox', { name: 'Testo della rettifica' });
    await expect(richEditor.locator('strong')).toHaveText('Controllo sintetico');
    await expect(richEditor.locator('mark, [data-fixture]')).toHaveCount(0);
    await rich.getByRole('button', { name: 'Annulla', exact: true }).click();

    const plain = row(notes[1].title);
    await plain.getByRole('button', { name: 'Rettifica', exact: true }).click();
    const plainEditor = plain.getByRole('textbox', { name: 'Testo della rettifica' });
    expect(await plainEditor.innerText()).toBe(plainText);
    await plainEditor.focus();
    await plainEditor.evaluate(element => {
        window.getSelection()?.selectAllChildren(element);
        window.getSelection()?.collapseToEnd();
    });
    await page.keyboard.insertText(' rivisto');
    await plain.getByRole('button', { name: 'Salva rettifica', exact: true }).click();
    await expect(plain).toContainText('PA <120 e A & B');
    await expect(plain).toContainText('Controllo sintetico rivisto');
    await plain.getByRole('button', { name: 'Rettifica', exact: true }).click();
    expect(await plainEditor.innerText()).toBe(plainText + ' rivisto');
});
