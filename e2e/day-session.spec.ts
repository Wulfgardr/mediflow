import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { expect, test } from './fixtures/isolated-runtime';
import { bootstrapUnlockedSession, unlockIfNeeded } from './utils';
import type { Page } from '@playwright/test';

const taxCode = 'RSSMRA80A01F205X';

async function syntheticPatient(page: Page, birthDate: string, withCode: boolean) {
    return page.evaluate(async input => {
        const response = await fetch('/api/patients', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ firstName: 'Lina', lastName: 'Esempia', taxCode: input.taxCode, identifierType: input.taxCode ? 'cf' : 'none',
                birthDate: `${input.birthDate}T00:00:00.000Z`, address: '', phone: '' }) });
        if (response.status !== 201) throw new Error(`Synthetic patient setup failed (${response.status})`);
        return (await response.json()).id as string;
    }, { birthDate, taxCode: withCode ? taxCode : '' });
}

function writeKitDay(directory: string) {
    const start = Date.parse('2026-11-25T09:00:00+01:00') / 1000;
    const pdf = { origine: '/synthetic/promemoria-prova.pdf', sha256: 'a'.repeat(64), mtime: start + 30,
        esito: 'candidato', cf_presenti: [taxCode], cf_medico: [], promemoria: true };
    const farPdf = { ...pdf, origine: '/synthetic/pdf-fuori-finestra.pdf', sha256: 'b'.repeat(64), mtime: start + 70, promemoria: false };
    const session = path.join(directory, 'S01');
    mkdirSync(session, { recursive: true });
    writeFileSync(path.join(session, 'seduta.json'), JSON.stringify({ seduta: 'S01', tratti_terzi: [{ id: 'T01', stato: 'confermato', inizio_epoch: start + 90 }] }));
    for (const [index, text] of ['Lina Esempia, controllo sintetico.', 'Visita Lina Esempia, nata il 01/01/1980.', 'Richiamo di prova, senza dati identificativi.'].entries()) {
        const visita = `V0${index + 1}`;
        const subdirectory = path.join(directory, visita);
        const opened = start + index * 120;
        mkdirSync(subdirectory);
        writeFileSync(path.join(subdirectory, 'manifest.json'), JSON.stringify({
            versione: 2, visita, canale: 'audio', seduta: 'S01', tratto: index + 1, cf: null, stato: 'CF da confermare',
            aperta_epoch: opened, chiusa_epoch: opened + 60, inserita: false, pdf: index === 0 ? [pdf, farPdf] : [],
        }));
        writeFileSync(path.join(subdirectory, 'trascrizione.txt'), text);
    }
}

