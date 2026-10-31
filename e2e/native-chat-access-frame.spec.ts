import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const html = fs.readFileSync('lib/chat-card/native-access.html', 'utf8');
let server: Server, fixtureUrl: string;

test.beforeAll(async () => {
    server = createServer((_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end('<!doctype html><html><body></body></html>');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    fixtureUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    expect((server.address() as AddressInfo).port).not.toBe(3000);
});
test.afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

test.beforeEach(async ({ page, context }) => {
    await context.route(url => url.port === '3000', route => route.abort('blockedbyclient'));
    await page.goto(fixtureUrl);
    await page.evaluate(source => {
        const state = { status: 'challenge', attached: false, holdRevoke: false, releaseRevoke: undefined as undefined | (() => void), revokeStatus: 'withdrawn', calls: [] as unknown[], payload: undefined as undefined | string, receipt: undefined as undefined | { commandId: string; outcome: string } };
        (window as unknown as { accessFixture: typeof state }).accessFixture = state;
        window.addEventListener('message', event => {
            const request = event.data;
            if (!request?.id) return;
            let result: unknown = {};
            if (request.method === 'ui/initialize') result = { protocolVersion: '2026-01-26', hostCapabilities: { serverTools: {} } };
            else if (request.method === 'tools/call') {
                state.calls.push(request.params);
                const command = request.params.arguments.command;
                let status = state.status;
                let payload: string | undefined;
                if (command === 'attach') { status = state.attached ? (state.status = state.revokeStatus) : 'ready'; state.attached = true; }
                if (command === 'consume') { status = state.status = 'consumed'; payload = state.payload ?? JSON.stringify({ profile: 'mediflow.synthetic-chat-card.v1', pseudonym: 'card_' + 'a'.repeat(32), history: [], therapies: [], measures: [] }); }
                if (command === 'revoke') status = state.status = state.revokeStatus;
                result = { content: [{ type: 'text', text: 'Esito disponibile nella vista.' }], _meta: { status, ...(payload ? { payload } : {}), ...(state.receipt ? { receipt: state.receipt } : {}) } };
            }
            const reply = () => (event.source as Window).postMessage({ jsonrpc: '2.0', id: request.id, result }, '*');
            if (request.params?.arguments?.command === 'revoke' && state.holdRevoke) state.releaseRevoke = reply;
            else reply();
        });
        const frame = document.createElement('iframe'); frame.id = 'access'; frame.sandbox.add('allow-scripts');
        frame.style.width = '100%'; frame.style.height = '600px'; frame.srcdoc = source;
        document.body.append(frame);
    }, html);
});

test('the static frame sends only closed status commands and consumes once', async ({ page }) => {
    const frame = page.frameLocator('#access');
    await frame.getByRole('button', { name: 'Richiedi accesso' }).click();
    await expect(frame.getByRole('status')).toContainText('Conferma nella finestra MediFlow');
    await page.evaluate(() => { (window as unknown as { accessFixture: { status: string } }).accessFixture.status = 'approved'; });
    await frame.getByRole('button', { name: 'Mostra scheda monouso' }).click();
    await expect(frame.getByRole('status')).toContainText('consumata');
    await expect(frame.getByRole('button', { name: 'Mostra scheda monouso' })).toBeDisabled();
    const calls = await page.evaluate(() => (window as unknown as { accessFixture: { calls: Record<string, unknown>[] } }).accessFixture.calls);
    for (const call of calls) {
        expect(call.name).toBe('mediflow_native_access');
        expect(Object.keys(call).sort()).toEqual(['arguments', 'name']);
        expect(Object.keys(call.arguments as object)).toEqual(['command']);
    }
});

test('reloading the frame retires its association instead of recovering a grant', async ({ page }) => {
    const frame = page.frameLocator('#access');
    await frame.getByRole('button', { name: 'Richiedi accesso' }).click();
    await expect(frame.getByRole('status')).toContainText('Conferma nella finestra MediFlow');
    await page.locator('#access').evaluate(element => { const frame = element as HTMLIFrameElement; frame.srcdoc = frame.srcdoc; });
    await expect(frame.getByRole('status')).toContainText('Accesso ritirato');
    await expect(frame.getByRole('button', { name: 'Richiedi accesso' })).toBeDisabled();
});

for (const scenario of ['native-revoke', 'new-turn', 'teardown', 'idle']) test(`displayed pseudonyms are withdrawn on ${scenario}`, async ({ page }) => {
    await page.clock.install();
    const frame = page.frameLocator('#access');
    await frame.getByRole('button', { name: 'Richiedi accesso' }).click();
    await page.evaluate(() => { (window as unknown as { accessFixture: { status: string } }).accessFixture.status = 'approved'; });
    await page.clock.runFor(1000);
    await frame.getByRole('button', { name: 'Mostra scheda monouso' }).click();
    await expect(frame.getByRole('region', { name: 'Scheda sintetica' })).toBeVisible();
    if (scenario === 'native-revoke') {
        await page.evaluate(() => { (window as unknown as { accessFixture: { status: string } }).accessFixture.status = 'withdrawn'; });
        await page.clock.runFor(1000);
    } else if (scenario === 'idle') await page.clock.runFor(300001);
    else await page.evaluate(method => {
        const target = (document.querySelector('#access') as HTMLIFrameElement).contentWindow!;
        target.postMessage({ jsonrpc: '2.0', id: 900, method }, '*');
    }, scenario === 'new-turn' ? 'ui/notifications/tool-input' : 'ui/resource-teardown');
    await expect(frame.getByRole('region', { name: 'Scheda sintetica' })).toBeHidden();
    await expect(frame.getByRole('button', { name: 'Mostra scheda monouso' })).toBeDisabled();
});

test('the initial tool-input notification does not revoke a view before the user starts', async ({ page }) => {
    await expect(page.frameLocator('#access').getByRole('button', { name: 'Richiedi accesso' })).toBeEnabled();
    await page.evaluate(() => (document.querySelector('#access') as HTMLIFrameElement).contentWindow!.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: { arguments: {} } }, '*'));
    await expect(page.frameLocator('#access').getByRole('button', { name: 'Richiedi accesso' })).toBeEnabled();
});


