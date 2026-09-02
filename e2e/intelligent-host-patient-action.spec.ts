/* @Codex */

import { expect, test, type Page } from '@playwright/test';

import { bootstrapUnlockedSession } from './utils';

type Fixture = Readonly<{ patientId: string; ambulatoryId: string }>;

async function createFixture(page: Page, suffix: string): Promise<Fixture> {
    return page.evaluate(async (marker) => {
        const created = await fetch('/api/patients', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                firstName: `Host${marker}`,
                lastName: 'Synthetic',
                taxCode: `HOST${marker}`,
                address: 'Synthetic address',
                phone: '0000000281',
                diagnoses: [],
            }),
        });
        if (!created.ok) throw new Error(`Synthetic patient creation failed: ${created.status}`);
        const { id } = await created.json() as { id: string };
        const read = await fetch(`/api/patients/${encodeURIComponent(id)}`);
        if (!read.ok) throw new Error(`Synthetic patient read failed: ${read.status}`);
        const patient = await read.json() as { id: string; ambulatoryId?: string };
        if (!patient.ambulatoryId) throw new Error('Synthetic patient has no authoritative ambulatory');
        return { patientId: patient.id, ambulatoryId: patient.ambulatoryId };
    }, suffix);
}

test('patient header activates once, resyncs explicitly on 409, and terminalizes 503', async ({ page }) => {
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const marker = `${Date.now()}`.slice(-7);
    const first = await createFixture(page, `${marker}A`);
    const second = await createFixture(page, `${marker}B`);
    await page.setViewportSize({ width: 390, height: 844 });
    let epoch = 0;
    let activation: 'active' | 'conflict' | 'unavailable' = 'active';
    const selectionBodies: unknown[] = [];
    const activationBodies: unknown[] = [];

    await page.route('**/api/ai/smart-import/selection', async (route) => {
        if (route.request().method() === 'GET') {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ selectionEpoch: epoch }) });
            return;
        }
        const body = route.request().postDataJSON() as { expectedEpoch: number };
        selectionBodies.push(body);
        epoch = body.expectedEpoch + 1;
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                selection: {
                    sessionRef: `ssr_${'1'.repeat(32)}`,
                    selectionEpoch: epoch,
                    patientRef: `ptr_${'2'.repeat(32)}`,
                    ambulatoryRef: `abr_${'3'.repeat(32)}`,
                    leaseRef: `lsr_${epoch.toString(16).padStart(32, '0')}`,
                    expiresAt: Date.now() + 10 * 60_000,
                },
            }),
        });
    });
    await page.route('**/api/patients/*/intelligent-host/activate', async (route) => {
        activationBodies.push(route.request().postDataJSON());
        if (activation === 'conflict') {
            await route.fulfill({ status: 409, contentType: 'application/json', body: '{}' });
        } else if (activation === 'unavailable') {
            await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
        } else {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ state: 'active', expiresAt: Date.now() + 5 * 60_000 }),
            });
        }
    });

    await page.goto(`/patients/${first.patientId}/modules`);
    let action = page.getByTestId('intelligent-host-patient-action');
    let activate = action.getByRole('button', { name: 'Attiva Intelligent Host per questa scheda' });
    await expect(activate).toBeEnabled();
    const target = await activate.boundingBox();
    expect(Math.min(target?.width ?? 0, target?.height ?? 0)).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await activate.click();
    const activeStatus = action.getByRole('status');
    await expect(activeStatus).toContainText('Host intelligente attivo fino alle');
    await expect(activeStatus).not.toContainText(first.patientId);
    await expect(activeStatus).not.toContainText(first.ambulatoryId);
    await expect(action.getByRole('button', { name: 'Intelligent Host attivo per questa scheda' })).toBeDisabled();
    expect(selectionBodies[0]).toEqual({ expectedEpoch: 0, ...first });
    expect(activationBodies[0]).toEqual({ selectionEpoch: 1 });

    activation = 'conflict';
    await page.goto(`/patients/${second.patientId}/modules`);
    action = page.getByTestId('intelligent-host-patient-action');
    activate = action.getByRole('button', { name: 'Attiva Intelligent Host per questa scheda' });
    await expect(activate).toBeEnabled();
    await activate.click();
    await expect(action.getByRole('status')).toContainText('Selezione non più corrente');
    await expect(activate).toBeDisabled();
    expect(activationBodies).toHaveLength(2);

    await action.getByRole('button', { name: 'Riallinea selezione' }).click();
    await expect(action.getByRole('status')).toContainText('Selezione riallineata');
    await expect(activate).toBeEnabled();

    activation = 'unavailable';
    await activate.click();
    await expect(action.getByRole('status')).toContainText('Host intelligente non disponibile');
    await expect(action.getByRole('status')).toContainText('Riavvia la sessione');
    await expect(action.getByRole('button', { name: 'Intelligent Host non disponibile per questa scheda' })).toBeDisabled();
    await expect(action.getByRole('button', { name: 'Riallinea selezione' })).toHaveCount(0);
    expect(activationBodies).toHaveLength(3);
    expect(activationBodies[2]).toEqual({ selectionEpoch: 3 });
});
