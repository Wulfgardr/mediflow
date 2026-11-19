import { expect, test } from './fixtures/isolated-runtime';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import Database from 'better-sqlite3';
import { agentVisitPassphrase, agentVisitPin, createSyntheticAgentMandate } from './agent-visit-utils';
import { agentApplicationSchema } from '../lib/agent-visit-application-contract';
import { documentRequests } from './fixtures/trusted-web-request';

const execute = promisify(execFile);
const repository = path.resolve(__dirname, '..');
const fiscalCode = 'RSSMRA80A01F205X';
const sentinel = 'SYNTHETIC_AUTO_VISIT_20261117';
test.describe.configure({ retries: 0 });

for (const reviewed of process.env.MEDIFLOW_VISIT_MAC_TRIAL ? [false] : [false, true]) test(reviewed ? 'the physician explicitly applies the verified clinical proposals after reading the original PDF' : 'a CLI paired for twelve hours deposits a visit and the unlocked tab files nothing before the physician’s gesture', async ({ page, isolatedRuntime }, info) => {
    test.setTimeout(150000);
    await execute(process.execPath, ['scripts/prepare-e2e-db.mjs'], {
        cwd: repository, timeout: 30000,
        env: { ...process.env, MEDIFLOW_DATA_DIR: isolatedRuntime.dataDirectory, E2E_PIN: agentVisitPin },
    });
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
    const renewable = Boolean(process.env.MEDIFLOW_VISIT_MAC_TRIAL);
    if (renewable) {
        await page.getByLabel('Rinnova allo sblocco', { exact: true }).check();
        await page.getByLabel('PIN per Client sintetico Fine visita', { exact: true }).fill(agentVisitPin);
    }
    await page.getByRole('button', { name: 'Approva ' + pairing.code, exact: true }).click();
    let access = await cli('completa', '--richiesta', pairing.requestId);
    expect(access.status).toBe(renewable ? 'registered' : 'approved');
    if (renewable) {
        const locked = page.waitForResponse(response => response.url().endsWith('/api/auth/lock'));
        await page.getByRole('button', { name: 'Blocca', exact: true }).first().click();
        expect((await locked).ok()).toBe(true);
        await page.getByLabel('Passphrase', { exact: true }).fill(agentVisitPassphrase);
        const renewal = page.waitForResponse(response => response.url().endsWith('/api/agent-mandates/unlock'));
        await page.getByRole('button', { name: 'Sblocca', exact: true }).click();
        expect((await renewal).status()).toBe(204);
        access = await cli('ritira', '--agente', access.agentRef);
    }
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
    const note = ['S: Controllo sintetico ' + sentinel + '.', 'O: Rilievi non riportati.', 'A: Valutazione sintetica.', 'P: Ricontrollo programmato.'];
    const makePdf = async (lines: string[]) => {
        const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), sheet = pdf.addPage();
        lines.forEach((line, index) => sheet.drawText(line, { x: 40, y: 780 - index * 24, font, size: 11 }));
        return Buffer.from(await pdf.save());
    };
    const writeVisitInput = async (directory: string, taxCode: string) => {
        const original = await makePdf(['Paziente CF ' + taxCode, sentinel, therapy, service, diagnosis, exemption]);
        const notePdf = await makePdf(['Codice fiscale paziente: ' + taxCode, 'Data visita: 2026-11-17', '', ...note]);
        const document = (bytes: Buffer, fileName: string, facts: unknown[]) => ({ sha256: createHash('sha256').update(bytes).digest('hex'), fileName,
            patient: { taxCode }, documentDate: '2026-11-17', documentType: 'visita', summary: null, coverage: { pages: 1, unreadablePages: [], complete: true, note: '' }, facts });
        writeFileSync(path.join(directory, 'referto-sintetico.pdf'), original, { mode: 0o600 });
        writeFileSync(path.join(directory, 'nota-visita.pdf'), notePdf, { mode: 0o600 });
        const extraction = { schema: 'mediflow.dossier_prepared_extraction.v1', preparedAt: new Date().toISOString(), preparedBy: 'synthetic-cli-trial', sources: [
            document(original, 'referto-sintetico.pdf', [
                { kind: 'therapy', values: { drugName: 'Farmaco Sintetico', dosage: '1 compressa al giorno', status: 'active', startDate: '2026-11-17' }, quote: therapy },
                { kind: 'service_prescription', values: { serviceName: 'Prestazione Sintetica', prescribedAt: '2026-11-17', category: 'other' }, quote: service },
                { kind: 'diagnosis', values: { description: 'Diagnosi sintetica', code: 'E11.9', system: 'ICD-10', date: '2026-11-17' }, quote: diagnosis },
                { kind: 'exemption', values: { code: '013' }, quote: exemption },
            ]),
            document(notePdf, 'nota-visita.pdf', [{ kind: 'document_entry', values: { text: note.join('\n'), date: '2026-11-17' }, quote: note.join('\n') }]),
        ] };
        const file = path.join(directory, 'estrazione-preparata.json');
        writeFileSync(file, JSON.stringify(extraction), { mode: 0o600 });
        return { extraction, file };
    };
    const { extraction, file: extractionFile } = await writeVisitInput(source, fiscalCode);
    const plainBodies: string[] = [];
    page.on('request', request => { if (request.url().endsWith('/api/agent-mandates/incoming') && request.method() === 'POST') plainBodies.push(request.postData() ?? ''); });
    const visitId = randomUUID();
    const deposited = await cli('deposita', '--agente', access.agentRef, '--estrazione', extractionFile, '--cf', fiscalCode, '--visita', visitId);
    expect(deposited.status).toBe('closed');
    expect(deposited.itemCount).toBe(7);
    expect(deposited.modelProvider).toBe('openai');
    const counts = async () => {
        const endpoints = ['entries', 'attachments', 'therapies', 'service-prescriptions'];
        const result = [];
        for (const endpoint of endpoints) {
            const response = await documentRequests(page).get('/api/' + endpoint + '?patientId=' + patient.id);
            expect(response.status()).toBe(200);
            const rows = await response.json();
            result.push(rows.filter((row: { patientId: string }) => row.patientId === patient.id).length);
        }
        return result;
    };
    const incomingLink = page.getByRole('complementary', { name: 'MediFlow', exact: true }).getByRole('link', { name: 'In arrivo', exact: true });
    await incomingLink.click();
    await expect(page.getByRole('region', { name: 'Visita ' + visitId })).toBeVisible({ timeout: 30000 });
    expect(await counts()).toEqual([0, 0, 0, 0]);
    expect(plainBodies).toEqual([]);
    const patientAfter = await (await documentRequests(page).get('/api/patients/' + patient.id)).json();
    expect(JSON.stringify(patientAfter.diagnoses ?? [])).not.toContain('E11.9');
    expect(JSON.stringify(patientAfter.exemptions ?? [])).not.toContain('013');
    const sealed = 'ENC:AAAA:AAAA';
    const syntheticPlan = agentApplicationSchema.parse({ visitId, phase: 'review', patientId: patient.id, expectedVersion: 1, cassetteRevision: 1,
        items: [{ id: randomUUID(), kind: 'note', values: { title: sealed, content: sealed, date: '2026-11-17', metadata: sealed } }] });
    const tokenDenied = await page.request.post('/api/agent-mandates/incoming', { headers: { Authorization: 'Bearer synthetic-token-denied' }, data: syntheticPlan });
    expect(tokenDenied.status()).toBe(403);
    const stale = await page.evaluate(async input => {
        const response = await fetch('/api/agent-mandates/incoming', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
        return { status: response.status, body: await response.json() };
    }, { ...syntheticPlan, expectedVersion: 99999 });
    expect(stale.status).toBe(409);
    expect(stale.body.status).toBe('not_applied');
    expect(await counts()).toEqual([0, 0, 0, 0]);
    plainBodies.length = 0;
    const seedExemption = async () => {
        const catalog = await page.evaluate(async () => {
            const response = await fetch('/api/exemptions', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: '013', description: 'Esenzione sintetica per prova isolata', source: 'synthetic' }) });
            return { status: response.status, body: await response.json() };
        });
        expect(catalog.status).toBe(200);
        expect(catalog.body.count).toBe(1);
    };
    if (process.env.MEDIFLOW_VISIT_MAC_TRIAL) {
        await seedExemption();
        const shown = page.waitForRequest(request => request.url().endsWith('/api/agent-mandates/confirmation')
            && request.method() === 'POST' && request.postDataJSON()?.action === 'show', { timeout: 35000 });
        const credential = path.join(credentials, access.agentRef + '.json');
        unlinkSync(credential);
        const opened = await cli('apri-conferma', '--agente', access.agentRef, '--visita', visitId);
        expect(opened.status).toBe('waiting');
        const proposal = await shown;
        expect(proposal.postData()).not.toContain(fiscalCode);
        expect(proposal.postData()).not.toContain(therapy);
        const reference = opened.reference;
        const renewed = JSON.parse(readFileSync(credential, 'utf8'));
        expect(renewed.mandateRef).toBe(deposited.mandateRef);
        const token = renewed.token;
        const deniedNative = await page.request.post('/api/agent-mandates/confirmation', {
            headers: { Authorization: 'Bearer ' + token }, data: proposal.postDataJSON(),
        });
        expect(deniedNative.status()).toBe(403);
        const deniedAgent = await page.request.post('/api/agent/v1/confirmation', {
            headers: { Authorization: 'Bearer ' + token }, data: { visitId, proof: 'boolean-claim' },
        });
        expect(deniedAgent.status()).toBe(403);
        const result = async () => (await cli('esito-conferma', '--agente', access.agentRef, '--riferimento', reference)).status;
        console.log('SYNTHETIC_VISIT_NATIVE_PLAN_SENT');
        if (process.env.MEDIFLOW_VISIT_MAC_TRIAL === 'interactive') {
            await expect.poll(result, { timeout: 65000, intervals: [1000, 2000] }).toBe('applied');
            expect(await counts()).toEqual([1, 2, 1, 1]);
            expect(await result()).toBe('applied');
            expect(await counts()).toEqual([1, 2, 1, 1]);
        } else {
            expect(await result()).toBe('waiting');
            expect(await counts()).toEqual([0, 0, 0, 0]);
            await expect.poll(result, { timeout: 65000, intervals: [1000, 3000] }).toBe('not_applied');
            expect(await counts()).toEqual([0, 0, 0, 0]);
        }
        const database = new Database(path.join(isolatedRuntime.dataDirectory, 'medical.db'), { readonly: true, fileMustExist: true });
        try {
            const audit = database.prepare('SELECT event_type, outcome, actor_type, actor_ref, proposer_ref, mandate_ref, model_provider, redacted_metadata FROM audit_events WHERE request_id=?')
                .all(reference) as Array<Record<string, string>>;
            expect(audit).toHaveLength(1);
            const mandate = database.prepare('SELECT actor_ref FROM agent_mandates WHERE id=?').get(access.mandateRef) as { actor_ref: string };
            expect(audit[0]).toMatchObject({ actor_type: 'user', actor_ref: mandate.actor_ref, proposer_ref: access.agentRef,
                mandate_ref: access.mandateRef, model_provider: 'openai' });
            expect(JSON.parse(audit[0].redacted_metadata).flags).toContain('confirmation:codex-macos');
            expect(audit[0].redacted_metadata).not.toContain(fiscalCode);
            if (process.env.MEDIFLOW_VISIT_MAC_TRIAL === 'interactive') {
                expect(audit[0]).toMatchObject({ event_type: 'agent.visit.applied', outcome: 'success' });
                const plan = agentApplicationSchema.parse(proposal.postDataJSON().plan);
                const metadata = JSON.parse(audit[0].redacted_metadata);
                const policy = metadata.flags.find((flag: string) => flag.startsWith('policy:'));
                expect(['policy:biometrics-or-companion', 'policy:account-password']).toContain(policy);
                if (process.env.MEDIFLOW_VISIT_EXPECTED_POLICY) expect(policy).toBe('policy:' + process.env.MEDIFLOW_VISIT_EXPECTED_POLICY);
                expect(metadata.counts).toBe(7);
                const { appliedItemIds } = await (await documentRequests(page).get('/api/agent-mandates/incoming?visit=' + visitId)).json();
                expect(appliedItemIds).toHaveLength(7);
                expect(appliedItemIds).toEqual(expect.arrayContaining(plan.items.map(item => item.id)));
                const patientRow = database.prepare('SELECT diagnoses, exemptions, version FROM patients WHERE id=?').get(plan.patientId);
                expect(patientRow).toMatchObject({ version: plan.expectedVersion + 2 });
                for (const item of plan.items) {
                    if (item.kind === 'diagnosis') expect(patientRow).toMatchObject({ diagnoses: item.values.diagnoses });
                    if (item.kind === 'exemption') expect(patientRow).toMatchObject({ exemptions: item.values.exemptions });
                    if (item.kind === 'therapy') expect(database.prepare('SELECT drug_name, dosage, status FROM therapies WHERE id=?').all(item.id))
                        .toEqual([{ drug_name: item.values.drugName, dosage: item.values.dosage, status: item.values.status }]);
                    if (item.kind === 'service') expect(database.prepare('SELECT service_name, category, source FROM service_prescriptions WHERE id=?').all(item.id))
                        .toEqual([{ service_name: item.values.serviceName, category: item.values.category, source: item.values.source }]);
                }
                await info.attach('native-visit-confirmation.json', {
                    contentType: 'application/json',
                    body: JSON.stringify({ itemKinds: plan.items.map(item => item.kind), oneSuccessAudit: true,
                        exactStoredPlan: true, physicianAgentMandateChecked: true, policy, receiptStatus: 'applied' }),
                });
            } else {
                expect(audit[0]).toMatchObject({ event_type: 'agent.visit.confirmation.denied', outcome: 'denied' });
            }
        } finally {
            database.close();
        }
        return;
    }
    if (!process.env.MEDIFLOW_VISIT_CONFIRMATION_HELPER) {
        const opened = await cli('apri-conferma', '--agente', access.agentRef, '--visita', visitId);
        expect(opened).toEqual({ reference: expect.any(String), status: 'unavailable' });
        const forged = await page.evaluate(async ({ reference, plan }) => {
            const request = await fetch('/api/agent-mandates/confirmation', { method: 'POST',
                headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'show', reference, plan, presentation: 'AAAA' }) });
            return request.status;
        }, { reference: opened.reference, plan: syntheticPlan });
        expect(forged).toBe(403);
        expect(await counts()).toEqual([0, 0, 0, 0]);
    }
    await incomingLink.click();
    for (const label of ['Nota', 'PDF', 'Terapia proposta', 'Prestazione proposta', 'Diagnosi proposta', 'Esenzione proposta']) await expect(page.getByRole('heading', { name: label, exact: true }).first()).toBeVisible();
    await expect(page.getByText(note[0]!, { exact: false }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'nota-visita.pdf', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'referto-sintetico.pdf', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'referto-sintetico.pdf', exact: true })).toBeVisible();
    await expect(page.getByTestId('document-preview-pdf-page')).toBeVisible();
    await page.screenshot({ path: info.outputPath('originale-pdf-della-visita.png'), fullPage: true });
    await page.getByRole('dialog').getByRole('button', { name: 'Chiudi', exact: true }).click();
    await page.screenshot({ path: info.outputPath('visita-in-attesa-del-medico.png'), fullPage: true });
    await page.getByRole('heading', { name: 'Esenzione proposta', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('diagnosi-esenzione-in-attesa.png'), fullPage: true });
    const index = await (await documentRequests(page).get('/api/agent-mandates/incoming')).json();
    expect(index.visits).toContainEqual(expect.objectContaining({ id: visitId }));
    expect(JSON.stringify(index)).not.toContain('itemsCiphertext');
    const incoming = await (await documentRequests(page).get('/api/agent-mandates/incoming?visit=' + visitId)).json();
    expect(incoming.appliedItemIds).toEqual([]);
    const replay = await cli('riprendi', '--agente', access.agentRef, '--visita', visitId);
    expect(replay.visitId).toBe(visitId);
    await page.getByRole('button', { name: 'Aggiorna', exact: true }).click();
    expect(await counts()).toEqual([0, 0, 0, 0]);
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
        const { file: concurrentFile } = await writeVisitInput(concurrentSource, concurrentCf);
        expect((await cli('deposita', '--agente', access.agentRef, '--estrazione', concurrentFile, '--cf', concurrentCf, '--visita', concurrentId)).status).toBe('closed');
        const secondVisitId = randomUUID();
        const second = await cli('deposita', '--agente', access.agentRef, '--estrazione', extractionFile, '--cf', fiscalCode, '--visita', secondVisitId);
        expect(second.status).toBe('closed');
        expect(await counts()).toEqual([0, 0, 0, 0]);
        await seedExemption();
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
        expect(await counts()).toEqual([0, 0, 0, 0]);
        expect(plainBodies).toEqual([]);
        const batchOrder: string[] = [];
        await page.route('**/api/agent-mandates/incoming', async route => {
            const request = route.request();
            if (request.method() === 'POST') {
                const input = request.postDataJSON();
                batchOrder.push(input.visitId);
                if (input.visitId === concurrentId) {
                    const update = await documentRequests(page).put('/api/patients/' + concurrentPatient.id, {
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
        await expect.poll(counts).toEqual([2, 4, 2, 2]);
        expect(batchOrder).toEqual([visitId, concurrentId, secondVisitId]);
        expect(plainBodies.map(body => JSON.parse(body).visitId)).toEqual(batchOrder);
        expect(plainBodies.join('')).not.toContain(sentinel);
        expect(plainBodies.join('')).not.toContain(fiscalCode);
        await expect(validVisit).toHaveCount(0);
        await expect(secondVisit).toHaveCount(0);
        await expect(doubtfulVisit).toBeVisible();
        await expect(concurrentVisit).toBeVisible();
        const concurrentReceipt = await (await documentRequests(page).get('/api/agent-mandates/incoming?visit=' + concurrentId)).json();
        expect(concurrentReceipt.appliedItemIds).toEqual([]);
        const pendingIndex = await (await documentRequests(page).get('/api/agent-mandates/incoming')).json();
        expect(pendingIndex.visits).not.toContainEqual(expect.objectContaining({ id: visitId }));
        expect(pendingIndex.visits).toContainEqual(expect.objectContaining({ id: doubtfulId }));
        const applied = await (await documentRequests(page).get('/api/agent-mandates/incoming?visit=' + visitId)).json();
        expect(applied.appliedItemIds).toHaveLength(7);
        const notApplied = await (await documentRequests(page).get('/api/agent-mandates/incoming?visit=' + doubtfulId)).json();
        expect(notApplied.appliedItemIds).toEqual([]);
        await page.screenshot({ path: info.outputPath('proposte-applicate-dopo-conferma.png'), fullPage: true });
    }
});