test('therapy command exposes only target and opaque receipt, with no automatic write retry', async ({ page }) => {
    const frame = page.frameLocator('#access');
    await frame.getByRole('button', { name: 'Sospendi terapia', exact: true }).click();
    await expect(frame.getByRole('button', { name: 'Mostra scheda monouso' })).toBeDisabled();
    await page.evaluate(() => {
        const fixture = (window as unknown as { accessFixture: { status: string; receipt: unknown } }).accessFixture;
        fixture.status = 'consumed'; fixture.receipt = { commandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', outcome: 'applied' };
    });
    await expect(frame.locator('#therapy-receipt')).toContainText('Modifica registrata e auditata');
    await expect(frame.getByRole('region', { name: 'Scheda sintetica' })).toBeHidden();
    const calls = await page.evaluate(() => (window as unknown as { accessFixture: { calls: { arguments: {command: string} }[] } }).accessFixture.calls);
    expect(calls.filter(c => c.arguments.command === 'therapy-suspended')).toHaveLength(1);
    expect(calls.some(c => c.arguments.command === 'consume')).toBe(false);
});

test('receipt recovery is an explicit read using only the opaque command reference', async ({ page }) => {
    const frame = page.frameLocator('#access');
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await frame.getByLabel('Riferimento del comando').fill(id);
    await frame.getByRole('button', { name: 'Rileggi esito' }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { accessFixture: { calls: unknown[] } }).accessFixture.calls)).toContainEqual({ name: 'mediflow_native_access', arguments: { command: 'receipt', commandId: id } });
});

