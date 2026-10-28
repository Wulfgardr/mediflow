import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { bootstrapUnlockedSession, openPatientSection, unlockIfNeeded } from './utils';

type ClinicalReadGate = {
    captured: boolean; denied: boolean; returned: boolean; status?: number;
    signal?: AbortSignal; denials: number; request?: { method: string; url: string };
    dispatch: () => void; deliver: () => void;
};
declare global { interface Window { clinicalReadGate: ClinicalReadGate } }

async function installGate(page: Page, query: Record<string, string>) {
    await page.addInitScript(query => {
        const original = window.fetch.bind(window);
        let dispatch!: () => void, deliver!: () => void;
        const requestGate = new Promise<void>(resolve => { dispatch = resolve; });
        const responseGate = new Promise<void>(resolve => { deliver = resolve; });
        const state: ClinicalReadGate = window.clinicalReadGate = {
            captured: false, denied: false, returned: false, denials: 0, dispatch, deliver,
        };
        window.addEventListener('mediflow:api-auth-unavailable', () => { state.denials++; });
        window.fetch = async (input, init) => {
            const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
            const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
            const matchesQuery = url.searchParams.size === Object.keys(query).length
                && Object.entries(query).every(([key, value]) => url.searchParams.get(key) === value);
            if (state.captured || method !== 'GET' || url.pathname !== '/api/attachments' || !matchesQuery) return original(input, init);
            state.captured = true;
            state.request = { method, url: url.pathname + url.search };
            state.signal = init?.signal ?? undefined;
            await requestGate;
            const response = await original(input, { ...init, signal: undefined });
            state.status = response.status;
            state.denied = true;
            await responseGate;
            state.returned = true;
            return response;
        };
    }, query);
}

for (const consumer of ['EntryAttachments', 'NewEntryPage']) test(`${consumer}: a real old 401 preserves the new session and populated attachments`, async ({ page }) => {
    test.setTimeout(90_000);
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const fixture = await page.evaluate(async () => {
        const post = async (path: string, body: unknown) => {
            const response = await fetch(`/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
            if (!response.ok) throw new Error(`Synthetic ${path}: ${response.status}`);
            return response.json();
        };
        const patient = await post('patients', { firstName: 'Lettura', lastName: 'Sintetica',
            taxCode: `RL7${crypto.randomUUID().replaceAll('-', '').slice(0, 13).toUpperCase()}` });
        const attachmentId = crypto.randomUUID();
        await post('attachments', { id: attachmentId, patientId: patient.id, name: 'fonte-sessione-inventata.txt',
            type: 'text/plain', size: 15, path: 'uploads/fonte-sessione-inventata.txt', data: `data:text/plain;base64,${btoa('Testo inventato')}` });
        await post('entries', { patientId: patient.id, type: 'note', date: '2026-10-27', title: 'Lettura sintetica',
            content: 'Nota sintetica con fonte.', attachments: [attachmentId] });
        return { patientId: patient.id as string, attachmentId };
    });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const query: Record<string, string> = consumer === 'NewEntryPage' ? { patientId: fixture.patientId } : {};
    await installGate(page, query);
    const path = `/patients/${fixture.patientId}/${consumer === 'NewEntryPage' ? 'entries/new' : 'modules'}`;
    await page.goto(path);
    if (consumer === 'EntryAttachments') await openPatientSection(page, 'diario');
    await page.waitForFunction(() => window.clinicalReadGate.captured);
    expect(await page.evaluate(() => window.clinicalReadGate.request)).toEqual({
        method: 'GET', url: `/api/attachments${consumer === 'NewEntryPage' ? `?patientId=${fixture.patientId}` : ''}`,
    });
    const locked = page.waitForResponse(response => response.url().endsWith('/api/auth/lock') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Blocca', exact: true }).click();
    expect((await locked).status()).toBe(200);
    expect((await (await locked).json()).state).toBe('server_invalidation_confirmed');
    await expect(page.getByRole('heading', { name: 'Sblocca MediFlow' })).toBeVisible();
    await page.evaluate(() => window.clinicalReadGate.dispatch());
    await page.waitForFunction(() => window.clinicalReadGate.denied);
    expect(await page.evaluate(() => window.clinicalReadGate.status)).toBe(401);
    await unlockIfNeeded(page, process.env.E2E_PIN || '1234');
    const nav = page.getByRole('navigation', { name: 'Navigazione principale', exact: true });
    await expect(nav).toBeVisible();
    if (consumer === 'EntryAttachments') {
        await openPatientSection(page, 'diario');
        await expect(page.locator('#diario').getByRole('button', { name: /fonte-sessione-inventata/u })).toBeVisible();
    } else {
        await page.getByText('Consulta cartella', { exact: true }).click();
        await expect(page.getByRole('region', { name: 'Documenti in cartella' })).toContainText('fonte-sessione-inventata.txt');
    }
    const before = await page.evaluate(() => window.clinicalReadGate.denials);
    await page.evaluate(async () => {
        window.clinicalReadGate.deliver();
        await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())));
    });
    await page.waitForFunction(() => window.clinicalReadGate.returned);
    await expect(nav).toBeVisible();
    expect(await page.evaluate(() => window.clinicalReadGate.denials)).toBe(before);
    if (consumer === 'EntryAttachments') {
        await expect(page.locator('#diario').getByRole('button', { name: /fonte-sessione-inventata/u })).toBeVisible();
    } else {
        await expect(page.getByRole('region', { name: 'Documenti in cartella' })).toContainText('fonte-sessione-inventata.txt');
    }
    const status = await page.evaluate(async id => (await fetch(`/api/attachments/${id}`)).status, fixture.attachmentId);
    expect(status).toBe(200);
    await test.info().attach('session-read.json', { contentType: 'application/json', body: JSON.stringify(await page.evaluate(() => {
        const gate = window.clinicalReadGate;
        return { request: gate.request, status: gate.status, retired: gate.signal?.aborted, denials: gate.denials };
    })) });
    await page.screenshot({ path: test.info().outputPath(`${consumer}-${randomUUID()}.png`) });
    expect(errors).toEqual([]);
});
