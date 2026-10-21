import { expect, test, type Page } from '@playwright/test';
import { differenceInYears } from 'date-fns';
import { mkdir } from 'node:fs/promises';
import { bootstrapUnlockedSession, openPatientSection, assertNoHorizontalOverflow } from './utils';

type Fixture = { patientId: string; therapyId: string; secondId: string };
const birthDate = '1972-04-12T00:00:00.000Z';
const patientLabel = (now: Date) => `Ada Sintetica, ${differenceInYears(now, new Date(birthDate))} anni`;
const threshold = (page: Page) => page.getByRole('region', { name: 'Cambio di stato della terapia', exact: true });
const row = (page: Page, secondary = false) => page.locator('#terapie').getByRole('row').filter({ has: page.getByText(secondary ? 'Farmaco sintetico secondario' : 'Ramipril sintetico 5 mg', { exact: true }) });
const confirm = (page: Page) => threshold(page).getByRole('button', { name: 'Conferma e registra', exact: true });

async function expectConfirmation(page: Page, question: string) {
    const region = threshold(page);
    const title = region.getByRole('heading', { name: question, exact: true, level: 3 });
    await expect(title).toBeVisible();
    await expect(title).toHaveClass(/\btype-threshold\b/);
    await expect(title).toHaveCSS('font-size', '15px');
    await expect(title).toHaveCSS('font-weight', '600');
    await expect(region.getByText(patientLabel(new Date()), { exact: true })).toHaveClass('type-body');
    await expect(region.getByText('Conferma il cambio di stato', { exact: true })).toHaveCount(0);
    await expect(region.locator('.lume-point')).toHaveCount(0);
}

async function expectUncertainOutcome(page: Page) {
    const region = threshold(page);
    const title = region.getByRole('heading', { name: 'Esito da verificare', exact: true, level: 3 });
    await expect(title).toBeVisible();
    await expect(title).toHaveClass(/\btype-threshold\b/);
    expect((await region.innerText()).match(/Esito da verificare/g)).toHaveLength(1);
    await expect(title.locator('[aria-hidden="true"]')).toHaveText('▲');
    const warningColor = await title.evaluate(element => {
        const probe = document.createElement('span');
        probe.style.color = 'var(--lume-signal-warning)';
        element.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
    });
    await expect(title).toHaveCSS('color', warningColor);
    await expect(region.locator('.lume-point')).toHaveCount(0);
    await expect(region.getByText('La registrazione può essere ancora in corso. Il nuovo invio resta bloccato finché la rilettura non ne chiarisce l’esito.', { exact: true })).toBeVisible();
    await expect(region.getByText('Ramipril sintetico 5 mg · 1 cp al mattino', { exact: true })).toBeVisible();
    await expect(region.getByText(patientLabel(new Date()), { exact: true })).toBeVisible();
}

async function fixture(page: Page): Promise<Fixture> {
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    return page.evaluate(async (birthDate) => {
        const marker = crypto.randomUUID();
        for (const key of ['aiPatientInsightKillSwitch', 'aiSmartImportKillSwitch', 'aiDocumentSynthesisKillSwitch', 'aiTreatmentReasoningKillSwitch']) {
            const response = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, value: 'disabled' }) });
            if (!response.ok) throw new Error('Synthetic setting failed');
        }
        const response = await fetch('/api/patients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ firstName: 'Ada', lastName: 'Sintetica', taxCode: `SYN${marker}`, birthDate }) });
        if (!response.ok) throw new Error('Synthetic patient failed');
        const { id: patientId } = await response.json();
        const therapyId = `therapy-${marker}`;
        const secondId = `second-${marker}`;
        for (const [id, drugName] of [[therapyId, 'Ramipril sintetico 5 mg'], [secondId, 'Farmaco sintetico secondario']]) {
            const added = await fetch('/api/therapies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, patientId, drugName, dosage: '1 cp al mattino', status: 'active', startDate: '2026-10-01T08:00:00.000Z' }) });
            if (!added.ok) throw new Error('Synthetic therapy failed');
        }
        return { patientId, therapyId, secondId };
    }, birthDate);
}
async function open(page: Page, data: Fixture) {
    await page.goto(`/patients/${data.patientId}/modules`);
    await openPatientSection(page, 'terapie');
    await expect(row(page)).toBeVisible();
}
function network(page: Page) {
    const writes: Array<{ id: string; body: { version: number; status: string } }> = [];
    const events: string[] = [];
    page.on('request', request => {
        const path = new URL(request.url()).pathname;
        if (['PUT', 'PATCH'].includes(request.method()) && path.startsWith('/api/therapies/')) {
            writes.push({ id: path.split('/').pop()!, body: request.postDataJSON() });
            events.push(request.method());
        }
        if (request.method() === 'GET' && path === '/api/therapies') events.push('GET');
    });
    return { writes, events };
}
async function stored(page: Page, data: Fixture) {
    const response = await page.request.get(`/api/therapies?patientId=${data.patientId}`);
    expect(response.status()).toBe(200);
    return (await response.json() as Array<{ id: string; version: number; status: string }>).find(item => item.id === data.therapyId);
}

