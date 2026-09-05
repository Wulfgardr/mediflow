/* @Codex */
// Run only with the existing isolated E2E environment, never a clinical runtime.
// The real route/form/facade run; patient/checkup API responses below are synthetic.
import { expect, test, type Page } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

test.describe.configure({ retries: 0 });
test.beforeEach(async ({ baseURL }) => {
    if (process.env.MF085_SYNTHETIC_E2E !== '1') {
        throw new Error('Explicit isolated synthetic E2E environment required: MF085_SYNTHETIC_E2E=1');
    }
    const host = new URL(baseURL ?? 'http://invalid').hostname;
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) throw new Error('Local isolated E2E host required');
});
const PATIENT_ID = '10000000-0000-4000-8000-000000000001';
const CHECKUP_ID = '10000000-0000-4000-8000-000000000002';
const DIAGNOSIS_DATE = '2024-03-12T10:15:30.000Z';
type Write = { path: string; method: string; body: Record<string, unknown> };

async function editorFixture(page: Page, failure: 'none' | 'once' | 'conflict' = 'none') {
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const patient = {
        id: PATIENT_ID, version: 3, firstName: 'Sintetico', lastName: 'Editor',
        taxCode: 'SYNTHETIC0000001', birthDate: '1980-01-01T00:00:00.000Z',
        address: '', phone: '', monitoringProfile: 'taken_in_charge',
        diagnoses: [{ system: 'ICD-11', code: 'SYN1', description: 'Diagnosi sintetica', date: DIAGNOSIS_DATE }],
        createdAt: DIAGNOSIS_DATE, updatedAt: DIAGNOSIS_DATE,
    };
    const checkup = {
        id: CHECKUP_ID, patientId: PATIENT_ID, version: 5, title: 'Controllo sintetico',
        date: '2026-10-01T10:15:30.000Z', status: 'pending', source: 'manual',
        notes: '', createdAt: DIAGNOSIS_DATE,
    };
    const writes: Write[] = [];
    const patientVersionsRead: number[] = [];
    let failed = false;
    await page.route(/\/api\/(patients|checkups)(\/|\?|$)/, async route => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        const method = request.method();
        if (method === 'GET') {
            if (path === `/api/patients/${PATIENT_ID}`) {
                patientVersionsRead.push(patient.version);
                return route.fulfill({ json: patient });
            }
            if (path === '/api/patients') return route.fulfill({ json: [patient] });
            if (path === '/api/checkups') return route.fulfill({ json: [checkup] });
            return route.fulfill({ status: 404, json: { error: 'Synthetic fixture only' } });
        }
        const body = request.postDataJSON() as Record<string, unknown>;
        writes.push({ path, method, body });
        if (method === 'PUT' && path === `/api/patients/${PATIENT_ID}`) {
            expect(body.version).toBe(3);
            patient.version += 1;
            patient.firstName = 'Altrove'; // A live rerender must not replace the draft.
            return route.fulfill({ json: { success: true } });
        }
        if (method === 'PUT' && path === `/api/checkups/${CHECKUP_ID}`) {
            if (failure === 'conflict') return route.fulfill({ status: 409, json: {
                code: 'VERSION_CONFLICT', entity: 'checkup', recordId: CHECKUP_ID,
                expectedVersion: 5, currentVersion: 6, message: 'Synthetic conflict',
            } });
            if (failure === 'once' && !failed) {
                failed = true;
                return route.fulfill({ status: 503, json: { error: 'Synthetic unavailable response' } });
            }
            return route.fulfill({ json: { success: true } });
        }
        return route.fulfill({ status: 400, json: { error: 'Unexpected synthetic write' } });
    });
    await page.goto(`/patients/${PATIENT_ID}/edit`);
    await expect(page.locator('input[name="firstName"]')).toHaveValue('Sintetico');
    return { writes, patientVersionsRead };
}

test('ordinary unchanged save preserves business ID/date and sends no writes', async ({ page }) => {
    const { writes } = await editorFixture(page);
    await expect(page.locator('input[name="checkups.0.id"]')).toHaveValue(CHECKUP_ID);
    await expect(page.locator('input[name="diagnoses.0.date"]')).toHaveValue(DIAGNOSIS_DATE);
    await page.getByRole('button', { name: 'Aggiorna scheda', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/patients/${PATIENT_ID}/modules$`));
    expect(writes).toEqual([]);
});

test('partial save keeps draft after live rerender and retries only unconfirmed row', async ({ page }) => {
    const { writes, patientVersionsRead } = await editorFixture(page, 'once');
    await page.locator('input[name="firstName"]').fill('Modificato');
    await page.locator('input[name="checkups.0.title"]').fill('Controllo modificato');
    await page.getByRole('button', { name: 'Aggiorna scheda', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Salvataggio non completato' })).toBeVisible();
    await expect(page.getByText('1 di 2 operazioni confermate.', { exact: false })).toBeVisible();
    await expect.poll(() => patientVersionsRead.includes(4)).toBe(true);
    await expect(page.locator('input[name="firstName"]')).toHaveValue('Modificato');
    await expect(page.locator('input[name="firstName"]')).toBeDisabled();
    await page.getByRole('button', { name: 'Riprova operazioni residue', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/patients/${PATIENT_ID}/modules$`));
    expect(writes.map(row => [row.path, row.body.version])).toEqual([
        [`/api/patients/${PATIENT_ID}`, 3], [`/api/checkups/${CHECKUP_ID}`, 5], [`/api/checkups/${CHECKUP_ID}`, 5],
    ]);
    expect(writes[1].body).not.toHaveProperty('date');
    expect(writes[1].body).not.toHaveProperty('status');
});

test('a checkup conflict leaves the draft visible and offers explicit reread, not fresh-token retry', async ({ page }) => {
    const { writes } = await editorFixture(page, 'conflict');
    await page.locator('input[name="checkups.0.title"]').fill('Controllo modificato');
    await page.getByRole('button', { name: 'Aggiorna scheda', exact: true }).click();
    await expect(page.getByText('Un record è cambiato altrove.', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Riprova operazioni residue', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Rileggi i dati salvati', exact: true })).toBeEnabled();
    await expect(page.locator('input[name="checkups.0.title"]')).toHaveValue('Controllo modificato');
    expect(writes).toHaveLength(1);
    expect(writes[0].body.version).toBe(5);
});
