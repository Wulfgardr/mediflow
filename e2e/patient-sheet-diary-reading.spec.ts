import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { openBrowserZoomFixture } from './fixtures/browser-zoom';
import { openSyntheticPatient, unlockSyntheticSheet } from './fixtures/synthetic-sheet';
import { assertNoHorizontalOverflow, openPatientSection } from './utils';

test.describe.configure({ retries: 0 });

const shots = process.env.MEDIFLOW_DIARY_READING_SCREENSHOTS;
const phoneText = 'Potassio 5,6: sospeso spironolattone. Ricontrollo elettroliti tra 7 giorni.';
const accessText = 'Edemi declivi ++, peso 71,4 kg. Concordato controllo del peso quotidiano con la figlia.';
const noteText = 'Nota di archivio sintetica da spostare nel cestino.';

async function seedAndOpen(page: Page, baseURL: string | undefined) {
    const { archivePath, post, seal } = await unlockSyntheticSheet(page, baseURL);
    const stamp = (days: number, hour: number, minute = 0) => {
        const date = new Date();
        date.setDate(date.getDate() - days);
        date.setHours(hour, minute, 0, 0);
        return date;
    };
    const rows = [
        { days: 15, hour: 9, minute: 0, type: 'visit', title: 'Visita ambulatoriale', content: 'Compenso discreto.', author: 'Dott. Sintetico' },
        { days: 7, hour: 16, minute: 40, type: 'phone', title: 'Telefonata', content: phoneText, author: 'Dott.ssa Prova' },
        { days: 7, hour: 10, minute: 15, type: 'access', title: 'Nota ADI', content: accessText, author: 'Inf. Sintetica' },
        { days: 20, hour: 11, minute: 0, type: 'note', title: 'Nota di archivio', content: noteText, author: 'Dott. Sintetico' },
    ] as const;
    const lastName = `Sintetico ${randomUUID().slice(0, 8)}`;
    const patientId = await post('patients', { firstName: 'Diario', lastName, identifierType: 'none', taxCode: '',
        birthDatePrecision: 'estimated', birthYear: 1947 });
    const entries: { id: string; date: Date; author: string }[] = [];
    for (const row of rows) {
        const date = stamp(row.days, row.hour, row.minute);
        const id = await post('entries', { patientId, type: row.type, date, title: await seal(row.title), content: await seal(row.content) });
        entries.push({ id, date, author: row.author });
    }
    const database = new Database(archivePath, { fileMustExist: true });
    try {
        const historicalRegistration = database.prepare('UPDATE entries SET created_at = ?, recorded_by = ? WHERE id = ? AND patient_id = ?');
        database.transaction(() => {
            for (const { id, date, author } of entries) historicalRegistration.run(date.getTime() / 1000, author, id, patientId);
        })();
    } finally { database.close(); }
    await openSyntheticPatient(page, lastName, `${lastName} Diario`, patientId);
}

async function setTheme(page: Page, theme: 'light' | 'dark') {
    await page.evaluate(value => {
        document.documentElement.classList.toggle('light', value === 'light');
        document.documentElement.classList.toggle('dark', value === 'dark');
    }, theme);
}

async function shot(page: Page, name: string) {
    if (!shots) return;
    mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: `${shots}/${name}.png`, animations: 'disabled' });
}

