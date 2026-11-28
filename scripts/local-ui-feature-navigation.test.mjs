import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { chromium, expect } from '@playwright/test';
import { fetchInterceptedRequest } from '../e2e/fixtures/trusted-web-request.ts';
import { isolatedChromeLaunch } from '../e2e/fixtures/secure-browser.ts';
import { archiveBrowserPort } from './local-ui-runtime.mjs';
import { packageLocalUiPlugin } from './package-local-ui-plugin.mjs';

const success = { content: [{ type: 'text', text: 'continue_in_mediflow' }], structuredContent: { status: 'continue_in_mediflow' } };
const denial = { isError: true, content: [{ type: 'text', text: 'MediFlow navigation unavailable. Complete startup or pairing in MediFlow, then retry. This request is no longer pending.' }] };

function mcp(child) {
    let id = 0;
    const replies = new Map();
    createInterface({ input: child.stdout }).on('line', line => {
        const reply = JSON.parse(line);
        replies.get(reply.id)?.(reply.result ?? reply.error);
    });
    const send = frame => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...frame }) + '\n');
    const request = async (method, params) => {
        const current = ++id;
        let timer;
        try {
            return await new Promise((resolve, reject) => {
                timer = setTimeout(reject, 15_000, new Error(`MCP timeout: ${method}`));
                replies.set(current, resolve);
                send({ id: current, method, params });
            });
        } finally {
            clearTimeout(timer);
            replies.delete(current);
        }
    };
    return { request, send, navigate: args => request('tools/call', {
        name: 'mediflow.local_ui.navigate.v1', arguments: args,
    }) };
}

function clinicalSnapshot(data) {
    const db = new Database(path.join(data, 'medical.db'), { readonly: true, fileMustExist: true });
    try {
        return db.transaction(() => Object.fromEntries([
            'patients', 'entries', 'entry_revisions', 'attachments', 'document_diagnosis_proposals',
            'therapies', 'observations', 'checkups', 'service_prescriptions', 'service_prescription_items',
            'prosthetic_prescriptions', 'patients_to_ambulatories',
        ].map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])))();
    } finally { db.close(); }
}

async function saveSetting(page, key, value) {
    const status = await page.evaluate(async ({ key, value }) => (await fetch('/api/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, value }),
    })).status, { key, value });
    assert.equal(status, 200);
}

async function createPatient(page, lastName, notes) {
    return page.evaluate(async ({ lastName, notes }) => {
        const response = await fetch('/api/patients', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ firstName: 'Paziente', lastName, notes, taxCode: `TST${crypto.randomUUID().replaceAll('-', '').slice(0, 13)}` }),
        });
        if (response.status !== 201) throw new Error(`Synthetic patient: ${response.status}`);
        return (await response.json()).id;
    }, { lastName, notes });
}

