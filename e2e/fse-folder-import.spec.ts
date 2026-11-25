import { expect, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';

import { test } from './fixtures/isolated-runtime';
import { switchPreset } from './fixtures/territorial-preset';
import { bootstrapUnlockedSession, openPatientSection, unlockIfNeeded } from './utils';
import { randomSyntheticTaxCode } from '../lib/patient-identity.test-support.ts';

const PIN = '314159';
const SYNTHETIC_SISS_SESSION = { status: 'unavailable', source: 'synthetic', checkedAt: '2026-11-25T10:00:00Z', browserProfile: null,
    warning: 'Stato sintetico: nessuna osservazione reale.', sessionHealth: 'none', lastModule: null, lastModuleLabel: null, lastModuleAt: null, checkpoints: [] };

async function textPdf(lines: string[]): Promise<Uint8Array> {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const sheet = document.addPage([595, 842]);
    lines.forEach((line, index) => sheet.drawText(line, { x: 40, y: 800 - index * 18, size: 11, font }));
    return document.save();
}

async function createPatient(page: Page, lastName: string, taxCode: string): Promise<string> {
    return page.evaluate(async ({ lastName, taxCode }) => {
        const response = await fetch('/api/patients', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ firstName: 'Mario', lastName, taxCode, birthDate: '1980-01-01T00:00:00.000Z', diagnoses: [] }) });
        if (!response.ok) throw new Error(`Synthetic patient: HTTP ${response.status}`);
        return (await response.json() as { id: string }).id;
    }, { lastName, taxCode });
}

async function attachmentCount(page: Page, patientId: string): Promise<number> {
    return page.evaluate(async (id) => {
        const response = await fetch(`/api/attachments?patientId=${encodeURIComponent(id)}&metadata=true`, { cache: 'no-store' });
        return (await response.json() as Array<{ patientId: string }>).filter((row) => row.patientId === id).length;
    }, patientId);
}

async function clinicalRows(page: Page, patientId: string): Promise<number> {
    return page.evaluate(async (id) => {
        let total = 0;
        for (const path of ['observations', 'therapies']) {
            const response = await fetch(`/api/${path}?patientId=${encodeURIComponent(id)}`, { cache: 'no-store' });
            total += (await response.json() as unknown[]).length;
        }
        return total;
    }, patientId);
}

async function writeFseDocument(folder: string, name: string, taxCode: string, title: string) {
    writeFileSync(path.join(folder, name), await textPdf([title, `Paziente: Mario Sintetico C.F.: ${taxCode}`, 'Glucosio 98 mg/dL 70-99', 'Testo sintetico per la prova.']));
}