test('diario della scheda: lettura nel riepilogo, azioni nel diario completo e ritorno', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 1320, height: 880 });
    await seedAndOpen(page, baseURL);
    const diary = page.locator('#diario');
    const feed = diary.getByRole('feed', { name: 'Diario clinico del paziente', exact: true });
    const articles = feed.locator(':scope > article');
    await expect(articles.first()).toContainText(phoneText);

    await expect(diary.getByRole('link', { name: 'Tutto il diario', exact: true })).toHaveAttribute('href', '#diario');
    await expect(diary.getByRole('button', { name: /voci eliminate|cestino/u })).toHaveCount(0);
    await expect(diary.getByRole('button', { name: /^Azioni voce/u })).toHaveCount(0);
    await expect(articles.first()).toContainText('Telefonata');
    await expect(articles.first()).toContainText('16:40');
    await expect(articles.first()).toContainText('Registrata da Dott.ssa Prova');
    await expect(articles.nth(1)).toContainText('Nota ADI');
    await expect(articles.nth(1)).toContainText(accessText);
    const firstBody = articles.first().locator('.prose');
    await expect(firstBody).toBeInViewport({ ratio: 1 });
    await expect(articles.first().getByText('Registrata da Dott.ssa Prova')).toBeInViewport();
    for (const theme of ['light', 'dark'] as const) {
        await setTheme(page, theme);
        await assertNoHorizontalOverflow(page, [{ label: 'Scheda', selector: '#quadro' }]);
        await shot(page, `riepilogo-1320-${theme}`);
    }
    await setTheme(page, 'light');
    await articles.nth(1).scrollIntoViewIfNeeded();
    await expect(articles.nth(1).locator('.prose')).toBeInViewport({ ratio: 1 });
    await shot(page, 'riepilogo-seconda-voce-1320-light');

    await diary.getByRole('link', { name: 'Tutto il diario', exact: true }).click();
    const sections = page.getByRole('navigation', { name: 'Sezioni della vista', exact: true });
    await expect(sections.locator('a[href="#diario"][aria-current="location"]')).toHaveCount(1);
    await expect(diary.getByRole('link', { name: 'Tutto il diario', exact: true })).toHaveCount(0);
    const archived = articles.filter({ hasText: noteText });
    await archived.getByRole('button', { name: 'Azioni voce Nota di archivio', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Elimina voce clinica con motivazione', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox').fill('Duplicato sintetico');
    await dialog.getByRole('button', { name: 'Elimina', exact: true }).click();
    await expect(articles.filter({ hasText: noteText })).toHaveCount(0);
    await diary.getByRole('button', { name: 'Mostra voci eliminate', exact: true }).click();
    await expect(articles.filter({ hasText: noteText }).getByRole('button', { name: 'Ripristina voce clinica', exact: true })).toBeVisible();
    await shot(page, 'diario-completo-cestino-1320-light');

    await sections.getByRole('link', { name: 'Riepilogo', exact: true }).click();
    await expect(sections.locator('a[href="#quadro"][aria-current="location"]')).toHaveCount(1);
    await expect(articles.filter({ hasText: noteText })).toHaveCount(0);
    await expect(diary.getByRole('button', { name: /^(Azioni voce|Ripristina)/u })).toHaveCount(0);
    await expect(diary.getByRole('link', { name: 'Tutto il diario', exact: true })).toBeVisible();
    await shot(page, 'riepilogo-ritorno-1320-light');

    await openPatientSection(page, 'diario');
    await expect(articles.filter({ hasText: noteText }).getByRole('button', { name: 'Ripristina voce clinica', exact: true })).toBeVisible();
    await openPatientSection(page, 'quadro');

    await page.setViewportSize({ width: 390, height: 844 });
    for (const theme of ['light', 'dark'] as const) {
        await setTheme(page, theme);
        await assertNoHorizontalOverflow(page, [{ label: 'Scheda', selector: '#quadro' }, { label: 'Pagina', selector: 'document' }]);
        await diary.scrollIntoViewIfNeeded();
        await expect(diary.getByRole('link', { name: 'Tutto il diario', exact: true })).toBeVisible();
        await expect(articles.first()).toContainText(phoneText);
        await shot(page, `riepilogo-390-${theme}`);
    }
});

test('diario della scheda: in scrittura le azioni del diario restano disponibili', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 1320, height: 880 });
    await seedAndOpen(page, baseURL);
    await page.getByRole('link', { name: 'Nuova voce', exact: true }).click();
    await expect(page.locator('#quadro[data-writing]')).toBeVisible();
    await page.getByRole('button', { name: 'Tutto il diario', exact: true }).click();
    const diary = page.locator('#diario');
    await expect(diary.getByRole('button', { name: 'Mostra voci eliminate', exact: true })).toBeVisible();
    await expect(diary.getByRole('button', { name: 'Azioni voce Telefonata', exact: true })).toBeVisible();
    await expect(diary.getByRole('link', { name: 'Tutto il diario', exact: true })).toHaveCount(0);
    await shot(page, 'scrittura-diario-1320-light');
    await page.getByRole('button', { name: 'Torna alla bozza dal diario', exact: true }).click();
});

test('diario della scheda: al 200% la lettura e il passaggio al diario completo restano raggiungibili', async ({ baseURL }) => {
    const zoom = await openBrowserZoomFixture(baseURL!);
    try {
        const page = zoom.page;
        await seedAndOpen(page, baseURL);
        await zoom.setZoom(2);
        const diary = page.locator('#diario');
        await expect(diary.getByRole('feed').locator(':scope > article').first()).toContainText(phoneText);
        const link = diary.getByRole('link', { name: 'Tutto il diario', exact: true });
        await link.scrollIntoViewIfNeeded();
        await expect(link).toBeInViewport();
        await assertNoHorizontalOverflow(page, [{ label: 'Scheda', selector: '#quadro' }, { label: 'Pagina', selector: 'document' }]);
        await shot(page, 'riepilogo-zoom-200');
        await link.click();
        await expect(diary.getByRole('button', { name: 'Mostra voci eliminate', exact: true })).toBeVisible();
    } finally { await zoom.close(); }
});