async function productionFixture(t, respond, seedProvider) {
    const root = fs.realpathSync(fs.mkdtempSync('/tmp/mf-navigation-'));
    const data = path.join(root, 'data'), home = path.join(root, 'home'), bin = path.join(root, 'bin');
    for (const directory of [data, home, bin]) fs.mkdirSync(directory, { mode: 0o700 });
    const opener = path.join(bin, process.platform === 'darwin' ? 'open' : 'xdg-open');
    fs.writeFileSync(opener, '#!/bin/sh\nprintf "%s\\n" "$1" >> "$0.urls"\n', { mode: 0o700 });
    fs.writeFileSync(path.join(bin, 'ollama'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });

    let browser;
    const children = [];
    const provider = http.createServer(respond);
    t.after(async () => {
        try {
            await browser?.close();
            for (const { child } of children.toReversed()) {
                if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
            }
            try {
                await expect.poll(() => children.every(({ child }) => child.exitCode !== null || child.signalCode !== null), { timeout: 15_000 }).toBe(true);
            } finally {
                for (const { child } of children) {
                    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
                }
            }
        } finally {
            provider.closeAllConnections();
            await new Promise(resolve => provider.close(resolve));
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
    await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
    const env = {
        HOME: home, XDG_CONFIG_HOME: path.join(home, 'config'), TMPDIR: root,
        DISPLAY: ':0', PATH: [bin, path.dirname(process.execPath), '/usr/bin', '/usr/sbin', '/bin', '/opt/homebrew/bin'].join(path.delimiter),
        MEDIFLOW_DATA_DIR: data, MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1', MEDIFLOW_NETWORK_DISABLED: '1',
        NEXT_TELEMETRY_DISABLED: '1',
    };
    const port = await archiveBrowserPort(data, { env, home });
    const baseURL = `http://127.0.0.1:${port}`;
    execFileSync(process.execPath, ['scripts/prepare-e2e-db.mjs'], { env: { ...env, E2E_PIN: '1234' } });
    seedProvider?.(env, data);
    const destination = path.join(root, 'plugin');
    packageLocalUiPlugin(destination, data);

    const run = (command, args, options) => {
        const child = spawn(command, args, { env: { ...env, ...options }, stdio: ['pipe', 'pipe', 'pipe'] });
        const record = { child, stderr: '' };
        child.stderr.on('data', chunk => { record.stderr += chunk; });
        children.push(record);
        return record;
    };
    const launcher = run(process.execPath, ['scripts/mediflow.mjs', '--scelta', 'web', '--senza-browser'], { PORT: String(port) });
    launcher.child.stdout.resume();
    await expect.poll(() => {
        assert.equal(launcher.child.exitCode, null, launcher.stderr);
        return launcher.stderr;
    }, { timeout: 45_000 }).toContain('Pronto:');

    browser = await chromium.launch({
        ...isolatedChromeLaunch(baseURL),
        channel: process.env.CI ? undefined : 'chrome',
    });
    const page = await browser.newPage({ baseURL });
    await page.goto('/');
    const pin = page.getByLabel('PIN operatore').first();
    const renew = page.getByRole('button', { name: 'Rinnova accesso', exact: true });
    await expect.poll(async () => {
        if (await pin.isEnabled({ timeout: 250 }).catch(() => false)) return true;
        if (await renew.isEnabled({ timeout: 250 }).catch(() => false)) await renew.click({ timeout: 1000 }).catch(() => {});
        return false;
    }, { timeout: 25_000 }).toBe(true);
    await pin.fill('1234');
    await page.getByRole('button', { name: 'Sblocca', exact: true }).click();
    await expect(pin).toBeHidden();

    const openFolder = async (patient, navigate = () => page.goto(`/patients/${patient}/modules`)) => {
        await Promise.all([
            page.waitForResponse(response => response.url().endsWith('/api/plugin-local-ui/events') && response.status() === 200),
            navigate(),
        ]);
        await expect(page).toHaveURL(new URL(`/patients/${patient}/modules`, baseURL).href);
        await expect.poll(() => page.evaluate(() => performance.getEntriesByType('resource')
            .some(entry => entry.name.includes('/api/patient-profile/selection-epoch')))).toBe(true);
        await expect(page.getByTestId('patient-profile-notes')).not.toContainText('Lettura delle note in corso…');
    };
    const confirmation = page.getByRole('button', { name: 'Apri sulla cartella aperta', exact: true });
    const pair = async () => {
        const plugin = run(path.join(destination, 'bin', 'mediflow-local-ui'), []).child;
        const client = mcp(plugin);
        const initialized = await client.request('initialize', { protocolVersion: '2025-03-26', capabilities: {},
            clientInfo: { name: 'synthetic-navigation', version: '1' } });
        assert.equal(initialized.serverInfo.name, 'mediflow-local-ui');
        client.send({ method: 'notifications/initialized' });
        const listed = await client.request('tools/list', {});
        assert.deepEqual(listed.tools.map(tool => tool.name), ['mediflow.local_ui.navigate.v1']);
        const pairing = client.navigate({ intent: 'search' });
        await expect(page.getByText('Consenti a Codex/Claude di aprire schermate qui?', { exact: true })).toBeVisible();
        const pairingUrl = fs.readFileSync(`${opener}.urls`, 'utf8').trim().split('\n').at(-1);
        assert.match(pairingUrl, /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/[a-f0-9-]{36}$/u);
        const codePage = await fetch(pairingUrl).then(response => response.text());
        const code = codePage.match(/<code[^>]*>([a-f0-9]{24})<\/code>/u)?.[1];
        assert.ok(code);
        await page.getByLabel('Codice di abbinamento', { exact: true }).fill(code);
        await page.getByRole('button', { name: 'Consenti', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Revoca il collegamento del plugin', exact: true })).toBeVisible();
        const firstReceipt = await pairing;
        if (firstReceipt.isError) assert.deepEqual(firstReceipt, denial);
        else {
            assert.deepEqual(firstReceipt, success);
            await expect(confirmation).toBeVisible();
            await page.getByTestId('plugin-local-ui-navigation').getByRole('button', { name: 'Annulla', exact: true }).click();
        }
        await expect(confirmation).toHaveCount(0);
        return { client, plugin };
    };
    return { data, page, provider, pair, openFolder, confirmation };
}

test('real packaged local-ui requests reveal the three Web functions after confirmation', {
    skip: process.env.MEDIFLOW_NAVIGATION_REAL !== '1' || process.platform === 'win32',
    timeout: 180_000,
}, async t => {
    const providerCalls = [];
    const { data, page, provider, pair, openFolder, confirmation } = await productionFixture(t, (request, response) => {
        providerCalls.push(`${request.method} ${request.url}`);
        response.writeHead(503).end();
    });
    await saveSetting(page, 'aiUrl', `http://127.0.0.1:${provider.address().port}`);
    for (const lane of ['PatientInsight', 'DocumentSynthesis', 'SmartImport']) await saveSetting(page, `ai${lane}KillSwitch`, 'disabled');
    const withSources = await createPatient(page, 'Sintetico A', 'Nota sintetica per la prova.');
    const noSources = await createPatient(page, 'Sintetico B');
    await openFolder(withSources);
    await page.evaluate(() => { window.location.hash = 'documenti'; });
    await expect(page.locator('#documenti [data-document-area="list"]')).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByRole('button', { name: 'Carica documenti', exact: true })).toBeVisible();
    await page.locator('#documenti input[type="file"]').setInputFiles({ name: 'Fonte sintetica.txt',
        mimeType: 'text/plain', buffer: Buffer.from('Testo sintetico per la verifica di navigazione.') });
    await expect(page.getByRole('status').filter({ hasText: '1 allegato salvato' })).toBeVisible();

    const { client } = await pair();

    const generationRequests = [];
    page.on('request', request => {
        if (request.method() === 'POST' && /^\/api\/(?:ai\/|proxy\/ollama\/)/u.test(new URL(request.url()).pathname)) generationRequests.push(new URL(request.url()).pathname);
    });
    const before = clinicalSnapshot(data);
    const pending = async (intent, label, patient = 'Sintetico A') => {
        const beforeUrl = page.url();
        assert.deepEqual(await client.navigate({ intent }), success);
        await expect(page.getByTestId('plugin-local-ui-navigation')).toContainText(label);
        await expect(page.getByTestId('plugin-local-ui-navigation')).toContainText(patient);
        await expect(confirmation).toBeVisible();
        assert.equal(page.url(), beforeUrl);
    };
    const reveal = async (intent, label, anchor, locator, patient, state = 'disponibilita-iniziale') => {
        await pending(intent, label, patient);
        await confirmation.click();
        await expect(page).toHaveURL(new RegExp(`#${anchor}$`));
        await expect(locator).toBeVisible();
        await expect(confirmation).toHaveCount(0);
        if (process.env.MEDIFLOW_NAVIGATION_EVIDENCE) {
            await page.screenshot({ path: path.join(process.env.MEDIFLOW_NAVIGATION_EVIDENCE, `${intent}-${patient ?? 'A'}-${state}.png`) });
        }
    };

    assert.deepEqual(await client.navigate({ intent: 'document_synthesis', source: 'SYNTHETIC_EXTRA' }), denial);
    await expect(confirmation).toHaveCount(0);
    await reveal('patient_insight', 'Quadro paziente', 'patient-insight', page.getByTestId('patient-insight-disabled-card'));
    await reveal('document_synthesis', 'Sintesi dei documenti', 'document-synthesis', page.getByTestId('document-upload-synthesis-disabled-note'));
    await expect(page.getByLabel('Documento da sintetizzare')).toHaveValue('');
    await reveal('smart_import', 'Smart Import', 'smart-import', page.locator('#smart-import').getByRole('button', { name: 'Prepara proposta' }));
    await expect(page.locator('#smart-import').getByRole('button', { name: 'Prepara proposta' })).toBeDisabled();

    for (const lane of ['PatientInsight', 'DocumentSynthesis', 'SmartImport']) await saveSetting(page, `ai${lane}KillSwitch`, 'enabled');
    await openFolder(withSources);
    const insightAction = page.locator('#patient-insight').getByRole('button', { name: 'Genera proposta', exact: true });
    await reveal('patient_insight', 'Quadro paziente', 'patient-insight', insightAction, undefined, 'attiva');
    const source = page.getByLabel('Documento da sintetizzare');
    await reveal('document_synthesis', 'Sintesi dei documenti', 'document-synthesis', source, undefined, 'attiva');
    await expect(source).toHaveValue('');
    await source.selectOption({ label: 'Fonte sintetica.txt' });
    await expect(page.locator('#document-synthesis').getByRole('button', { name: 'Genera proposta', exact: true })).toBeVisible();
    const importAction = page.locator('#smart-import').getByRole('button', { name: 'Prepara proposta' });
    await reveal('smart_import', 'Smart Import', 'smart-import', importAction, undefined, 'attiva');
    await expect(importAction).toBeEnabled();

    await reveal('identity', 'Anagrafica', 'identita', page.locator('#identita'));
    await reveal('history', 'Storia clinica e fonti', 'timeline', page.locator('#timeline'));
    await reveal('prescribing', 'Guida alla prescrizione', 'plugin-prescribing', page.getByRole('navigation', { name: 'Tipo di prescrizione' }));

    await pending('patient_insight', 'Quadro paziente');
    await openFolder(noSources);
    await expect(confirmation).toHaveCount(0);
    assert.equal(new URL(page.url()).hash, '');
    await reveal('document_synthesis', 'Sintesi dei documenti', 'document-synthesis',
        page.getByText('Carica un documento per preparare una sintesi.', { exact: true }), 'Sintetico B');
    await reveal('smart_import', 'Smart Import', 'smart-import',
        page.getByText('Aggiungi fonti cliniche alla cartella per preparare una proposta.', { exact: true }), 'Sintetico B');

    await pending('document_synthesis', 'Sintesi dei documenti', 'Sintetico B');
    await expect(confirmation).toHaveCount(0, { timeout: 18_000 });
    assert.equal(new URL(page.url()).hash, '#smart-import');
    await pending('search', 'Ricerca locale', 'Sintetico B');
    await confirmation.click();
    await expect(page).toHaveURL(/\/\?area=incarico$/u);
    await page.getByRole('searchbox', { name: 'Cerca nella lista pazienti' }).fill('Sintetico B');
    await page.getByRole('option').filter({ hasText: 'Sintetico B' }).click();
    const openSelected = page.getByRole('link', { name: 'Apri scheda paziente', exact: true });
    await expect(openSelected).toHaveAttribute('href', `/patients/${noSources}/modules`);
    await openFolder(noSources, () => openSelected.click());

    await pending('smart_import', 'Smart Import', 'Sintetico B');
    await page.getByRole('button', { name: 'Blocca', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sblocca MediFlow', exact: true })).toBeVisible();
    await expect(confirmation).toHaveCount(0);
    assert.equal(new URL(page.url()).hash, '');
    assert.deepEqual(generationRequests, []);
    assert.deepEqual(providerCalls, []);
    assert.deepEqual(clinicalSnapshot(data), before);
});

const model = 'synthetic-c7:latest';
const marker = 'Risultato sintetico verificabile';
const sourceText = 'Documento sintetico di verifica. Controllo periodico da concordare.';

function seedProviderLifecycle(env, data) {
    execFileSync(process.execPath, ['--import', './scripts/register-strip-types-loader.mjs', '--input-type=module', '-e', `
        import { createHostProviderLifecycleService } from './lib/ai-providers/fabric/provider-lifecycle-service.ts';
        import { startOnboarding, advanceOnboarding } from './lib/ai-providers/fabric/onboarding.ts';
        let onboarding = startOnboarding('ollama', 'local_model');
        for (const type of ['configure', 'credential_declared', 'attest_local', 'enable']) {
            onboarding = advanceOnboarding(onboarding, { type });
        }
        createHostProviderLifecycleService({ appDataDir: process.argv[1], provider: 'ollama' })
            .control.admit({ expectedVersion: 0, onboarding });
    `, data], { env });
}

function providerAnswer(intent, messages) {
    if (intent === 'document_synthesis') {
        const lines = messages.flatMap(message => message.content.split('\n'));
        const example = lines.find(line => line.startsWith('Output shape example only;'));
        const output = JSON.parse(example.slice(example.indexOf('{'), example.indexOf('. None of these fields')));
        const quote = JSON.parse(lines.find(line => line.startsWith('SOURCE S1 UTF8_BYTES')).split(' JSON_TEXT ')[1]).trim();
        assert.ok(quote.includes('Documento sintetico di verifica'));
        return { schemaVersion: 'mediflow.document-synthesis.provider-envelope.v2',
            output: { ...output, summary: marker }, citations: [{ label: 'S1', quote }],
            claims: [{ claimPath: 'summary', labels: ['S1'] }, { claimPath: 'data.qualityLevel', labels: ['S1'] }] };
    }
    const insight = intent === 'patient_insight';
    const data = insight ? { currentState: [`${marker} [S1]`], alerts: [], nextSteps: [], gaps: [] }
        : { diagnoses: [], therapies: [], servicePrescriptions: [] };
    return { schemaVersion: 'mediflow.ai.extract.v1', task: intent, summary: `${marker}${insight ? ' [S1]' : ''}`, data };
}

function slowProvider(intent, events) {
    const catalog = { models: [{ name: model, model, size: 1024, digest: 'sha256:synthetic' }] };
    const replies = { '/api/version': { version: '0.40.18' }, '/api/tags': catalog, '/api/ps': catalog,
        '/api/show': { details: { format: 'gguf' } }, '/api/generate': { model } };
    let held;
    let failure;
    let dispatches = 0;
    return {
        async respond(request, response) {
            const send = value => {
                response.writeHead(200, { 'Content-Type': 'application/json' });
                response.end(JSON.stringify(value));
            };
            if (Object.hasOwn(replies, request.url)) return send(replies[request.url]);
            if (request.url !== '/api/chat') return response.writeHead(404).end();
            try {
                dispatches++;
                let input = '';
                for await (const chunk of request) input += chunk;
                const parsed = JSON.parse(input);
                assert.equal(parsed.model, model);
                const answer = providerAnswer(intent, parsed.messages);
                assert.equal(held, undefined);
                const call = { released: false, disconnected: false, finished: false, send: () => {
                    if (!response.destroyed) send({ model, message: { content: JSON.stringify(answer) } });
                } };
                held = call;
                response.on('finish', () => { call.finished = true; events.push('provider-finished'); });
                response.on('close', () => {
                    call.disconnected = !response.writableFinished;
                    events.push(call.disconnected ? 'provider-aborted' : 'provider-closed');
                });
                events.push('provider-dispatched');
            } catch (error) {
                failure = error.message;
                response.writeHead(500).end();
            }
        },
        dispatches: () => dispatches,
        async pending() {
            await expect.poll(() => held !== undefined || failure !== undefined, { timeout: 15_000 }).toBe(true);
            assert.ok(held, failure);
            return held;
        },
        release() {
            if (!held || held.released) return;
            held.released = true;
            events.push('provider-released');
            held.send();
        },
        next() {
            assert.ok(held?.finished || held?.disconnected);
            held = undefined;
        },
    };
}

const functionCases = {
    patient_insight: { anchor: 'patient-insight', result: 'patient-insight-review-proposal', start: 'Genera proposta', stop: 'Interrompi' },
    document_synthesis: { anchor: 'document-synthesis', result: 'document-synthesis-fabric-result', start: 'Genera proposta', stop: 'Annulla' },
    smart_import: { anchor: 'smart-import', result: 'smart-import-review-proposal', start: 'Prepara proposta', stop: 'Annulla' },
};

for (const [intent, feature] of Object.entries(functionCases)) {
    const gestures = ['web', 'revoke', 'close', 'ordinary', 'delivered'];
    if (intent !== 'patient_insight') gestures.push('preparation');
    if (intent === 'patient_insight') gestures.push('change-patient', 'response-before-delivery');
    if (intent === 'smart_import') gestures.push('lock');
    for (const gesture of gestures) {
        test(`real packaged generation: ${intent} / ${gesture}`, {
            skip: process.env.MEDIFLOW_NAVIGATION_REAL !== '1' || process.platform === 'win32',
            timeout: 95_000,
        }, async t => {
            const events = [];
            const slow = slowProvider(intent, events);
            const { data, page, provider, pair, openFolder, confirmation } = await productionFixture(t, slow.respond, seedProviderLifecycle);
            const name = `${intent}-${gesture}`;
            t.after(() => {
                const directory = process.env.MEDIFLOW_NAVIGATION_EVIDENCE;
                if (directory) fs.writeFileSync(path.join(directory, `${name}.json`), JSON.stringify({ name, events }, null, 2) + '\n');
                t.diagnostic(JSON.stringify({ name, events }));
            });
            await saveSetting(page, 'aiProvider', 'ollama');
            await saveSetting(page, 'aiUrl', `http://127.0.0.1:${provider.address().port}`);
            await saveSetting(page, 'aiModel_clinical', model);
            await saveSetting(page, 'aiModel_reasoning', model);
            for (const lane of ['PatientInsight', 'DocumentSynthesis', 'SmartImport']) {
                await saveSetting(page, `ai${lane}KillSwitch`, 'enabled');
            }
            const patient = await createPatient(page, 'Sintetico A', sourceText);
            const alternative = gesture === 'change-patient' ? await createPatient(page, 'Sintetico B') : null;
            await openFolder(patient);
            if (intent === 'document_synthesis') {
                await page.evaluate(() => { window.location.hash = 'documenti'; });
                await expect(page.locator('#documenti [data-document-area="list"]')).toHaveAttribute('aria-busy', 'false');
                await expect(page.getByRole('button', { name: 'Carica documenti', exact: true })).toBeVisible();
                const pdf = await PDFDocument.create();
                pdf.addPage().drawText(sourceText, { x: 42, y: 740, size: 13, font: await pdf.embedFont(StandardFonts.Helvetica) });
                await page.locator('#documenti input[type="file"]').setInputFiles({ name: 'Fonte sintetica.pdf',
                    mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
                await expect(page.getByRole('status').filter({ hasText: '1 allegato salvato' })).toBeVisible();
            }
            const { client, plugin } = await pair();
            const before = clinicalSnapshot(data);
            const assertArchive = () => assert.deepEqual(clinicalSnapshot(data), before);
            const revoke = page.getByRole('button', { name: 'Revoca il collegamento del plugin', exact: true });
            const previewPath = `/api/ai/${feature.anchor}/preview`;
            page.on('requestfailed', request => {
                if (new URL(request.url()).pathname === previewPath) events.push(request.failure()?.errorText);
            });
            if (gesture === 'ordinary') {
                await page.evaluate(anchor => { window.location.hash = anchor; }, feature.anchor);
            } else {
                assert.deepEqual(await client.navigate({ intent }), success);
                events.push(success.structuredContent.status);
                await expect(confirmation).toBeVisible();
                assert.equal(slow.dispatches(), 0);
                await confirmation.click();
            }
            await expect(page).toHaveURL(new RegExp(`#${feature.anchor}$`));
            events.push('open-confirmed');
            assertArchive();
            let panel = page.locator(`#${feature.anchor}`);
            if (intent === 'document_synthesis') {
                await page.getByLabel('Documento da sintetizzare').selectOption({ label: 'Fonte sintetica.pdf' });
                panel = page.getByTestId(/^document-synthesis-fabric-review-/u);
            }
            const start = panel.getByRole('button', { name: feature.start, exact: true });
            const result = page.getByTestId(feature.result);
            const heldBrowserResponse = Promise.withResolvers();
            const deliverBrowserResponse = Promise.withResolvers();
            if (gesture === 'response-before-delivery') {
                await page.route(`**${previewPath}`, async route => {
                    const response = await fetchInterceptedRequest(route);
                    heldBrowserResponse.resolve(response);
                    await deliverBrowserResponse.promise;
                    await route.fulfill({ response }).catch(() => {});
                });
                t.after(() => { deliverBrowserResponse.resolve(); });
            }
            await start.click();
            if (intent !== 'patient_insight') {
                const ambulatory = panel.getByLabel('Ambulatorio per questa proposta');
                await expect(ambulatory).toBeVisible();
                assert.equal(slow.dispatches(), 0);
                if (gesture === 'preparation') {
                    await revoke.click();
                    await expect(ambulatory).toHaveCount(0);
                    await expect(start).toBeVisible();
                    events.push('preparation-withdrawn');
                    assert.equal(slow.dispatches(), 0);
                    assertArchive();
                    return;
                }
                await ambulatory.selectOption({ index: 1 });
                await panel.getByRole('checkbox').check();
                await panel.getByRole('button', { name: 'Conferma e genera proposta', exact: true }).click();
            }
            events.push('generation-started');
            const held = await slow.pending().catch(async error => {
                t.diagnostic(await panel.innerText());
                throw error;
            });
            assertArchive();
            if (gesture === 'response-before-delivery') {
                slow.release();
                try {
                    const waiting = await heldBrowserResponse.promise;
                    const wire = await waiting.json();
                    assert.equal(waiting.status(), 200);
                    assert.equal(wire.preview.status, 'available');
                    assert.match(wire.preview.proposal.summary, new RegExp(marker));
                    events.push('accepted-response-held-before-delivery');
                    await expect(result).toHaveCount(0);
                    await revoke.click();
                    await expect(start).toBeVisible();
                    events.push('revoke');
                } finally {
                    deliverBrowserResponse.resolve();
                    await page.unrouteAll({ behavior: 'wait' });
                }
                await expect(result).toHaveCount(0);
                slow.next();
                await start.click();
                await slow.pending();
                slow.release();
                await expect(result).toContainText(marker);
                assert.equal(slow.dispatches(), 2);
                assertArchive();
                events.push('independent-proposal-visible', 'archive-unchanged');
                return;
            }
            const delivers = gesture === 'ordinary' || gesture === 'delivered';
            const response = delivers ? page.waitForResponse(value => new URL(value.url()).pathname === previewPath) : null;
            if (gesture === 'delivered') slow.release();
            if (gesture === 'delivered') await expect(result).toContainText(marker);
            if (['revoke', 'ordinary', 'delivered'].includes(gesture)) {
                await revoke.click();
                await expect(revoke).toHaveCount(0);
            }
            if (gesture === 'web') await panel.getByRole('button', { name: feature.stop, exact: true }).click();
            if (gesture === 'close') {
                const closed = once(plugin, 'exit');
                plugin.stdin.end();
                assert.deepEqual(await closed, [0, null]);
                await expect(revoke).toHaveCount(0);
            }
            if (alternative) await openFolder(alternative);
            if (gesture === 'lock') {
                await page.getByRole('button', { name: 'Blocca', exact: true }).click();
                await expect(page.getByRole('heading', { name: 'Sblocca MediFlow', exact: true })).toBeVisible();
            }
            events.push(gesture);
            if (delivers) {
                if (gesture === 'ordinary') slow.release();
                await expect(result).toContainText(marker);
                const wire = await (await response).json();
                const proposal = wire.preview ?? wire;
                const receipt = proposal.publication?.receipt ?? proposal;
                assert.equal(receipt.writesPerformed, 0);
                assert.ok(receipt.applyPolicy === 'none' || receipt.apply === 'denied');
                assert.equal(held.finished, true);
                events.push('proposal-visible');
            } else {
                try {
                    await expect.poll(() => held.disconnected, { timeout: 5_000 }).toBe(true);
                } finally {
                    slow.release();
                }
                await expect(result).toHaveCount(0);
                if (!alternative && gesture !== 'lock') await expect(start).toBeVisible();
                await delay(250);
                assert.equal(await result.count(), 0);
                assert.equal(held.finished, false);
                events.push('proposal-withdrawn');
            }
            assert.equal(slow.dispatches(), 1);
            assertArchive();
            events.push('archive-unchanged');
        });
    }
}