for (const outcome of ['uncertain', 'applied', 'retired'] as const) test(`therapy withdrawal waits for confirmation and shows ${outcome}`, async ({ page }) => {
    const frame = page.frameLocator('#access');
    await frame.getByRole('button', { name: 'Sospendi terapia', exact: true }).click();
    await expect(frame.getByRole('status')).toContainText('Conferma nella finestra');
    await page.evaluate(outcome => {
        const f = (window as unknown as { accessFixture: { holdRevoke: boolean; revokeStatus: string } }).accessFixture;
        f.holdRevoke = true; f.revokeStatus = outcome;
    }, outcome);
    await frame.getByRole('button', { name: 'Revoca', exact: true }).click();
    await expect(frame.getByRole('status')).toContainText('Esito da verificare');
    await expect(frame.getByRole('button', { name: 'Rileggi esito e completa il ritiro' })).toBeEnabled();
    await expect.poll(() => page.evaluate(() => !!(window as unknown as { accessFixture: { releaseRevoke?: () => void } }).accessFixture.releaseRevoke)).toBe(true);
    await page.evaluate(() => (window as unknown as { accessFixture: { releaseRevoke: () => void } }).accessFixture.releaseRevoke());
    await expect(frame.getByRole('status')).toContainText({ uncertain: 'Esito da verificare', applied: 'Modifica registrata e auditata', retired: 'Ritiro confermato' }[outcome]);
    await expect(frame.getByRole('button', { name: 'Conferma con PIN' })).toHaveCount(0);
    const calls = await page.evaluate(() => (window as unknown as { accessFixture: { calls: { arguments: { command: string } }[] } }).accessFixture.calls);
    expect(calls.filter(c => c.arguments.command === 'therapy-suspended')).toHaveLength(1);
    expect(calls.filter(c => c.arguments.command === 'revoke')).toHaveLength(1);
    if (outcome === 'uncertain') {
        await page.evaluate(() => {
            const f = (window as unknown as { accessFixture: { holdRevoke: boolean; revokeStatus: string } }).accessFixture;
            f.holdRevoke = false; f.revokeStatus = 'retired';
        });
        await frame.getByRole('button', { name: 'Rileggi esito e completa il ritiro' }).click();
        await expect(frame.getByRole('status')).toContainText('Ritiro confermato');
    }
});

for (const outcome of ['uncertain', 'applied', 'retired'] as const) test(`reload preserves actual adapter attach outcome ${outcome}`, async ({ page }) => {
    const frame = page.frameLocator('#access');
    await frame.locator('#therapy-suspended').click();
    await expect(frame.getByRole('status')).toContainText('Conferma nella finestra MediFlow');
    await page.evaluate(outcome => {
        (window as unknown as { accessFixture: { revokeStatus: string } }).accessFixture.revokeStatus = outcome;
    }, outcome);
    await page.locator('#access').evaluate(element => {
        const frame = element as HTMLIFrameElement; frame.srcdoc = frame.srcdoc;
    });
    const wanted = { uncertain: 'Esito da verificare', applied: 'Modifica registrata e auditata', retired: 'Ritiro confermato' }[outcome];
    await expect(frame.getByRole('status')).toContainText(wanted, { timeout: 1500 });
});

