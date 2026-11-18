import { expect, test } from './fixtures/isolated-runtime';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createSyntheticAgentMandate } from './agent-visit-utils';
import { trustedArchiveWebRequestHeaders } from './fixtures/trusted-web-request';

const execute = promisify(execFile);
const repository = path.resolve(__dirname, '..');
const fiscalCode = 'RSSMRA80A01F205X';
const sentinel = 'SYNTHETIC_AUTO_VISIT_20261117';
test.describe.configure({ retries: 0 });

for (const reviewed of [false, true]) test(reviewed ? 'the physician explicitly applies the verified clinical proposals after reading the original PDF' : 'a CLI paired for twelve hours deposits a visit and the unlocked tab automatically accepts only note and PDF', async ({ page, isolatedRuntime }, info) => {
    test.setTimeout(150000);
    await createSyntheticAgentMandate(page);
    const credentials = info.outputPath('private-agent');
    mkdirSync(credentials, { mode: 0o700 });
    const cli = async (...args: string[]) => {
        const cfIndex = args.indexOf('--cf');
        const cfInput = cfIndex >= 0 ? args[cfIndex + 1] : undefined;
        if (cfInput !== undefined) args[cfIndex + 1] = '-';
        const pending = execute(process.execPath, ['scripts/run-strip-types.mjs', 'packages/agent-client/src/cli.ts', ...args, '--credenziali', credentials],
            { cwd: repository, timeout: 30000, maxBuffer: 1024 * 1024 });
        if (cfInput !== undefined) {
            expect(pending.child.spawnargs).not.toContain(fiscalCode);
            pending.child.stdin?.end(cfInput + '\n');
        }
        const result = await pending;
        expect(result.stdout).not.toContain(sentinel);
        expect(result.stderr).not.toContain(sentinel);
        return JSON.parse(result.stdout);
    };
    const pairing = await cli('collega', '--origine', isolatedRuntime.url, '--nome', 'Client sintetico Fine visita');
    expect(pairing.status).toBe('pending');
    await page.getByRole('button', { name: 'Aggiorna', exact: true }).click();
    await page.getByRole('button', { name: 'Approva ' + pairing.code, exact: true }).click();
    const access = await cli('completa', '--richiesta', pairing.requestId);
    expect(access.status).toBe('approved');
    expect(access.expiresAt - Date.now()).toBeGreaterThan(43100000);
    expect(access.expiresAt - Date.now()).toBeLessThanOrEqual(43200000);
    const createPatient = (taxCode: string) => page.evaluate(async cf => {
        const response = await fetch('/api/patients', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ firstName: 'Persona', lastName: 'Sintetica cassetta', taxCode: cf, birthDate: '1980-01-01T00:00:00.000Z', address: '', phone: '', diagnoses: [] }) });
        if (!response.ok) throw new Error('SYNTHETIC_PATIENT_SETUP_FAILED');
        return response.json();
    }, taxCode);
    const patient = await createPatient(fiscalCode);
    const source = info.outputPath('visit-input');
    mkdirSync(source, { mode: 0o700 });
    const therapy = 'Farmaco Sintetico 1 compressa al giorno dal 2026-11-17';
    const service = 'Prestazione Sintetica prescritta 2026-11-17';
    const diagnosis = 'Diagnosi sintetica E11.9 ICD-10 2026-11-17';
    const exemption = 'Esenzione 013';
    const makePdf = async (taxCode: string) => {
        const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), sheet = pdf.addPage();
        ['Paziente CF ' + taxCode, sentinel, therapy, service, diagnosis, exemption].forEach((line, index) => sheet.drawText(line, { x: 40, y: 780 - index * 24, font, size: 11 }));
        return Buffer.from(await pdf.save());
    };
    const bytes = await makePdf(fiscalCode);
    writeFileSync(path.join(source, 'nota-visita.pdf'), bytes, { mode: 0o600 });
    const extraction = { schema: 'mediflow.dossier_prepared_extraction.v1', preparedAt: new Date().toISOString(), preparedBy: 'synthetic-cli-trial', sources: [{
        sha256: createHash('sha256').update(bytes).digest('hex'), fileName: 'nota-visita.pdf', patient: { taxCode: fiscalCode }, documentDate: '2026-11-17', documentType: 'visita', summary: null,
        coverage: { pages: 1, unreadablePages: [], complete: true, note: '' }, facts: [
            { kind: 'document_entry', values: { text: sentinel, date: '2026-11-17' }, quote: sentinel },
            { kind: 'therapy', values: { drugName: 'Farmaco Sintetico', dosage: '1 compressa al giorno', status: 'active', startDate: '2026-11-17' }, quote: therapy },
            { kind: 'service_prescription', values: { serviceName: 'Prestazione Sintetica', prescribedAt: '2026-11-17', category: 'other' }, quote: service },
            { kind: 'diagnosis', values: { description: 'Diagnosi sintetica', code: 'E11.9', system: 'ICD-10', date: '2026-11-17' }, quote: diagnosis },
            { kind: 'exemption', values: { code: '013' }, quote: exemption },
        ],
    }] };
    const extractionFile = path.join(source, 'estrazione-preparata.json');
    writeFileSync(extractionFile, JSON.stringify(extraction), { mode: 0o600 });
    const plainBodies: string[] = [];
    page.on('request', request => { if (request.url().endsWith('/api/agent-mandates/incoming') && request.method() === 'POST') plainBodies.push(request.postData() ?? ''); });
    const visitId = randomUUID();
    const deposited = await cli('deposita', '--agente', access.agentRef, '--estrazione', extractionFile, '--cf', fiscalCode, '--visita', visitId);
    expect(deposited.status).toBe('closed');
    expect(deposited.itemCount).toBe(6);
    expect(deposited.modelProvider).toBe('openai');
    const counts = async () => {
        const endpoints = ['entries', 'attachments', 'therapies', 'service-prescriptions'];
        const result = [];
        for (const endpoint of endpoints) {
            const response = await page.request.get('/api/' + endpoint + '?patientId=' + patient.id);
            expect(response.status()).toBe(200);
            const rows = await response.json();
            result.push(rows.filter((row: { patientId: string }) => row.patientId === patient.id).length);
        }
        return result;
    };
    await expect.poll(counts, { timeout: 30000 }).toEqual([1, 1, 0, 0]);
    const patientAfter = await (await page.request.get('/api/patients/' + patient.id)).json();
    expect(JSON.stringify(patientAfter.diagnoses ?? [])).not.toContain('E11.9');
    expect(JSON.stringify(patientAfter.exemptions ?? [])).not.toContain('013');
    expect(plainBodies.length).toBeGreaterThan(0);
    expect(plainBodies.join('')).not.toContain(sentinel);
    expect(plainBodies.join('')).not.toContain(fiscalCode);
    const tokenDenied = await page.request.post('/api/agent-mandates/incoming', { headers: { Authorization: 'Bearer synthetic-token-denied' }, data: JSON.parse(plainBodies[0]) });
    expect(tokenDenied.status()).toBe(403);
    const stale = await page.evaluate(async input => {
        const response = await fetch('/api/agent-mandates/incoming', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
        return { status: response.status, body: await response.json() };
    }, { ...JSON.parse(plainBodies[0]), expectedVersion: 99999 });
    expect(stale.status).toBe(409);
    expect(stale.body.status).toBe('not_applied');
    expect(await counts()).toEqual([1, 1, 0, 0]);
    await page.getByRole('complementary', { name: 'MediFlow', exact: true }).getByRole('link', { name: 'In arrivo', exact: true }).click();
    for (const label of ['Terapia proposta', 'Prestazione proposta', 'Diagnosi proposta', 'Esenzione proposta']) await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'nota-visita.pdf', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'nota-visita.pdf', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'nota-visita.pdf', exact: true })).toBeVisible();
    await expect(page.getByTestId('document-preview-pdf-page')).toBeVisible();
    await page.screenshot({ path: info.outputPath('originale-pdf-della-visita.png'), fullPage: true });
    await page.getByRole('dialog').getByRole('button', { name: 'Chiudi', exact: true }).click();
    await page.screenshot({ path: info.outputPath('nota-pdf-applicati-proposte-in-attesa.png'), fullPage: true });
    await page.getByRole('heading', { name: 'Esenzione proposta', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('diagnosi-esenzione-in-attesa.png'), fullPage: true });
    const index = await (await page.request.get('/api/agent-mandates/incoming')).json();
    expect(index.visits).toContainEqual(expect.objectContaining({ id: visitId }));
    expect(JSON.stringify(index)).not.toContain('itemsCiphertext');
    const incoming = await (await page.request.get('/api/agent-mandates/incoming?visit=' + visitId)).json();
    expect(incoming.appliedItemIds).toHaveLength(2);
    const replay = await cli('riprendi', '--agente', access.agentRef, '--visita', visitId);
    expect(replay.visitId).toBe(visitId);
    await page.getByRole('button', { name: 'Aggiorna', exact: true }).click();
    expect(await counts()).toEqual([1, 1, 0, 0]);
    for (const name of ['medical.db', 'medical.db-wal']) {
        try { expect(readFileSync(path.join(isolatedRuntime.dataDirectory, name)).includes(Buffer.from(sentinel))).toBe(false); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    if (reviewed) {
        const doubtfulId = randomUUID(), doubtfulCf = 'RSSMRA85T10A562S';
        const doubtfulFile = path.join(source, 'estrazione-dubbia.json');
        writeFileSync(doubtfulFile, JSON.stringify({ ...extraction, sources: extraction.sources.map(document =>
            ({ ...document, patient: { taxCode: doubtfulCf } })) }), { mode: 0o600 });
        const doubtful = await cli('deposita', '--agente', access.agentRef, '--estrazione', doubtfulFile, '--cf', doubtfulCf, '--visita', doubtfulId);
        expect(doubtful.status).toBe('closed');
        const concurrentCf = 'BNCLGU78C15H501Y';
        const concurrentPatient = await createPatient(concurrentCf);
        const concurrentId = randomUUID(), concurrentSource = path.join(source, 'visita-concorrente');
        mkdirSync(concurrentSource, { mode: 0o700 });
        const concurrentFile = path.join(concurrentSource, 'estrazione-preparata.json');
        const concurrentPdf = await makePdf(concurrentCf);
        writeFileSync(path.join(concurrentSource, 'nota-visita.pdf'), concurrentPdf, { mode: 0o600 });
        writeFileSync(concurrentFile, JSON.stringify({ ...extraction, sources: extraction.sources.map(document =>
            ({ ...document, patient: { taxCode: concurrentCf },
                sha256: createHash('sha256').update(concurrentPdf).digest('hex') })) }), { mode: 0o600 });
        expect((await cli('deposita', '--agente', access.agentRef, '--estrazione', concurrentFile, '--cf', concurrentCf, '--visita', concurrentId)).status).toBe('closed');
        const secondVisitId = randomUUID();
        const second = await cli('deposita', '--agente', access.agentRef, '--estrazione', extractionFile, '--cf', fiscalCode, '--visita', secondVisitId);
        expect(second.status).toBe('closed');
        await expect.poll(counts).toEqual([2, 2, 0, 0]);
        const catalog = await page.evaluate(async () => {
            const response = await fetch('/api/exemptions', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: '013', description: 'Esenzione sintetica per prova isolata', source: 'synthetic' }) });
            return { status: response.status, body: await response.json() };
        });
        expect(catalog.status).toBe(200);
        expect(catalog.body.count).toBe(1);
        await page.getByRole('button', { name: 'Aggiorna', exact: true }).click();
        const validVisit = page.getByRole('region', { name: 'Visita ' + visitId });
        const secondVisit = page.getByRole('region', { name: 'Visita ' + secondVisitId });
        const doubtfulVisit = page.getByRole('region', { name: 'Visita ' + doubtfulId });
        const concurrentVisit = page.getByRole('region', { name: 'Visita ' + concurrentId });
        await expect(validVisit.getByRole('button', { name: 'Applica la visita', exact: true })).toBeEnabled();
        await expect(secondVisit.getByRole('button', { name: 'Applica la visita', exact: true })).toBeEnabled();
        await expect(concurrentVisit.getByRole('button', { name: 'Applica la visita', exact: true })).toBeEnabled();
        await expect(doubtfulVisit.getByText('Codice fiscale non confermato in una scheda esistente.', { exact: true })).toBeVisible();
        await expect(doubtfulVisit.getByRole('button', { name: 'Applica la visita', exact: true })).toBeDisabled();
        expect(await counts()).toEqual([2, 2, 0, 0]);
        const batchOrder: string[] = [];
        const archiveHeaders = await trustedArchiveWebRequestHeaders(page);
        await page.route('**/api/agent-mandates/incoming', async route => {
            const request = route.request();
            if (request.method() === 'POST') {
                const input = request.postDataJSON();
                batchOrder.push(input.visitId);
                if (input.visitId === concurrentId) {
                    const update = await page.request.put('/api/patients/' + concurrentPatient.id, {
                        headers: archiveHeaders,
                        data: { version: input.expectedVersion, phone: '0000000000' },
                    });
                    expect(update.status()).toBe(200);
                }
            }
            await route.continue();
        });
        const rejected = page.waitForResponse(response => response.url().endsWith('/api/agent-mandates/incoming')
            && response.request().method() === 'POST' && response.request().postDataJSON().visitId === concurrentId);
        await page.getByRole('button', { name: 'Applica tutte le visite senza dubbi', exact: true }).click();
        expect((await rejected).status()).toBe(409);
        await expect.poll(counts).toEqual([2, 2, 2, 2]);
        expect(batchOrder).toEqual([visitId, concurrentId, secondVisitId]);
        await expect(validVisit).toHaveCount(0);
        await expect(secondVisit).toHaveCount(0);
        await expect(doubtfulVisit).toBeVisible();
        await expect(concurrentVisit).toBeVisible();
        const concurrentReceipt = await (await page.request.get('/api/agent-mandates/incoming?visit=' + concurrentId)).json();
        expect(concurrentReceipt.appliedItemIds).toHaveLength(2);
        const pendingIndex = await (await page.request.get('/api/agent-mandates/incoming')).json();
        expect(pendingIndex.visits).not.toContainEqual(expect.objectContaining({ id: visitId }));
        expect(pendingIndex.visits).toContainEqual(expect.objectContaining({ id: doubtfulId }));
        const applied = await (await page.request.get('/api/agent-mandates/incoming?visit=' + visitId)).json();
        expect(applied.appliedItemIds).toHaveLength(6);
        const notApplied = await (await page.request.get('/api/agent-mandates/incoming?visit=' + doubtfulId)).json();
        expect(notApplied.appliedItemIds).toEqual([]);
        await page.screenshot({ path: info.outputPath('proposte-applicate-dopo-conferma.png'), fullPage: true });
    }
});
