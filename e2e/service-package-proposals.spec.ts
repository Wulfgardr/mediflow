import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/isolated-runtime';
import { switchPreset } from './fixtures/territorial-preset';
import { bootstrapUnlockedSession, openPatientSection, unlockIfNeeded } from './utils';

type Seed = { firstName: string; taxCode: string; diagnoses: { code: string; description: string }[]; exemptions: string[]; hba1c?: { prescribedAt: string; observedAt: string } };

function isoDay(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function fifteenthOfMonth(today: Date, monthOffset: number): string {
    return isoDay(new Date(today.getFullYear(), today.getMonth() + monthOffset, 15));
}

async function seedPatient(page: Page, seed: Seed): Promise<string> {
    return page.evaluate(async (input) => {
        const post = async (route: string, body: unknown) => {
            const response = await fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            if (!response.ok) throw new Error(`${route}: HTTP ${response.status}`);
            return response.json() as Promise<{ id: string }>;
        };
        const patient = await post('/api/patients', {
            firstName: input.firstName, lastName: 'Pacchetto', taxCode: input.taxCode, birthDate: '1958-03-14T00:00:00.000Z',
            diagnoses: input.diagnoses.map((diagnosis) => ({ ...diagnosis, system: 'ICD-11', date: null })), exemptions: input.exemptions,
        });
        if (input.hba1c) {
            const prescriptionId = crypto.randomUUID();
            const itemId = crypto.randomUUID();
            await post('/api/service-prescriptions', {
                id: prescriptionId, patientId: patient.id, prescribedAt: `${input.hba1c.prescribedAt}T00:00:00.000Z`, status: 'prescribed', category: 'lab',
                priority: 'P', codeSystem: 'REGIONAL_PRESTAZIONI', serviceCode: '90.28.1', serviceName: 'Hb - Emoglobina glicata', source: 'manual',
                version: 1, createdAt: `${input.hba1c.prescribedAt}T00:00:00.000Z`, updatedAt: `${input.hba1c.prescribedAt}T00:00:00.000Z`,
            });
            await post('/api/service-prescription-items', {
                id: itemId, patientId: patient.id, prescriptionId, ordinal: 0, status: 'prescribed', category: 'lab',
                codeSystem: 'REGIONAL_PRESTAZIONI', serviceCode: '90.28.1', serviceName: 'Hb - Emoglobina glicata', matchStatus: 'manual',
                version: 1, createdAt: `${input.hba1c.prescribedAt}T00:00:00.000Z`, updatedAt: `${input.hba1c.prescribedAt}T00:00:00.000Z`,
            });
            await post('/api/observations', {
                patientId: patient.id, codeSystem: 'LOINC', code: '4548-4', display: 'Emoglobina glicata (HbA1c %)', unitSystem: 'UCUM',
                unitCode: '%', value: 6.9, observedAt: `${input.hba1c.observedAt}T08:00:00.000Z`, servicePrescriptionItemId: itemId, source: 'manual',
            });
        }
        return patient.id;
    }, seed);
}

test('approved packages propose in the Web visit only what is missing from the record, and write only on the physician gesture', async ({ page, isolatedRuntime }, info) => {
    test.setTimeout(240_000);
    const evidence = process.env.SERVICE_PACKAGE_EVIDENCE_DIR || info.outputPath('pacchetti');
    mkdirSync(evidence, { recursive: true });
    const today = new Date();
    const hba1c = { prescribedAt: fifteenthOfMonth(today, -3), observedAt: fifteenthOfMonth(today, -2) };
    const hba1cValidUntil = fifteenthOfMonth(today, 4);
    await page.setViewportSize({ width: 1280, height: 3200 });
    await bootstrapUnlockedSession(page, '314159');
    await switchPreset(page, 'core+it+lom');

    const plain = await seedPatient(page, {
        firstName: 'Ada', taxCode: 'PCCDAA58C54F205X', exemptions: ['013'], hba1c,
        diagnoses: [{ code: '5A11', description: 'Diabete mellito di tipo 2' }],
    });
    const renal = await seedPatient(page, {
        firstName: 'Bruno', taxCode: 'PCCBRN58C14F205Y', exemptions: ['013'],
        diagnoses: [{ code: '5A11', description: 'Diabete mellito di tipo 2' }, { code: 'GB61', description: 'Malattia renale cronica' }],
    });

    const db = new Database(join(isolatedRuntime.dataDirectory, 'medical.db'), { readonly: true, fileMustExist: true });
    const rows = (patientId: string) => db.prepare('SELECT id, service_code AS code, code_system AS system, status FROM service_prescriptions WHERE patient_id = ? ORDER BY service_code')
        .all(patientId) as { id: string; code: string; system: string; status: string }[];
    const audited = (ids: string[]) => db.prepare(`SELECT subject_ref AS id FROM audit_events WHERE event_type = 'service.prescription.created' AND subject_ref IN (${ids.map(() => '?').join(',')})`)
        .pluck().all(...ids) as string[];
    const writes: string[] = [];
    page.on('request', (request) => {
        if (request.method() !== 'GET' && /\/api\/service-prescription/u.test(request.url())) writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
    });

    const proposals = page.getByTestId('service-package-proposals');
    const proposed = (code: string) => proposals.getByTestId('service-package-requests').locator(`li[data-service-code="${code}"]`);
    const excluded = (code: string) => proposals.getByTestId('service-package-skipped').locator(`li[data-service-code="${code}"]`);
    const openPrestazioni = async (patientId: string) => {
        await page.goto(`/patients/${patientId}/modules`);
        await unlockIfNeeded(page, '314159');
        await openPatientSection(page, 'prestazioni');
    };

    try {
        await openPrestazioni(plain);
        await expect(proposals).toBeVisible();
        await expect(proposals.getByRole('heading', { name: 'Monitoraggio diabete mellito tipo 2', exact: true })).toBeVisible();
        await expect(proposals).toContainText('Approvato da Leonardo Pegollo il 2026-11-25');
        await expect(proposed('95.11')).toContainText('Mai eseguita');
        await expect(proposed('95.11')).toContainText('Esenzione 013');
        await expect(proposed('90.28.1')).toHaveCount(0);
        await proposals.getByRole('button', { name: /^\d+ prestazion[ei] esclus[ae]$/u }).click();
        await expect(excluded('90.28.1')).toContainText(`(fino al ${hba1cValidUntil})`);
        await expect(proposals.getByTestId('service-package-uncompared')).toHaveCount(0);
        await expect(proposed('90.37.4'), 'without kidney disease the renal module stays off').toHaveCount(0);
        await proposals.screenshot({ path: join(evidence, '1-proposta-hba1c-esclusa-fundus-proposto.png') });
        expect(writes, 'opening the visit and reading the proposal writes nothing').toEqual([]);
        expect(rows(plain).map((row) => row.code)).toEqual(['90.28.1']);

        const requested = proposals.getByTestId('service-package-requests').locator('li[data-service-code]');
        const requestedCodes = await requested.evaluateAll((items) => items.map((item) => item.getAttribute('data-service-code')));
        for (const code of requestedCodes) if (code !== '95.11') await proposed(code!).getByRole('checkbox').uncheck();
        await proposed('95.11').getByLabel('Quesito', { exact: true }).fill('Diabete tipo 2, screening retinopatia mai eseguito');
        expect(writes, 'choosing and editing write nothing').toEqual([]);
        await proposals.getByRole('button', { name: 'Prescrivi 1 prestazione', exact: true }).click();
        await expect(proposals.getByRole('status')).toHaveText('Registrate fra le prestazioni prescritte: 1.');
        await expect(proposed('95.11')).toHaveCount(0);
        await expect(proposals.getByRole('button', { name: 'Prescrivi 0 prestazioni', exact: true }), 'choices the physician removed stay removed').toBeDisabled();
        await expect(excluded('95.11')).toContainText(`Già prescritta o prenotata (${isoDay(today)})`);
        const created = rows(plain).filter((row) => row.code === '95.11');
        expect(created).toHaveLength(1);
        expect(created[0]).toMatchObject({ system: 'REGIONAL_PRESTAZIONI', status: 'prescribed' });
        expect(audited(created.map((row) => row.id))).toEqual([created[0].id]);
        expect(writes).toEqual(['POST /api/service-prescriptions', 'POST /api/service-prescription-items']);
        await proposals.screenshot({ path: join(evidence, '2-dopo-il-gesto-fundus-prescritto.png') });

        await openPrestazioni(renal);
        await expect(proposals).toContainText('con malattia renale cronica');
        await expect(proposed('95.11'), 'the other patient prescription does not reach this proposal').toContainText('Mai eseguita');
        await expect(proposed('90.28.1')).toContainText('Mai eseguita');
        await expect(proposed('90.37.4')).toContainText('Senza esenzione: 023 non registrata in scheda');
        await expect(proposed('90.33.4')).toContainText('ogni 6 mesi');
        expect(rows(renal)).toEqual([]);
        await proposals.screenshot({ path: join(evidence, '3-modulo-renale-altro-paziente.png') });

        await switchPreset(page, 'core+it');
        await openPrestazioni(renal);
        await expect(page.locator('#prestazioni')).toBeVisible();
        await expect(proposals, 'without the Lombardy pack there are no package proposals').toHaveCount(0);
        await page.screenshot({ path: join(evidence, '4-pacchetto-lombardia-spento.png'), fullPage: true });
        expect(rows(renal)).toEqual([]);
        expect(writes).toHaveLength(2);
    } finally {
        db.close();
    }
});