test('WUL-949: la cartella del Fascicolo entra nell’import dalla scheda, si ferma sul paziente sbagliato e salta ciò che è già importato', async ({ page }, info) => {
    test.setTimeout(300_000);
    const evidence = process.env.FSE_EVIDENCE_DIR || info.outputPath('fascicolo');
    mkdirSync(evidence, { recursive: true });
    await page.route('**/api/siss/session-status', (route) => route.fulfill({ json: SYNTHETIC_SISS_SESSION }));
    const taxCode = randomSyntheticTaxCode();
    let otherTaxCode = randomSyntheticTaxCode();
    while (otherTaxCode === taxCode) otherTaxCode = randomSyntheticTaxCode();
    const root = mkdtempSync(path.join(tmpdir(), 'mediflow-fse-e2e-'));
    const folder = path.join(root, `FSE_${taxCode}`);
    mkdirSync(folder);
    try {
        await writeFseDocument(folder, '2025-03-14_LAB_REFERTO_SPECIALISTICO_LABORATORIO_ASST_SINTETICA_0a1b2c3d.pdf', taxCode, 'Esami sintetici');
        await writeFseDocument(folder, '2025-06-02_REF_VISITA_CARDIOLOGICA_ASST_SINTETICA_1b2c3d4e.pdf', taxCode, 'Visita sintetica');
        writeFileSync(path.join(folder, 'appunti.pdf'), await textPdf(['Appunti sintetici fuori dal Fascicolo']));

        await bootstrapUnlockedSession(page, PIN);
        await switchPreset(page, 'core+it+lom');
        const patientId = await createPatient(page, 'Sintetico', taxCode);
        const otherId = await createPatient(page, 'Altrove', otherTaxCode);

        const openSiss = async (id: string) => {
            await page.goto(`/patients/${id}/modules`);
            await unlockIfNeeded(page, PIN);
            await openPatientSection(page, 'siss');
        };

        await openSiss(otherId);
        const otherPane = page.locator('#siss');
        await otherPane.getByTestId('fse-folder').setInputFiles(folder, { timeout: 15_000 });
        await expect(otherPane.getByTestId('fse-folder-refusal')).toHaveText('La cartella è di un altro codice fiscale. Nessun documento letto.');
        await expect(page).toHaveURL(new RegExp(`/patients/${otherId}/modules`));
        await page.screenshot({ path: path.join(evidence, '1-paziente-sbagliato.png'), fullPage: true });
        expect(await attachmentCount(page, otherId)).toBe(0);
        expect(await attachmentCount(page, patientId)).toBe(0);

        await openSiss(patientId);
        await page.locator('#siss').getByTestId('fse-folder').setInputFiles(folder);
        await expect(page).toHaveURL(new RegExp(`/patients/import/dossier\\?patientId=${patientId}`));
        const panel = page.getByTestId('dossier-import');
        const group = panel.getByTestId('dossier-group');
        await expect(group).toHaveAttribute('data-identity', 'matched', { timeout: 60_000 });
        await expect(group.getByRole('heading', { level: 3 })).toContainText('Cartella del Fascicolo');
        await expect(panel.getByRole('alert').filter({ hasText: '1 file non ha il nome dato dal Fascicolo: non letti.' })).toBeVisible();
        const sources = group.getByTestId('dossier-source');
        await expect(sources).toHaveCount(2);
        const lab = sources.filter({ hasText: '2025-03-14_LAB_' });
        const visit = sources.filter({ hasText: '2025-06-02_REF_' });
        await expect(lab).toContainText('Categoria: Analisi di laboratorio');
        await expect(lab).toContainText('Data: 2025-03-14');
        await expect(visit).toContainText('Categoria: Referto clinico');
        await expect(visit).toContainText('Data: 2025-06-02');
        await expect(group.getByLabel('Scheda di destinazione')).toHaveValue(patientId);
        expect(await attachmentCount(page, patientId)).toBe(0);
        await page.screenshot({ path: path.join(evidence, '2-cartella-letta.png') });
        await group.screenshot({ path: path.join(evidence, '2b-inventario.png') });

        await group.getByLabel('Ho controllato le fonti e confermo che appartengono alla scheda scelta.').check();
        await group.getByRole('button', { name: 'Salva 2 originali nella scheda', exact: true }).click();
        await expect(group.getByTestId('dossier-acquire-outcome')).toHaveText(['Originale salvato e riletto identico', 'Originale salvato e riletto identico'], { timeout: 60_000 });
        const documents = panel.getByTestId('dossier-document');
        await expect(documents).toHaveCount(2, { timeout: 30_000 });
        await expect(documents.nth(0).getByRole('heading', { level: 3 })).toContainText('2025-03-14 · Referto di laboratorio');
        await expect(documents.nth(1).getByRole('heading', { level: 3 })).toContainText('2025-06-02 · Referto specialistico');
        expect(await attachmentCount(page, patientId)).toBe(2);
        expect(await clinicalRows(page, patientId)).toBe(0);
        await documents.nth(0).getByRole('heading', { level: 3 }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(evidence, '3-in-revisione.png') });

        rmSync(path.join(folder, 'appunti.pdf'));
        await writeFseDocument(folder, '2025-09-01_LAB_REFERTO_SPECIALISTICO_LABORATORIO_ASST_SINTETICA_2c3d4e5f.pdf', taxCode, 'Controllo sintetico');
        await openSiss(patientId);
        await page.locator('#siss').getByTestId('fse-folder').setInputFiles(folder);
        await expect(page).toHaveURL(new RegExp(`/patients/import/dossier\\?patientId=${patientId}`));
        await expect(sources).toHaveCount(3, { timeout: 60_000 });
        await expect(group.locator('[data-source-status="already_imported"]')).toHaveCount(2);
        await expect(group.locator('[data-source-status="already_imported"]').first()).toContainText('Già importato: saltato');
        await expect(group.locator('[data-source-status="ready"]')).toHaveCount(1);
        await group.screenshot({ path: path.join(evidence, '4-seconda-importazione.png') });
        await group.getByLabel('Ho controllato le fonti e confermo che appartengono alla scheda scelta.').check();
        await group.getByRole('button', { name: 'Salva 1 originale nella scheda', exact: true }).click();
        await expect(group.locator('[data-source-status="ready"]').getByTestId('dossier-acquire-outcome')).toHaveText('Originale salvato e riletto identico', { timeout: 60_000 });
        await expect(group.getByTestId('fse-cleanup')).toHaveText('Tutti i documenti della cartella sono in MediFlow. Puoi cancellare la cartella dai Download.');
        await group.screenshot({ path: path.join(evidence, '4b-proposta-di-pulizia.png') });
        expect(await attachmentCount(page, patientId)).toBe(3);
        expect(await attachmentCount(page, otherId)).toBe(0);

        await page.goto('/patients/new');
        await unlockIfNeeded(page, PIN);
        await expect(page.getByRole('button', { name: 'Documenti dal Fascicolo', exact: true })).toBeVisible();
        await page.getByTestId('dossier-import').getByTestId('fse-folder').setInputFiles(folder);
        await expect(page.getByTestId('dossier-group')).toHaveAttribute('data-identity', /^(suggested|matched)$/u, { timeout: 60_000 });
        await expect(page.getByTestId('dossier-source').filter({ hasText: '2025-03-14_LAB_' })).toContainText('Categoria: Analisi di laboratorio');
        await page.screenshot({ path: path.join(evidence, '5-nuova-scheda.png'), fullPage: true });

        await switchPreset(page, 'core');
        await page.goto(`/patients/${patientId}/modules`);
        await unlockIfNeeded(page, PIN);
        await expect(page.getByRole('navigation', { name: 'Sezioni della vista', exact: true })).toBeVisible();
        await expect(page.getByTestId('fse-folder')).toHaveCount(0);
        await page.goto(`/patients/import/dossier?patientId=${patientId}`);
        await unlockIfNeeded(page, PIN);
        await expect(page.getByRole('button', { name: 'Scegli cartella', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Documenti dal Fascicolo', exact: true })).toHaveCount(0);
        await page.goto('/patients/new');
        await unlockIfNeeded(page, PIN);
        await expect(page.getByTestId('patient-document-create')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Documenti dal Fascicolo', exact: true })).toHaveCount(0);
        await page.screenshot({ path: path.join(evidence, '6-senza-lombardia.png'), fullPage: true });
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
