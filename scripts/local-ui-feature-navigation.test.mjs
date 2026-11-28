import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { chromium, expect } from '@playwright/test';
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

test('real packaged local-ui requests reveal the three Web functions after confirmation', {
    skip: process.env.MEDIFLOW_NAVIGATION_REAL !== '1' || process.platform === 'win32',
    timeout: 180_000,
}, async t => {
    const root = fs.realpathSync(fs.mkdtempSync('/tmp/mf-navigation-'));
    const data = path.join(root, 'data'), home = path.join(root, 'home'), bin = path.join(root, 'bin');
    for (const directory of [data, home, bin]) fs.mkdirSync(directory, { mode: 0o700 });
    const opener = path.join(bin, process.platform === 'darwin' ? 'open' : 'xdg-open');
    fs.writeFileSync(opener, '#!/bin/sh\nprintf "%s\\n" "$1" >> "$0.urls"\n', { mode: 0o700 });
    fs.writeFileSync(path.join(bin, 'ollama'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });

    let browser;
    const children = [];
    const providerCalls = [];
    const provider = http.createServer((request, response) => {
        providerCalls.push(`${request.method} ${request.url}`);
        response.writeHead(503).end();
    });
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
        DISPLAY: ':0', PATH: [bin, path.dirname(process.execPath), '/usr/bin', '/usr/sbin', '/bin'].join(path.delimiter),
        MEDIFLOW_DATA_DIR: data, MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1', MEDIFLOW_NETWORK_DISABLED: '1',
        NEXT_TELEMETRY_DISABLED: '1',
    };
    const port = await archiveBrowserPort(data, { env, home });
    const baseURL = `http://127.0.0.1:${port}`;
    execFileSync(process.execPath, ['scripts/prepare-e2e-db.mjs'], { env: { ...env, E2E_PIN: '1234' } });
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

    await saveSetting(page, 'aiUrl', `http://127.0.0.1:${provider.address().port}`);
    for (const lane of ['PatientInsight', 'DocumentSynthesis', 'SmartImport']) await saveSetting(page, `ai${lane}KillSwitch`, 'disabled');
    const withSources = await createPatient(page, 'Sintetico A', 'Nota sintetica per la prova.');
    const noSources = await createPatient(page, 'Sintetico B');
    const openFolder = async patient => {
        const stream = page.waitForResponse(response => response.url().endsWith('/api/plugin-local-ui/events') && response.status() === 200);
        await page.goto(`/patients/${patient}/modules`);
        await stream;
        await expect.poll(() => page.evaluate(() => performance.getEntriesByType('resource')
            .some(entry => entry.name.includes('/api/patient-profile/selection-epoch')))).toBe(true);
        await expect(page.getByTestId('patient-profile-notes')).not.toContainText('Lettura delle note in corso…');
    };
    await openFolder(withSources);
    await page.evaluate(() => { window.location.hash = 'documenti'; });
    await expect(page.locator('#documenti [data-document-area="list"]')).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByRole('button', { name: 'Carica documenti', exact: true })).toBeVisible();
    await page.locator('#documenti input[type="file"]').setInputFiles({ name: 'Fonte sintetica.txt',
        mimeType: 'text/plain', buffer: Buffer.from('Testo sintetico per la verifica di navigazione.') });
    await expect(page.getByRole('status').filter({ hasText: '1 allegato salvato' })).toBeVisible();

    const client = mcp(run(path.join(destination, 'bin', 'mediflow-local-ui'), []).child);
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
    const confirmation = page.getByRole('button', { name: 'Apri sulla cartella aperta', exact: true });
    const firstReceipt = await pairing;
    if (firstReceipt.isError) assert.deepEqual(firstReceipt, denial);
    else {
        assert.deepEqual(firstReceipt, success);
        await expect(confirmation).toBeVisible();
        await page.getByTestId('plugin-local-ui-navigation').getByRole('button', { name: 'Annulla', exact: true }).click();
    }
    await expect(confirmation).toHaveCount(0);

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
    await openFolder(noSources);

    await pending('smart_import', 'Smart Import', 'Sintetico B');
    await page.getByRole('button', { name: 'Blocca', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sblocca MediFlow', exact: true })).toBeVisible();
    await expect(confirmation).toHaveCount(0);
    assert.equal(new URL(page.url()).hash, '');
    assert.deepEqual(generationRequests, []);
    assert.deepEqual(providerCalls, []);
    assert.deepEqual(clinicalSnapshot(data), before);
});