test('la seduta propone tre tratti e registra solo la decisione presa dal medico', async ({ page, isolatedRuntime }, info) => {
    test.setTimeout(100_000);
    const pin = '24682468';
    await page.setViewportSize({ width: 1440, height: 1120 });
    await bootstrapUnlockedSession(page, pin);
    const preferred = await syntheticPatient(page, '1980-01-01', true);
    const homonym = await syntheticPatient(page, '1985-02-02', false);
    const workday = info.outputPath('ambulatorio-20261125');
    writeKitDay(workday);

    const navigation = page.getByRole('navigation', { name: 'Navigazione principale', exact: true });
    const openSession = async () => {
        await navigation.getByRole('link', { name: 'Da decidere', exact: true }).click();
        await page.getByRole('link', { name: 'Seduta del giorno', exact: true }).click();
    };
    await openSession();
    const writes: string[] = [];
    page.on('request', request => {
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method()) && new URL(request.url()).pathname.startsWith('/api/')) writes.push(request.url());
    });
    const tray = page.getByRole('region', { name: 'Da collegare' });
    const timeline = page.getByRole('region', { name: 'Cronologia' });
    const first = tray.getByRole('article', { name: /V01$/u });
    const second = tray.getByRole('article', { name: /V02$/u });
    const third = tray.getByRole('article', { name: /V03$/u });
    const chooseFolder = () => page.getByLabel('Cartella della giornata', { exact: true }).setInputFiles(workday);
    const capture = async (step: string) => {
        for (const colorScheme of ['light', 'dark'] as const) {
            await page.emulateMedia({ colorScheme });
            await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${colorScheme}\\b`, 'u'));
            await page.screenshot({ path: info.outputPath(`seduta-${step}-${colorScheme}.png`) });
        }
    };
    await chooseFolder();
    await expect(tray.getByRole('article')).toHaveCount(3);
    await expect(first).toContainText('Più schede compatibili');
    await expect(first.locator('ol > li').first()).toContainText(taxCode);
    await expect(first.locator('ol > li').first()).toContainText('Codice fiscale in un PDF vicino');
    await expect(second.getByRole('button', { name: 'Collega a Lina Esempia', exact: true })).toHaveCount(1);
    await expect(second).toContainText('Data di nascita nel dettato');
    await expect(second).toContainText(taxCode);
    await expect(third).toContainText('Nessuna scheda suggerita.');
    await expect(third.getByRole('button', { name: /Collega/u })).toHaveCount(0);
    await expect(timeline.getByRole('listitem')).toHaveText([/09:00.*Dettato/u, /09:00.*Promemoria ricetta.*PDF vicino/u,
        /09:01.*pdf-fuori-finestra\.pdf.*Da verificare/u, /09:01.*Tratto di terzi/u, /09:02.*V02/u, /09:04.*V03/u]);
    await expect(timeline.getByRole('link', { name: 'Lina Esempia' })).toHaveCount(0);
    await capture('prima');

    await first.getByRole('button', { name: 'Collega a Lina Esempia', exact: true }).first().click();
    await expect(first).toHaveCount(0);
    await third.getByRole('button', { name: 'Scarta tratto', exact: true }).click();
    await expect(third).toHaveCount(0);
    expect(writes).toEqual([]);
    await expect(timeline).toContainText('Collegato a Lina Esempia');
    await expect(timeline.getByRole('link', { name: 'Lina Esempia' })).toHaveAttribute('href', `/patients/${preferred}/modules`);
    await expect(timeline.getByText('Scartato', { exact: true })).toBeVisible();
    await timeline.getByRole('link', { name: 'Lina Esempia' }).click();
    await expect(page).toHaveURL(new RegExp(`/patients/${preferred}/modules$`, 'u'));
    await openSession();
    await expect(timeline.getByRole('link', { name: 'Lina Esempia' })).toHaveAttribute('href', `/patients/${preferred}/modules`);
    await page.reload();
    await unlockIfNeeded(page, pin);
    await expect(timeline.getByText('Scartato', { exact: true })).toBeVisible();
    await chooseFolder();
    await expect(page.getByText('Giornata importata.', { exact: true })).toBeVisible();
    await expect(tray.getByRole('article')).toHaveCount(1);
    await expect(second).toBeVisible();
    await expect(timeline.getByRole('link', { name: 'Lina Esempia' })).toHaveAttribute('href', `/patients/${preferred}/modules`);
    const localCiphertexts = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith('mediflow:day-session:')).map(([, value]) => value));
    expect(localCiphertexts).toEqual([expect.stringMatching(/^ENC:/u)]);
    expect(localCiphertexts[0]).not.toContain(taxCode);
    await capture('dopo');

    const sqlite = new Database(path.join(isolatedRuntime.dataDirectory, 'medical.db'), { readonly: true, fileMustExist: true });
    try {
        for (const table of ['entries', 'attachments', 'therapies', 'service_prescriptions']) {
            expect(sqlite.prepare(`SELECT count(*) AS count FROM ${table} WHERE patient_id IN (?, ?)`).get(preferred, homonym)).toEqual({ count: 0 });
        }
    } finally { sqlite.close(); }
    const lock = page.getByRole('button', { name: 'Blocca', exact: true });
    await lock.click();
    await expect(tray).toHaveCount(0);
    await expect(timeline).toHaveCount(0);
});