test('patient age advances only on the birthday', () => {
    const birthday = new Date(birthDate);
    const dayBefore = new Date(birthday.getTime());
    dayBefore.setFullYear(dayBefore.getFullYear() + 55);
    dayBefore.setDate(dayBefore.getDate() - 1);
    const onBirthday = new Date(birthday.getTime());
    onBirthday.setFullYear(onBirthday.getFullYear() + 55);
    expect(patientLabel(dayBefore)).toBe('Ada Sintetica, 54 anni');
    expect(patientLabel(onBirthday)).toBe('Ada Sintetica, 55 anni');
});

test('first gesture then return to record issues zero writes', async ({ page }) => {
    const data = await fixture(page);
    await open(page, data);
    const { writes } = network(page);
    await row(page).getByRole('button', { name: 'Sospendi', exact: true }).click();
    await expectConfirmation(page, 'Sospendere Ramipril sintetico 5 mg, 1 cp al mattino?');
    await threshold(page).getByRole('button', { name: 'Torna alla scheda', exact: true }).click();
    await expect(threshold(page)).toHaveCount(0);
    const current = await stored(page, data);
    expect(writes).toEqual([]);
    expect(current).toMatchObject({ version: 1, status: 'active' });
});

test('second gesture writes once with the shown patient and version; registered waits for readback', async ({ page }) => {
    const data = await fixture(page);
    await open(page, data);
    const { writes, events } = network(page);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let entered = false;
    await page.route('**/api/therapies?*', async route => {
        if (!writes.length) return route.continue();
        const response = await route.fetch();
        entered = true;
        await gate;
        await route.fulfill({ response });
    });
    try {
        await row(page).getByRole('button', { name: 'Sospendi', exact: true }).click();
        expect(writes).toHaveLength(0);
        await confirm(page).click();
        await expect.poll(() => entered).toBe(true);
        await expect(threshold(page)).toContainText('Rilettura in corso');
        await expect(threshold(page).getByText('Registrata', { exact: true })).toHaveCount(0);
        expect(writes).toEqual([{ id: data.therapyId, body: expect.objectContaining({ version: 1, status: 'suspended' }) }]);
        release();
        await expect(threshold(page).getByText('Registrata', { exact: true })).toBeVisible();
        expect(events.indexOf('GET')).toBeGreaterThan(events.indexOf('PUT'));
        expect(await stored(page, data)).toMatchObject({ version: 2, status: 'suspended' });
        expect(writes).toHaveLength(1);
    } finally { release(); }
});

