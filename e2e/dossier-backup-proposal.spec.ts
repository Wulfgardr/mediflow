import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { test, expect } from './fixtures/isolated-runtime';
import { bootstrapUnlockedSession, openUnlockedDocument } from './utils';
import { randomSyntheticTaxCode } from '../lib/patient-identity.test-support.ts';

test.describe.configure({ retries: 0 });
const pin = '271828';

async function referto(taxCode: string): Promise<Uint8Array> {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const sheet = document.addPage([595, 842]);
    ['Referto di laboratorio sintetico', `Sig. Mario Rossi C.F.: ${taxCode}`, 'Data prelievo: 10/01/2025']
        .forEach((line, index) => sheet.drawText(line, { x: 40, y: 800 - index * 18, size: 11, font }));
    return document.save();
}

async function createPatient(page: Page, taxCode: string): Promise<string> {
    return page.evaluate(async (code) => {
        const response = await fetch('/api/patients', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ firstName: 'Mario', lastName: 'Rossi', taxCode: code, birthDate: '1980-01-01T00:00:00.000Z', diagnoses: [] }) });
        if (!response.ok) throw new Error(`Synthetic patient: HTTP ${response.status}`);
        return (await response.json() as { id: string }).id;
    }, taxCode);
}

async function attachmentCount(page: Page): Promise<number> {
    return page.evaluate(async () => {
        const response = await fetch('/api/attachments?metadata=true', { cache: 'no-store' });
        if (!response.ok) throw new Error(`Attachments: HTTP ${response.status}`);
        return (await response.json() as unknown[]).length;
    });
}

test('Dossier: a batch of five patients proposes a complete backup before writing, and the backup passes the existing verification', async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const codes = new Set<string>();
    while (codes.size < 5) codes.add(randomSyntheticTaxCode());
    const [first, ...others] = [...codes];
    const root = fs.mkdtempSync(path.join(tmpdir(), 'mediflow-dossier-backup-'));
    try {
        for (const [index, code] of [first, ...others].entries()) {
            const folder = path.join(root, 'Lotto', `Scheda-${index + 1}`);
            fs.mkdirSync(folder, { recursive: true });
            fs.writeFileSync(path.join(folder, 'referto.pdf'), await referto(code));
        }
        await bootstrapUnlockedSession(page, pin);
        const patientId = await createPatient(page, first);
        await openUnlockedDocument(page, '/patients/import/dossier', pin);
        const panel = page.getByTestId('dossier-import');
        await panel.getByTestId('dossier-folder').setInputFiles(path.join(root, 'Lotto'));
        await expect(panel.getByTestId('dossier-group')).toHaveCount(5, { timeout: 180_000 });

        const proposal = panel.getByTestId('dossier-backup-proposal');
        await expect(proposal).toContainText('Stai per scrivere in 5 schede.');
        await proposal.screenshot({ path: testInfo.outputPath('dossier-backup-proposal.png') });
        const group = panel.locator('[data-testid="dossier-group"][data-group="Scheda-1"]');
        await expect(group.getByLabel('Scheda di destinazione')).toHaveValue(patientId);
        await group.getByLabel('Ho controllato le fonti e confermo che appartengono alla scheda scelta.').check();
        const save = group.getByRole('button', { name: 'Salva 1 originale nella scheda', exact: true });
        await expect(save).toBeDisabled();
        for (const button of await panel.getByRole('button', { name: 'Crea la scheda da questo documento' }).all()) await expect(button).toBeDisabled();
        expect(await attachmentCount(page)).toBe(0);

        const download = page.waitForEvent('download');
        await proposal.getByRole('button', { name: 'Fai un backup adesso', exact: true }).click();
        const artifactPath = testInfo.outputPath('lotto.mediflow-recovery');
        await (await download).saveAs(artifactPath);
        const bytes = fs.readFileSync(artifactPath);
        expect(bytes.subarray(0, 8).toString()).toBe('MDFREC01');
        expect(bytes.includes(Buffer.from('SQLite format 3'))).toBe(false);
        await expect(proposal).toBeHidden();
        await expect(panel.getByTestId('dossier-backup-made')).toContainText('Backup creato: mediflow-recovery-');
        expect(await attachmentCount(page)).toBe(0);

        await save.click();
        await expect(group.getByTestId('dossier-acquire-outcome')).toHaveText('Originale salvato e riletto identico', { timeout: 60_000 });
        expect(await attachmentCount(page)).toBe(1);

        await panel.getByTestId('dossier-folder').setInputFiles(path.join(root, 'Lotto'));
        await expect(proposal).toBeVisible({ timeout: 180_000 });
        await expect(panel.getByTestId('dossier-backup-made')).toBeHidden();
        await proposal.getByRole('button', { name: 'Continua senza backup', exact: true }).click();
        await expect(proposal).toBeHidden();
        await group.getByLabel('Ho controllato le fonti e confermo che appartengono alla scheda scelta.').check();
        await expect(save).toBeEnabled();

        await openUnlockedDocument(page, '/settings/backup', pin);
        const recovery = page.getByRole('region', { name: 'Backup completo di recupero', exact: true });
        await recovery.getByTestId('recovery-backup-verify').setInputFiles(artifactPath);
        await expect(recovery.getByRole('status')).toContainText('Cifratura e integrità del file verificate');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
