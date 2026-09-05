/* @Codex */

import { expect, test, type Page } from '@playwright/test';

import { bootstrapUnlockedSession } from './utils';

type Fixture = Readonly<{
    patientId: string;
    ambulatoryId: string;
    firstCheckupId: string;
    secondCheckupId: string;
}>;

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

        const firstCheckupId = `checkup.synthetic.${marker}.a`;
        const secondCheckupId = `checkup.synthetic.${marker}.b`;
        for (const [checkupId, title, date] of [
            [firstCheckupId, 'Controllo sintetico A', '2027-01-10T09:00:00.000Z'],
            [secondCheckupId, 'Controllo sintetico B', '2027-01-11T09:00:00.000Z'],
        ]) {
            const checkup = await fetch('/api/checkups', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ id: checkupId, patientId: patient.id, title, date,
                    notes: 'Fixture sintetica', status: 'pending', source: 'manual' }),
            });
            if (!checkup.ok) throw new Error(`Synthetic checkup creation failed: ${checkup.status}`);
        }
        return { patientId: patient.id, ambulatoryId: patient.ambulatoryId,
            firstCheckupId, secondCheckupId };
    }, suffix);
}

test('checkup host creates the fresh selection once and revokes A before selecting B', async ({ page }) => {
    const pin = process.env.E2E_PIN || '1234';
    await bootstrapUnlockedSession(page, pin);
    const marker = `${Date.now()}`.slice(-7);
    const fixture = await createFixture(page, marker);
    await page.setViewportSize({ width: 390, height: 844 });

    let epoch = 0;
    const selectionBodies: unknown[] = [];
    const activationBodies: unknown[] = [];
    const checkupCalls: Array<Readonly<{ method: string; body: unknown }>> = [];
    await page.route('**/api/system/intelligent-host/checkup-active-role', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
            schemaVersion: 'mediflow.headless-checkup-active-role-enrollment.v1',
            status: 'active',
            attestationVersion: 1,
        }) });
    });
    await page.route('**/api/ai/smart-import/selection', async (route) => {
        if (route.request().method() === 'GET') {
            await route.fulfill({ status: 200, contentType: 'application/json',
                body: JSON.stringify({ selectionEpoch: epoch }) });
            return;
        }
        const body = route.request().postDataJSON() as { expectedEpoch: number };
        selectionBodies.push(body);
        epoch = body.expectedEpoch + 1;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
            selection: {
                sessionRef: `ssr_${'1'.repeat(32)}`,
                selectionEpoch: epoch,
                patientRef: `ptr_${'2'.repeat(32)}`,
                ambulatoryRef: `abr_${'3'.repeat(32)}`,
                leaseRef: `lsr_${epoch.toString(16).padStart(32, '0')}`,
                expiresAt: Date.now() + 10 * 60_000,
            },
        }) });
    });
    await page.route('**/api/patients/*/intelligent-host/activate', async (route) => {
        activationBodies.push(route.request().postDataJSON());
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
            state: 'active', expiresAt: Date.now() + 5 * 60_000,
        }) });
    });
    await page.route('**/api/patients/*/intelligent-host/checkup-status', async (route) => {
        const method = route.request().method();
        const body = method === 'POST' ? route.request().postDataJSON() : {};
        checkupCalls.push({ method, body });
        if (method === 'DELETE') {
            await route.fulfill({ status: 200, contentType: 'application/json', body: '{"state":"revoked"}' });
            return;
        }
        const checkupId = (body as { checkupId: string }).checkupId;
        const first = checkupId === fixture.firstCheckupId;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
            checkupRef: `hcsr_${(first ? 'a' : 'b').repeat(64)}`,
            uiBindingRef: `hcub_${(first ? 'd' : 'e').repeat(64)}`,
            resourceTitle: first ? 'Controllo sintetico A' : 'Controllo sintetico B',
            resourceRevision: 1,
        }) });
    });

    await page.goto(`/patients/${fixture.patientId}/modules`);
    const action = page.getByTestId('intelligent-host-checkup-action');
    const open = action.getByRole('button', { name: 'Checkup host' });
    await expect(open).toBeEnabled();
    const target = await open.boundingBox();
    expect(Math.min(target?.width ?? 0, target?.height ?? 0)).toBeGreaterThanOrEqual(44);
    await open.click();
    await action.getByLabel('PIN fresco').fill(pin);
    await action.getByRole('button', { name: 'Abilita ruolo' }).click();
    await expect(action.getByRole('status')).toContainText('Ruolo checkup attivo');

    const selector = action.getByLabel('Checkup pending');
    await expect(selector).toHaveValue(fixture.firstCheckupId);
    await action.getByRole('button', { name: 'Collega checkup' }).click();
    await expect(action.getByTestId('checkup-host-resource')).toContainText('Controllo sintetico A');
    expect(selectionBodies).toEqual([{ expectedEpoch: 0, patientId: fixture.patientId,
        ambulatoryId: fixture.ambulatoryId }]);
    expect(activationBodies).toEqual([{ selectionEpoch: 1 }]);

    await selector.selectOption(fixture.secondCheckupId);
    await expect(action.getByRole('status')).toContainText('Selezione cambiata');
    await action.getByRole('button', { name: 'Collega checkup' }).click();
    await expect(action.getByTestId('checkup-host-resource')).toContainText('Controllo sintetico B');
    expect(checkupCalls).toEqual([
        { method: 'POST', body: { checkupId: fixture.firstCheckupId } },
        { method: 'DELETE', body: {} },
        { method: 'POST', body: { checkupId: fixture.secondCheckupId } },
    ]);
    expect(selectionBodies).toHaveLength(1);
    expect(activationBodies).toHaveLength(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth
        - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