test('409 requires readback and a new first gesture and confirmation', async ({ page }) => {
    const data = await fixture(page);
    await open(page, data);
    await row(page).getByRole('button', { name: 'Sospendi', exact: true }).click();
    const concurrent = await page.evaluate(async id => {
        const response = await fetch(`/api/therapies/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: 1, dosage: '2 cp alla sera' }) });
        return response.status;
    }, data.therapyId);
    expect(concurrent).toBe(200);
    const { writes } = network(page);
    const rejected = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith(data.therapyId));
    await confirm(page).click();
    expect((await rejected).status()).toBe(409);
    await expect(threshold(page)).toContainText("La terapia è stata modificata da un'altra postazione. Nulla è stato scritto.");
    await expect(confirm(page)).toHaveCount(0);
    await threshold(page).getByRole('button', { name: 'Rileggi la terapia', exact: true }).click();
    await expect(threshold(page)).toContainText('Stato attuale: Attiva');
    await expect(threshold(page)).toContainText('2 cp alla sera');
    await expect(confirm(page)).toHaveCount(0);
    expect(writes).toHaveLength(1);
    await threshold(page).getByRole('button', { name: 'Torna alla scheda', exact: true }).click();
    await expect(row(page)).toContainText('2 cp alla sera');
    await row(page).getByRole('button', { name: 'Sospendi', exact: true }).click();
    await expect(threshold(page)).toContainText('Sospendere Ramipril sintetico 5 mg, 2 cp alla sera?');
    expect(writes).toHaveLength(1);
    await confirm(page).click();
    await expect(threshold(page).getByText('Registrata', { exact: true })).toBeVisible();
    expect(writes.map(write => write.body.version)).toEqual([1, 2]);
    expect(await stored(page, data)).toMatchObject({ version: 3, status: 'suspended' });
});

for (const applied of [true, false]) {
    test(`lost response blocks resend until readback; committed=${applied}`, async ({ page }) => {
        const data = await fixture(page);
        await open(page, data);
        const { writes } = network(page);
        await page.route(`**/api/therapies/${data.therapyId}`, async route => {
            if (route.request().method() !== 'PUT') return route.continue();
            if (applied) expect((await route.fetch()).status()).toBe(200);
            await route.abort('failed');
        });
        await row(page).getByRole('button', { name: 'Sospendi', exact: true }).click();
        await confirm(page).click();
        await expectUncertainOutcome(page);
        await expect(confirm(page)).toHaveCount(0);
        await expect(row(page).getByRole('button', { name: 'Sospendi', exact: true })).toBeDisabled();
        await expect(row(page, true).getByRole('button', { name: 'Concludi', exact: true })).toBeDisabled();
        await threshold(page).getByRole('button', { name: 'Rileggi e verifica', exact: true }).click();
        if (applied) await expect(threshold(page).getByText('Terapia riletta', { exact: true })).toBeVisible();
        else {
            await expectUncertainOutcome(page);
            await expect(row(page).getByRole('button', { name: 'Sospendi', exact: true })).toBeDisabled();
        }
        await expect(threshold(page).getByText('Registrata', { exact: true })).toHaveCount(0);
        await expect(confirm(page)).toHaveCount(0);
        expect(writes).toHaveLength(1);
        expect(await stored(page, data)).toMatchObject({ version: applied ? 2 : 1, status: applied ? 'suspended' : 'active' });
    });
}

test('another therapy replaces confirmation; leaving the record retires the prompt', async ({ page }) => {
    const data = await fixture(page);
    const other = await fixture(page);
    await open(page, data);
    const { writes } = network(page);
    await row(page).getByRole('button', { name: 'Sospendi', exact: true }).click();
    await row(page, true).getByRole('button', { name: 'Concludi', exact: true }).click();
    await expect(threshold(page)).toContainText('Concludere Farmaco sintetico secondario');
    await confirm(page).click();
    await expect(threshold(page).getByText('Registrata', { exact: true })).toBeVisible();
    expect(writes.map(write => write.id)).toEqual([data.secondId]);
    await row(page).getByRole('button', { name: 'Sospendi', exact: true }).click();
    await page.getByRole('navigation', { name: 'Navigazione principale', exact: true }).getByRole('link', { name: 'Analisi', exact: true }).click();
    const discard = page.getByRole('dialog', { name: 'Lasciare la compilazione?', exact: true });
    await discard.getByRole('button', { name: 'Esci senza salvare', exact: true }).click();
    await expect(page).toHaveURL(/\/analytics$/);
    await open(page, other);
    await expect(threshold(page)).toHaveCount(0);
    await row(page).getByRole('button', { name: 'Sospendi', exact: true }).click();
    await threshold(page).getByRole('button', { name: 'Torna alla scheda', exact: true }).click();
    expect(writes).toHaveLength(1);
    expect(await stored(page, data)).toMatchObject({ version: 1, status: 'active' });
});

for (const theme of ['light', 'dark']) for (const width of [390, 1440]) {
    test(`threshold and uncertain outcome render ${theme} ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 960 });
        await page.addInitScript(value => localStorage.setItem('mediflow-theme', value), theme);
        const data = await fixture(page);
        await open(page, data);
        const { writes } = network(page);
        await page.route(`**/api/therapies/${data.therapyId}`, route => route.request().method() === 'PUT' ? route.abort('failed') : route.continue());
        await row(page).getByRole('button', { name: 'Sospendi', exact: true }).click();
        await expectConfirmation(page, 'Sospendere Ramipril sintetico 5 mg, 1 cp al mattino?');
        await assertNoHorizontalOverflow(page, [{ label: 'threshold', selector: '[aria-label="Cambio di stato della terapia"]' }]);
        const dir = process.env.THERAPY_SCREENSHOT_DIR || test.info().outputPath('captures');
        await mkdir(dir, { recursive: true });
        const themeName = theme === 'light' ? 'giorno' : 'grafite';
        const suffix = process.env.THERAPY_SCREENSHOT_SUFFIX || '';
        await page.screenshot({ path: `${dir}/soglia-${themeName}-${width}${suffix}.png` });
        await confirm(page).click();
        await expectUncertainOutcome(page);
        await page.screenshot({ path: `${dir}/esito-da-verificare-${themeName}-${width}${suffix}.png` });
        expect(writes).toHaveLength(1);
        await assertNoHorizontalOverflow(page, [{ label: 'threshold', selector: '[aria-label="Cambio di stato della terapia"]' }]);
    });
}