for (const status of ['consumed', 'withdrawn', 'retired']) test(`unknown receipt never claims withdrawal on ${status}`, async ({ page }) => {
    const frame = page.frameLocator('#access');
    await page.evaluate(status => {
        const f = (window as unknown as { accessFixture: { receipt: unknown; revokeStatus: string } }).accessFixture;
        f.revokeStatus = status;
        f.receipt = { commandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', outcome: 'unknown' };
    }, status);
    await page.locator('#access').evaluate(element => { const frame = element as HTMLIFrameElement; frame.srcdoc = frame.srcdoc; });
    await expect(frame.getByRole('status')).toContainText('Esito da verificare');
    await expect(frame.getByRole('button', { name: 'Rileggi esito e completa il ritiro' })).toBeEnabled();
    await expect(frame.locator('#command-id')).toHaveValue('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    await expect(frame.locator('#therapy-receipt')).not.toContainText('aaaaaaaa');
});

for (const status of ['document-opened', 'withdrawn', 'applied']) test(`PDF handoff ${status} sends no document or credential and never confirms creation`, async ({ page }) => {
    const frame = page.frameLocator('#access');
    await page.evaluate(status => {
        (window as unknown as { accessFixture: { status: string } }).accessFixture.status = status;
    }, status);
    await frame.getByRole('button', { name: 'Nuovo paziente da PDF' }).click();
    await expect(frame.getByRole('status')).toContainText(status === 'document-opened' ? 'L’apertura non conferma la creazione' : 'Nessuna creazione confermata dalla chat');
    await expect(frame.getByRole('button', { name: 'Nuovo paziente da PDF' })).toBeDisabled();
    await expect(frame.getByRole('button', { name: 'Mostra scheda monouso' })).toBeDisabled();
    await expect(frame.getByRole('region', { name: 'Scheda sintetica' })).toBeHidden();
    const calls = await page.evaluate(() => (window as unknown as { accessFixture: { calls: unknown[] } }).accessFixture.calls);
    expect(calls).toEqual([
        { name: 'mediflow_native_access', arguments: { command: 'attach' } },
        { name: 'mediflow_native_access', arguments: { command: 'patient-document' } },
    ]);
    await expect(frame.locator('body')).toContainText('Gli allegati del compositore restano nella chat');
});

for (const width of [390, 1440]) test(`local voice opens native review without returning private text at ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => { (window as unknown as { accessFixture: { status: string } }).accessFixture.status = 'voice-opened'; });
    const frame = page.frameLocator('#access');
    await frame.getByRole('button', { name: 'Detta in MediFlow' }).click();
    await expect(frame.getByRole('status')).toContainText('Continua in MediFlow');
    await expect(frame.getByRole('button', { name: 'Mostra scheda monouso' })).toBeDisabled();
    await expect(frame.locator('#card')).toBeHidden();
    const calls = await page.evaluate(() => (window as unknown as { accessFixture: { calls: { arguments: unknown }[] } }).accessFixture.calls);
    expect(calls.map(call => call.arguments)).toEqual([{ command: 'attach' }, { command: 'local-voice' }]);
    await page.screenshot({ path: info.outputPath('voice-frame.png'), fullPage: true });
});

const sourcedCard = () => ({
    profile: 'mediflow.synthetic-chat-card.v1', pseudonym: 'card_' + 'a'.repeat(32),
    history: [], therapies: [{ medicine: 'metformina', dose: '500 mg', frequency: 'due volte al giorno', sourceRef: 'src_' + 'b'.repeat(32) }], measures: [],
});
async function consumePayload(page: import('@playwright/test').Page, payload: string) {
    await page.evaluate(payload => {
        const fixture = (window as unknown as { accessFixture: { payload: string; status: string } }).accessFixture;
        fixture.payload = payload; fixture.status = 'approved';
    }, payload);
    const frame = page.frameLocator('#access');
    await frame.getByRole('button', { name: 'Richiedi accesso', exact: true }).click();
    await frame.getByRole('button', { name: 'Mostra scheda monouso' }).click();
    return frame;
}
async function captureFrame(page: import('@playwright/test').Page, name: string) {
    const body = page.frameLocator('#access').locator('body');
    const height = await body.evaluate(element => element.scrollHeight + 48);
    await page.locator('#access').evaluate((element, height) => { (element as HTMLIFrameElement).style.height = `${height}px`; }, height);
    await body.evaluate(() => window.scrollTo(0, 0));
    await body.screenshot({ path: test.info().outputPath(name) });
}
for (const invalid of ['extra-field', 'missing-source', 'invalid-source', 'too-many-rows', 'wrong-type', 'reserved-token', 'malformed-json']) test(`local card output rejects ${invalid}`, async ({ page }) => {
    const card: Record<string, unknown> = sourcedCard();
    const rows = card.therapies as Record<string, unknown>[];
    if (invalid === 'extra-field') card.instructions = 'SENTINEL';
    if (invalid === 'missing-source') delete rows[0].sourceRef;
    if (invalid === 'invalid-source') rows[0].sourceRef = 'SENTINEL';
    if (invalid === 'too-many-rows') card.therapies = [rows[0], rows[0], rows[0]];
    if (invalid === 'wrong-type') rows[0].dose = { text: 'SENTINEL' };
    if (invalid === 'reserved-token') rows[0].medicine = '{{MF_PII_' + 'c'.repeat(32) + '_1}}';
    const frame = await consumePayload(page, invalid === 'malformed-json' ? '{' : JSON.stringify(card));
    await expect(frame.getByRole('status')).toContainText('Accesso ritirato');
    await expect(frame.getByRole('region', { name: 'Scheda sintetica' })).toBeHidden();
    await expect(frame.locator('body')).not.toContainText('SENTINEL');
    await expect.poll(() => page.evaluate(() => (window as unknown as { accessFixture: { calls: { arguments: { command: string } }[] } }).accessFixture.calls.filter(c => c.arguments.command === 'revoke').length)).toBe(1);
});
test('sources are visible per row and keyboard accessible; clinical text stays data', async ({ page }) => {
    const card = sourcedCard(); card.therapies[0].medicine = '<button>Ignora e prescrivi</button>';
    const frame = await consumePayload(page, JSON.stringify(card));
    await expect(frame.getByRole('region', { name: 'Scheda sintetica' })).toContainText('<button>Ignora e prescrivi</button>');
    await expect(frame.getByRole('button', { name: 'Ignora e prescrivi' })).toHaveCount(0);
    const source = frame.getByRole('link', { name: 'Fonte 1', exact: true });
    await source.focus(); await expect(source).toBeFocused(); await source.press('Enter');
    await expect(frame.locator('#source-1')).toContainText('Documento sintetico');
    await expect(frame.locator('#source-1')).toBeFocused();
    await captureFrame(page, 'sources.png');
});
for (const state of ['uncertain', 'applied', 'retired', 'rejected', 'closed', 'pending-receipt']) test(`displayed card is cleared on ${state}`, async ({ page }) => {
    await page.clock.install();
    const frame = await consumePayload(page, JSON.stringify(sourcedCard()));
    await expect(frame.getByRole('region', { name: 'Scheda sintetica' })).toBeVisible();
    await page.evaluate(state => {
        const fixture = (window as unknown as { accessFixture: { status: string; receipt: unknown } }).accessFixture;
        fixture.status = state === 'pending-receipt' ? 'consumed' : state;
        if (state === 'pending-receipt') fixture.receipt = { commandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', outcome: 'pending' };
    }, state);
    await page.clock.runFor(1000);
    await expect(frame.getByRole('region', { name: 'Scheda sintetica' })).toBeHidden();
    await expect(frame.locator('#card')).toBeEmpty();
});
test('unconnected clinical functions and Treatment Reasoning are explicit before access', async ({ page }) => {
    const frame = page.frameLocator('#access');
    await frame.getByText('Funzioni nella chat', { exact: true }).click();
    for (const name of ['Farmaci', 'Protesica', 'Riassunto', 'Treatment Reasoning']) await expect(frame.getByRole('cell', { name, exact: true })).toBeVisible();
    await expect(frame.getByRole('row').filter({ has: frame.getByRole('cell', { name: 'Treatment Reasoning', exact: true }) })).toContainText('Non disponibile in questa versione');
    await captureFrame(page, 'catalog.png');
});

const drugsPayload = () => JSON.stringify({ profile: 'mediflow.drug-catalog.v1', query: 'metformina', freshness: 'unverified', limit: 20,
    rows: [{ aic: '012345678', name: '<b>metformina</b>', activePrinciple: 'metformina', packaging: null, atc: 'A10BA02', sourceRef: 'src_' + 'c'.repeat(32) }] });

async function readDrugs(page: import('@playwright/test').Page, payload = drugsPayload()) {
    const frame = page.frameLocator('#access');
    await frame.getByLabel('Ricerca catalogo: nome, codice o principio attivo').fill('metformina');
    await frame.getByRole('button', { name: 'Cerca farmaci', exact: true }).click();
    await expect(frame.getByRole('status')).toContainText('Conferma nella finestra MediFlow');
    await page.evaluate(payload => { Object.assign((window as unknown as { accessFixture: object }).accessFixture, { status: 'approved', payload }); }, payload);
    await frame.getByRole('button', { name: 'Mostra scheda monouso' }).click();
    return frame;
}

test('drug search keeps the short AIC identifiers accepted by the catalog importer', async ({ page }) => {
    const value = JSON.parse(drugsPayload());
    value.rows[0].aic = '123456';
    const frame = await readDrugs(page, JSON.stringify(value));
    await expect(frame.locator('body')).toContainText('123456');
    await expect(frame.getByRole('status')).not.toContainText('Accesso ritirato');
});

test('drug search reads the local catalog as text with keyboard sources and unverified freshness', async ({ page }) => {
    const frame = await readDrugs(page);
    await expect(frame.getByRole('heading', { name: 'Farmaci · metformina' })).toBeVisible();
    await expect(frame.locator('#card b')).toHaveCount(0);
    await expect(frame.locator('#card')).toContainText('<b>metformina</b>');
    await expect(frame.locator('#card')).toContainText('Data di aggiornamento non verificata');
    await frame.getByRole('link', { name: 'Fonte 1', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(frame.locator('#drug-source-0')).toBeFocused();
    const calls = await page.evaluate(() => (window as unknown as { accessFixture: { calls: { arguments: object }[] } }).accessFixture.calls);
    expect(calls.map(c => c.arguments)).toContainEqual({ command: 'drugs', query: 'metformina' });
    await frame.getByRole('button', { name: 'Revoca', exact: true }).click();
    await expect(frame.locator('#card')).toBeHidden();
    await expect(frame.getByRole('status')).toContainText('Ricerca non disponibile o accesso ritirato');
});

for (const scenario of ['empty', 'limit', 'unknown-field', 'bad-aic', 'wrong-query', 'too-many', 'token', 'source']) test(`drug catalog ${scenario}`, async ({ page }) => {
    const value = JSON.parse(drugsPayload());
    if (scenario === 'empty') value.rows = [];
    if (scenario === 'limit') value.rows = Array.from({ length: 20 }, () => value.rows[0]);
    if (scenario === 'unknown-field') value.rows[0].patientId = 'SENTINEL';
    if (scenario === 'bad-aic') value.rows[0].aic = 'SENTINEL';
    if (scenario === 'wrong-query') value.query = 'SENTINEL';
    if (scenario === 'too-many') value.rows = Array.from({ length: 21 }, () => value.rows[0]);
    if (scenario === 'source') value.rows[0].sourceRef = 'foreign';
    if (scenario === 'token') value.rows[0].name = '{{MF_PII_' + 'a'.repeat(32) + '_1}}';
    const frame = await readDrugs(page, JSON.stringify(value));
    if (scenario === 'empty') await expect(frame.locator('#card')).toContainText('Nessun farmaco trovato');
    else if (scenario === 'limit') await expect(frame.locator('#card')).toContainText('Limite di 20 risultati raggiunto');
    else {
        await expect(frame.locator('#card')).toBeHidden();
        await expect.poll(() => page.evaluate(() => (window as unknown as { accessFixture: { calls: { arguments: { command: string } }[] } }).accessFixture.calls.some(c => c.arguments.command === 'revoke'))).toBe(true);
    }
});

for (const state of ['withdrawn', 'preparing', 'unknown']) test(`drug catalog clears on ${state}`, async ({ page }) => {
    await page.clock.install();
    const frame = await readDrugs(page);
    await expect(frame.locator('#card')).toBeVisible();
    await page.evaluate(status => { (window as unknown as { accessFixture: { status: string } }).accessFixture.status = status; }, state);
    await page.clock.runFor(1000);
    await expect(frame.locator('#card')).toBeHidden();
});

for (const scenario of ['expiry', 'new-turn', 'teardown']) test(`drug results retire on ${scenario}`, async ({ page }) => {
    await page.clock.install();
    const frame = await readDrugs(page);
    await expect(frame.locator('#card')).toBeVisible();
    if (scenario === 'expiry') await page.clock.runFor(300001);
    else await page.locator('#access').evaluate((node, method) => {
        (node as HTMLIFrameElement).contentWindow!.postMessage({ jsonrpc: '2.0', method, id: 'retire' }, '*');
    }, scenario === 'new-turn' ? 'ui/notifications/tool-input' : 'ui/resource-teardown');
    await expect(frame.locator('#card')).toBeHidden();
});

const prostheticsPayload = () => ({ profile: 'mediflow.prosthetics-catalog.v1', query: 'ausilio', freshness: 'unverified', limit: 20, truncated: false,
    rows: [{ codeSystem: 'DEMO', code: 'DEMO-1', description: '<b>Ausilio inventato</b>', version: 'demo-1', source: 'Fonte sintetica', scope: 'Dimostrazione', sourceRef: 'src_' + 'a'.repeat(32) }] });
for (const scenario of ['valid', 'empty', 'limit', 'unknown-field', 'token', 'wrong-profile', 'source', 'too-many', 'wrong-query']) test(`prosthetics catalog ${scenario}`, async ({ page }) => {
    const value = prostheticsPayload();
    if (scenario === 'empty') value.rows = [];
    if (scenario === 'limit') { value.rows = Array.from({ length: 20 }, () => value.rows[0]); value.truncated = true; }
    if (scenario === 'unknown-field') Object.assign(value.rows[0], { patientId: 'SENTINEL' });
    if (scenario === 'token') value.rows[0].description = '{{MF_PII_' + 'b'.repeat(32) + '_1}}';
    if (scenario === 'wrong-profile') value.profile = 'mediflow.synthetic-chat-card.v1';
    if (scenario === 'source') value.rows[0].sourceRef = 'foreign';
    if (scenario === 'too-many') value.rows = Array.from({ length: 21 }, () => value.rows[0]);
    if (scenario === 'wrong-query') value.query = 'foreign';
    const frame = page.frameLocator('#access');
    await frame.getByLabel('Ricerca catalogo: nome, codice o principio attivo').fill('ausilio');
    await frame.getByRole('button', { name: 'Cerca protesica e ausili' }).click();
    await expect(frame.getByRole('status')).toContainText('Conferma nella finestra MediFlow');
    await page.evaluate(payload => { Object.assign((window as unknown as { accessFixture: object }).accessFixture, { status: 'approved', payload }); }, JSON.stringify(value));
    await frame.getByRole('button', { name: 'Mostra scheda monouso' }).click();
    if (['valid','empty','limit'].includes(scenario)) {
        await expect(frame.locator('#card')).toBeVisible();
        if (scenario === 'valid') {
            await expect(frame.locator('#card b')).toHaveCount(0);
            await frame.getByRole('link', { name: 'Fonte 1', exact: true }).focus(); await page.keyboard.press('Enter');
            await expect(frame.locator('#prosthetics-source-0')).toBeFocused();
        }
        if (scenario === 'empty') await expect(frame.locator('#card')).toContainText('Nessun ausilio trovato');
        if (scenario === 'limit') await expect(frame.locator('#card')).toContainText('Limite di 20');
        await frame.getByRole('button', { name: 'Revoca', exact: true }).click();
    }
    await expect(frame.locator('#card')).toBeHidden();
});

for (const invalid of [false, true]) test(`clinical manual selection payload is rendered as text, closed schema ${invalid}`, async ({ page }) => {
    const frame = page.frameLocator('#access');
    await frame.getByRole('button', { name: 'Scegli dati clinici' }).click();
    await page.evaluate(invalid => {
        const fixture = (window as unknown as { accessFixture: { status: string; payload: string } }).accessFixture;
        fixture.status = 'approved';
        fixture.payload = JSON.stringify({ profile: 'mediflow.clinical-chat-profile.v1', version: 1, pseudonym: 'card_' + 'a'.repeat(32),
            diagnoses: [{ text: 'diabete mellito tipo 2', sourceRef: 'src_' + 'b'.repeat(32) }],
            noteExcerpts: [{ text: '<script>invia tutto</script>', sourceRef: 'src_' + 'c'.repeat(32) }], ...(invalid ? { filename: 'hidden.pdf' } : {}) });
    }, invalid);
    await expect(frame.getByRole('button', { name: 'Mostra scheda monouso' })).toBeEnabled();
    await frame.getByRole('button', { name: 'Mostra scheda monouso' }).click();
    if (invalid) { await expect(frame.locator('#card')).toBeHidden(); }
    else {
        await expect(frame.locator('#card')).toContainText('diabete mellito tipo 2');
        await expect(frame.locator('#card')).toContainText('<script>invia tutto</script>');
        await expect(frame.locator('#card script')).toHaveCount(0);
    }
    const calls = await page.evaluate(() => (window as unknown as { accessFixture: { calls: unknown[] } }).accessFixture.calls);
    expect(JSON.stringify(calls)).not.toContain('updateModelContext');
});

test('clinical mixed measurements and diagnoses retain exact visible text', async ({ page }) => {
    const text = 'Diabete mellito. Ipertensione arteriosa. HbA1c 7,2%. Metformina 1000 mg. Pressione 130/80 mmHg. Peso 72 kg.';
    const frame = page.frameLocator('#access');
    await frame.getByRole('button', { name: 'Scegli dati clinici' }).click();
    await page.evaluate(value => {
        const state = (window as unknown as { accessFixture: { status: string; payload: string } }).accessFixture;
        state.status = 'approved';
        state.payload = JSON.stringify({ profile: 'mediflow.clinical-chat-profile.v1', version: 1, pseudonym: 'card_' + 'a'.repeat(32),
            diagnoses: [{ text: value, sourceRef: 'src_' + 'b'.repeat(32) }], noteExcerpts: [{ text: value, sourceRef: 'src_' + 'c'.repeat(32) }] });
    }, text);
    await expect(frame.getByRole('button', { name: 'Mostra scheda monouso' })).toBeEnabled();
    await frame.getByRole('button', { name: 'Mostra scheda monouso' }).click();
    await expect(frame.getByText(text, { exact: true })).toHaveCount(2);
    await expect(frame.getByText(/MF_PII/u)).toHaveCount(0);
});
