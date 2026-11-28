import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/isolated-runtime';
import { switchPreset } from './fixtures/territorial-preset';
import { fetchInterceptedRequest } from './fixtures/trusted-web-request';
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

async function captureBothThemes(page: Page, target: Locator, path: string) {
    for (const colorScheme of ['light', 'dark'] as const) {
        try {
            await page.emulateMedia({ colorScheme });
            await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${colorScheme}\\b`, 'u'));
            await target.screenshot({ path: path.replace(/\.png$/u, `-${colorScheme}.png`) });
        } finally { await page.emulateMedia({ colorScheme: 'light' }); }
    }
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
        await captureBothThemes(page, proposals, join(evidence, '1-proposta-hba1c-esclusa-fundus-proposto.png'));
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
        expect(writes, 'the gesture is one request committed in one transaction, no longer a prescription request followed by an item request').toEqual(['POST /api/service-prescription-sets']);
        await captureBothThemes(page, proposals, join(evidence, '2-dopo-il-gesto-fundus-prescritto.png'));

        await openPrestazioni(renal);
        await expect(proposals).toContainText('con malattia renale cronica');
        await expect(proposed('95.11'), 'the other patient prescription does not reach this proposal').toContainText('Mai eseguita');
        await expect(proposed('90.28.1')).toContainText('Mai eseguita');
        await expect(proposed('90.37.4')).toContainText('Senza esenzione: 023 non registrata in scheda');
        await expect(proposed('90.33.4')).toContainText('ogni 6 mesi');
        expect(rows(renal)).toEqual([]);
        await captureBothThemes(page, proposals, join(evidence, '3-modulo-renale-altro-paziente.png'));

        await switchPreset(page, 'core+it');
        await openPrestazioni(renal);
        await expect(page.locator('#prestazioni')).toBeVisible();
        await expect(proposals, 'without the Lombardy pack there are no package proposals').toHaveCount(0);
        await captureBothThemes(page, page.locator('#prestazioni'), join(evidence, '4-pacchetto-lombardia-spento.png'));
        expect(rows(renal)).toEqual([]);
        expect(writes).toHaveLength(1);
    } finally {
        db.close();
    }
});

test('a refused item leaves the whole gesture unwritten, and a lost answer is retried without duplicating the prescriptions', async ({ page, isolatedRuntime }, info) => {
    test.setTimeout(240_000);
    const evidence = process.env.SERVICE_PACKAGE_EVIDENCE_DIR || info.outputPath('pacchetti');
    mkdirSync(evidence, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 3200 });
    await bootstrapUnlockedSession(page, '314159');
    await switchPreset(page, 'core+it+lom');
    const patientId = await seedPatient(page, {
        firstName: 'Carla', taxCode: 'PCCCRL58C54F205Z', exemptions: ['013'],
        diagnoses: [{ code: '5A11', description: 'Diabete mellito di tipo 2' }],
    });

    const db = new Database(join(isolatedRuntime.dataDirectory, 'medical.db'), { readonly: true, fileMustExist: true });
    const codes = () => db.prepare('SELECT service_code FROM service_prescriptions WHERE patient_id = ? ORDER BY service_code').pluck().all(patientId) as string[];
    const itemCodes = () => db.prepare('SELECT service_code FROM service_prescription_items WHERE patient_id = ? ORDER BY service_code').pluck().all(patientId) as string[];
    const audited = (ids: string[]) => db.prepare(`SELECT event_type || ' ' || subject_ref FROM audit_events WHERE subject_ref IN (${ids.map(() => '?').join(',')}) ORDER BY rowid`)
        .pluck().all(...ids) as string[];
    type SentEntry = { prescription: { id: string }; item: { id: string; status?: string } };
    const sent: SentEntry[][] = [];
    page.on('request', (request) => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/service-prescription-sets') sent.push((request.postDataJSON() as { entries: SentEntry[] }).entries);
    });
    const idsOf = (entries: SentEntry[]) => entries.flatMap((entry) => [entry.prescription.id, entry.item.id]);

    const proposals = page.getByTestId('service-package-proposals');
    const proposed = (code: string) => proposals.getByTestId('service-package-requests').locator(`li[data-service-code="${code}"]`);
    await page.goto(`/patients/${patientId}/modules`);
    await unlockIfNeeded(page, '314159');
    await openPatientSection(page, 'prestazioni');
    await expect(proposed('95.11')).toContainText('Mai eseguita');
    await expect(proposed('90.28.1')).toContainText('Mai eseguita');
    const requestedCodes = await proposals.getByTestId('service-package-requests').locator('li[data-service-code]')
        .evaluateAll((items) => items.map((item) => item.getAttribute('data-service-code')));
    for (const code of requestedCodes) if (code !== '95.11' && code !== '90.28.1') await proposed(code!).getByRole('checkbox').uncheck();

    try {
        await page.route('**/api/service-prescription-sets', async (route) => {
            const body = route.request().postDataJSON() as { entries: SentEntry[] };
            body.entries[body.entries.length - 1].item.status = 'not-a-status';
            await route.continue({ postData: JSON.stringify(body) });
        }, { times: 1 });
        await proposals.getByRole('button', { name: 'Prescrivi 2 prestazioni', exact: true }).click();
        await expect(proposals.getByRole('alert')).toHaveText('Nessuna prestazione registrata: dati della prescrizione non validi.');
        expect(codes(), 'the refused item leaves no prescription of the gesture, not even the one before it').toEqual([]);
        expect(itemCodes()).toEqual([]);
        expect(audited(idsOf(sent[0])), 'and no audit').toEqual([]);
        await expect(proposed('95.11'), 'the proposal stays available after a refusal').toContainText('Mai eseguita');
        await expect(proposed('90.28.1')).toContainText('Mai eseguita');
        await captureBothThemes(page, proposals, join(evidence, '5-voce-rifiutata-nulla-registrato.png'));

        const lostAnswer: number[] = [];
        await page.route('**/api/service-prescription-sets', async (route) => {
            const committed = await fetchInterceptedRequest(route);
            lostAnswer.push(committed.status());
            await route.abort('connectionreset');
        }, { times: 1 });
        await proposals.getByRole('button', { name: 'Prescrivi 2 prestazioni', exact: true }).click();
        await expect(proposals.getByRole('alert')).toHaveText('Esito della registrazione non confermato.');
        expect(lostAnswer, 'the server answered and committed, the browser saw a reset connection').toEqual([201]);
        expect(codes(), 'the server committed although the browser never saw the answer').toEqual(['90.28.1', '95.11']);
        await expect(proposals.getByRole('button', { name: 'Riprova', exact: true })).toBeEnabled();
        await captureBothThemes(page, proposals, join(evidence, '6-risposta-persa-riprova.png'));

        await proposals.getByRole('button', { name: 'Riprova', exact: true }).click();
        await expect(proposals.getByRole('status')).toHaveText('Registrate fra le prestazioni prescritte: 2.');
        expect(sent).toHaveLength(3);
        expect(idsOf(sent[2]), 'the retry resends the gesture with the same ids').toEqual(idsOf(sent[1]));
        expect(codes(), 'the retry does not duplicate the prescriptions').toEqual(['90.28.1', '95.11']);
        expect(itemCodes()).toEqual(['90.28.1', '95.11']);
        const [first, second] = sent[1];
        expect(audited(idsOf(sent[1]))).toEqual([
            `service.prescription.created ${first.prescription.id}`, `service.prescription_item.created ${first.item.id}`,
            `service.prescription.created ${second.prescription.id}`, `service.prescription_item.created ${second.item.id}`,
        ]);
        await expect(proposed('95.11')).toHaveCount(0);
        await expect(proposed('90.28.1')).toHaveCount(0);
        await captureBothThemes(page, proposals, join(evidence, '7-riprova-senza-doppioni.png'));
    } finally {
        db.close();
    }
});