test('suspend, reactivate and complete each require their own confirmation and preserve endDate semantics', async ({ page }) => {
    const data = await fixture(page);
    await open(page, data);
    const { writes } = network(page);
    const transitions = [
        { action: 'Sospendi', verb: 'Sospendere', status: 'suspended' },
        { action: 'Riattiva', verb: 'Riattivare', status: 'active' },
        { action: 'Concludi', verb: 'Concludere', status: 'completed' },
        { action: 'Riattiva', verb: 'Riattivare', status: 'active' },
    ];
    for (const [index, transition] of transitions.entries()) {
        await row(page).getByRole('button', { name: transition.action, exact: true }).click();
        await expectConfirmation(page, `${transition.verb} Ramipril sintetico 5 mg, 1 cp al mattino?`);
        expect(writes).toHaveLength(index);
        await confirm(page).click();
        await expect(threshold(page).getByText('Registrata', { exact: true })).toBeVisible();
        expect(writes).toHaveLength(index + 1);
        expect(writes[index]).toMatchObject({ id: data.therapyId, body: { version: index + 1, status: transition.status } });
        const response = await page.request.get(`/api/therapies?patientId=${data.patientId}`);
        expect(response.status()).toBe(200);
        const item = (await response.json() as Array<{ id: string; endDate: string | null }>).find(item => item.id === data.therapyId)!;
        if (transition.status === 'completed') expect(Number.isFinite(Date.parse(item.endDate!))).toBe(true);
        if (transition.status === 'active') expect(item.endDate).toBeNull();
        await threshold(page).getByRole('button', { name: 'Torna alla scheda', exact: true }).click();
    }
});


test('an ambiguous write survives navigation and reload until an advanced version is read', async ({ page }) => {
    const data = await fixture(page);
    const other = await fixture(page);
    await open(page, data);
    const { writes } = network(page);
    await page.route(`**/api/therapies/${data.therapyId}`, async route => {
        if (route.request().method() !== 'PUT') return route.continue();
        await route.abort('failed');
    });
    await row(page).getByRole('button', { name: 'Sospendi', exact: true }).click();
    await confirm(page).click();
    await expectUncertainOutcome(page);
    await threshold(page).getByRole('button', { name: 'Rileggi e verifica', exact: true }).click();
    await expectUncertainOutcome(page);
    expect(await stored(page, data)).toMatchObject({ version: 1, status: 'active' });
    await page.getByRole('navigation', { name: 'Navigazione principale', exact: true }).getByRole('link', { name: 'Analisi', exact: true }).click();
    await page.getByRole('dialog', { name: 'Lasciare la compilazione?', exact: true })
        .getByRole('button', { name: 'Esci senza salvare', exact: true }).click();
    await expect(page).toHaveURL(/\/analytics$/);
    await open(page, other);
    await expect(threshold(page)).toHaveCount(0);
    await open(page, data);
    await expectUncertainOutcome(page);
    await page.reload();
    await openPatientSection(page, 'terapie');
    await expectUncertainOutcome(page);
    await expect(row(page).getByRole('button', { name: 'Sospendi', exact: true })).toBeDisabled();
    await expect(row(page).getByRole('button', { name: 'Concludi', exact: true })).toBeDisabled();
    await expect(row(page).getByRole('button', { name: 'Modifica', exact: true })).toBeDisabled();
    await expect(confirm(page)).toHaveCount(0);
    await threshold(page).getByRole('button', { name: 'Rileggi e verifica', exact: true }).click();
    await expectUncertainOutcome(page);
    expect(writes).toHaveLength(1);
    const archive = await (await page.request.get('/api/auth/check')).json();
    const late = await page.request.put(`/api/therapies/${data.therapyId}`, {
        headers: { 'x-mediflow-archive-generation': archive.archiveGeneration }, data: { version: 1, status: 'suspended' },
    });
    expect(late.status()).toBe(200);
    await threshold(page).getByRole('button', { name: 'Rileggi e verifica', exact: true }).click();
    await expect(threshold(page).getByText('Terapia riletta', { exact: true })).toBeVisible();
    await expect(threshold(page).getByText('Registrata', { exact: true })).toHaveCount(0);
    await expect(threshold(page)).toContainText('Stato attuale: Sospesa');
    await threshold(page).getByRole('button', { name: 'Torna alla scheda', exact: true }).click();
    await page.unroute(`**/api/therapies/${data.therapyId}`);
    await row(page).getByRole('button', { name: 'Riattiva', exact: true }).click();
    await confirm(page).click();
    await expect(threshold(page).getByText('Registrata', { exact: true })).toBeVisible();
    expect(writes.map(write => write.body.version)).toEqual([1, 2]);
});

test('a second tab inherits the unresolved barrier and cannot confirm its older prompt', async ({ page }) => {
    const data = await fixture(page);
    await open(page, data);
    const popup = page.waitForEvent('popup');
    await page.evaluate(() => { window.open(location.href); });
    const other = await popup;
    await openPatientSection(other, 'terapie');
    await row(other).getByRole('button', { name: 'Concludi', exact: true }).click();
    const a = network(page);
    const b = network(other);
    await page.route(`**/api/therapies/${data.therapyId}`, route => route.request().method() === 'PUT' ? route.abort('failed') : route.continue());
    await row(page).getByRole('button', { name: 'Sospendi', exact: true }).click();
    await confirm(page).click();
    await expectUncertainOutcome(page);
    await expectUncertainOutcome(other);
    await expect(confirm(other)).toHaveCount(0);
    await other.reload();
    await openPatientSection(other, 'terapie');
    await expectUncertainOutcome(other);
    await threshold(other).getByRole('button', { name: 'Rileggi e verifica', exact: true }).click();
    await expectUncertainOutcome(other);
    expect(a.writes.length + b.writes.length).toBe(1);
    expect(await stored(page, data)).toMatchObject({ version: 1, status: 'active' });
    await other.close();
});

test('an authoritative HTTP rejection is distinct from a lost response', async ({ page }) => {
    const data = await fixture(page);
    await open(page, data);
    const { writes } = network(page);
    await page.route(`**/api/therapies/${data.therapyId}`, route => route.request().method() === 'PUT'
        ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic validation rejection' }) }) : route.continue());
    await row(page).getByRole('button', { name: 'Sospendi', exact: true }).click();
    await confirm(page).click();
    await expect(threshold(page).getByText('Modifica non registrata', { exact: true })).toBeVisible();
    await expect(threshold(page).getByText('Esito da verificare', { exact: true })).toHaveCount(0);
    await expect(row(page).getByRole('button', { name: 'Concludi', exact: true })).toBeDisabled();
    await threshold(page).getByRole('button', { name: 'Rileggi e verifica', exact: true }).click();
    await expect(threshold(page).getByText('Terapia riletta', { exact: true })).toBeVisible();
    expect(writes).toHaveLength(1);
    expect(await stored(page, data)).toMatchObject({ version: 1, status: 'active' });
});
