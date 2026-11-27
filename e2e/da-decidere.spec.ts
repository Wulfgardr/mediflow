import { expect, test } from './fixtures/isolated-runtime';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import Database from 'better-sqlite3';
import { agentVisitPassphrase, agentVisitPin, createSyntheticAgentMandate } from './agent-visit-utils';
import { completeAgentPairing, loadAgentVisitContext, prepareAndDepositAgentVisit, requestAgentPairing, retrieveAgentMandate } from '../packages/agent-client/src/visit-client';
import { sealAgentItemNode } from '../packages/agent-client/src/cassette-crypto';
import { documentRequests } from './fixtures/trusted-web-request';

const fiscalCode = 'RSSMRA80A01F205X';
const captures = process.env.MEDIFLOW_DA_DECIDERE_CAPTURES;
test.describe.configure({ retries: 0 });

type Runtime = { url: string; dataDirectory: string };
type Info = { outputPath: (...segments: string[]) => string };
type Page = Parameters<typeof createSyntheticAgentMandate>[0];

async function pairKitAndCreatePatient(page: Page, isolatedRuntime: Runtime, info: Info) {
    await createSyntheticAgentMandate(page);
    const credentials = info.outputPath('private-agent');
    mkdirSync(credentials, { mode: 0o700 });
    const pairing = await requestAgentPairing(credentials, isolatedRuntime.url, 'Kit sintetico Da decidere');
    await page.getByRole('button', { name: 'Aggiorna', exact: true }).click();
    await page.getByRole('button', { name: 'Approva ' + pairing.code, exact: true }).click();
    const access = await completeAgentPairing(credentials, pairing.requestId);
    if (access.status !== 'approved') throw new Error('Synthetic mandate unavailable');
    const patient = await page.evaluate(async cf => {
        const response = await fetch('/api/patients', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ firstName: 'Elena', lastName: 'Sintetica', taxCode: cf, birthDate: '1980-01-01T00:00:00.000Z', address: '', phone: '', diagnoses: [] }) });
        if (!response.ok) throw new Error('SYNTHETIC_PATIENT_SETUP_FAILED');
        return response.json() as Promise<{ id: string }>;
    }, fiscalCode);
    return { credentials, agentRef: access.agentRef, patient };
}

function syntheticSources(directory: string, patient: { taxCode: string; firstName?: string; lastName?: string } = { taxCode: fiscalCode }) {
    return async (lines: string[], documentDate: string | null, facts: unknown[], isNote = false) => {
        const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), sheet = pdf.addPage();
        lines.forEach((line, index) => sheet.drawText(line, { x: 40, y: 780 - index * 24, font, size: 11 }));
        const bytes = await pdf.save();
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        const fileName = isNote ? 'nota-visita.pdf' : sha256 + '.pdf';
        writeFileSync(path.join(directory, fileName), bytes);
        return { sha256, fileName, patient, documentDate,
            documentType: isNote ? 'visita_specialistica' : 'altro', facts,
            coverage: { pages: null, unreadablePages: [], complete: false, note: 'Originale da rivedere dal medico' } };
    };
}

async function openDaDecidere(page: Page, url: string) {
    await page.goto(url + '/in-arrivo');
    await page.getByLabel('Passphrase', { exact: true }).fill(agentVisitPassphrase);
    await page.getByRole('button', { name: 'Sblocca', exact: true }).click();
    await expect(page).toHaveURL(/\/da-decidere$/u);
}

test('the physician decides a kit visit one proposal at a time, and the visit is never reported as applied in full', async ({ page, isolatedRuntime }, info) => {
    test.setTimeout(150000);
    const shot = async (name: string) => {
        await page.screenshot({ path: info.outputPath(name + '.png'), fullPage: true });
        if (captures) await page.screenshot({ path: path.join(captures, name + '.png'), fullPage: true });
    };
    const { credentials, agentRef, patient } = await pairKitAndCreatePatient(page, isolatedRuntime, info);

    const visitId = randomUUID();
    const directory = info.outputPath(visitId);
    mkdirSync(directory, { mode: 0o700 });
    const note = 'S: Controllo sintetico.\nO: Dati sintetici.\nA: Stabile.\nP: Vitamina D e visita pneumologica.';
    const therapy = 'Prescrivo Dibase colecalciferolo 25.000 UI una fiala ogni 15 giorni, AIC 036588019, ATC A11CC05.';
    const service = 'Prescritta visita pneumologica di controllo.';
    const exemption = 'Confermata esenzione codice E30.';
    const source = syntheticSources(directory);
    const prescription = await source(['Paziente CF ' + fiscalCode, 'Data Prescrizione: 17/11/2026', therapy, service, exemption], null, [
        { kind: 'therapy', values: { drugName: 'Dibase', activePrinciple: 'colecalciferolo', dosage: '25.000 UI una fiala ogni 15 giorni', aic: '036588019', atc: 'A11CC05' }, quote: therapy },
        { kind: 'service_prescription', values: { serviceName: 'visita pneumologica di controllo' }, quote: service },
        { kind: 'exemption', values: { code: 'E30' }, quote: exemption },
    ]);
    const visitNote = await source(['Codice fiscale paziente: ' + fiscalCode, 'Data visita: 2026-11-17', ...note.split('\n')], '2026-11-17', [
        { kind: 'document_entry', values: { text: note, date: '2026-11-17' }, quote: note },
    ], true);
    const extraction = path.join(directory, 'estrazione-preparata.json');
    writeFileSync(extraction, JSON.stringify({ schema: 'mediflow.dossier_prepared_extraction.v1',
        preparedAt: new Date().toISOString(), preparedBy: 'Ambulatorio Codex', sources: [prescription, visitNote] }));
    const receipt = await prepareAndDepositAgentVisit(credentials, agentRef, extraction, fiscalCode, undefined, visitId);
    expect(receipt.status).toBe('closed');

    await openDaDecidere(page, isolatedRuntime.url);
    await expect(page.getByRole('heading', { name: 'Da decidere', exact: true, level: 1 })).toBeVisible();
    const visit = page.getByRole('region', { name: 'Visita ' + visitId });
    await expect(visit.getByText('Pronta da applicare', { exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('complementary', { name: 'MediFlow', exact: true }).getByRole('link', { name: 'Da decidere', exact: true })).toHaveAttribute('aria-current', 'page');
    const proposal = (heading: string) => visit.locator('article').filter({ has: page.getByRole('heading', { name: heading, exact: true }) });
    await expect(proposal('Terapia proposta').getByRole('complementary', { name: 'Fonte' }).getByText(therapy)).toBeVisible();
    await shot('1-visita-da-decidere');

    const database = new Database(path.join(isolatedRuntime.dataDirectory, 'medical.db'), { readonly: true, fileMustExist: true });
    try {
        const therapies = () => database.prepare('SELECT drug_name AS drug, dosage, aic, atc FROM therapies WHERE patient_id = ?').all(patient.id);
        const services = () => database.prepare('SELECT id FROM service_prescriptions WHERE patient_id = ?').all(patient.id);
        const entries = () => database.prepare('SELECT id FROM entries WHERE patient_id = ?').all(patient.id);
        const events = (type: string) => database.prepare('SELECT actor_ref AS actor, occurred_at AS at, redacted_metadata AS metadata FROM audit_events WHERE event_type = ? AND (request_id = ? OR subject_ref = ?)')
            .all(type, visitId, visitId) as Array<{ actor: string; at: number; metadata: string }>;
        const exemptions = async () => ((await (await documentRequests(page).get('/api/patients/' + patient.id)).json()).exemptions ?? []) as string[];

        await proposal('Terapia proposta').getByRole('button', { name: 'Correggi', exact: true }).click();
        const correction = visit.getByRole('form', { name: 'Correggi terapia proposta' });
        const withoutCodes = correction.getByText('Senza codice AIC e ATC: valevano per il farmaco depositato.', { exact: true });
        await correction.getByLabel('Posologia', { exact: true }).fill('25.000 UI una fiala ogni 30 giorni');
        await expect(withoutCodes).toHaveCount(0);
        await correction.getByLabel('Farmaco', { exact: true }).fill('Colecalciferolo Sintetico');
        await expect(withoutCodes).toBeVisible();
        await shot('2-correggi-farmaco-e-dose');
        await correction.getByRole('button', { name: 'Tieni corretta', exact: true }).click();
        const decided = visit.getByRole('region', { name: 'Voci decise' });
        await expect(decided.getByText('Corretta in scheda', { exact: true })).toHaveCount(1);
        await expect(decided.getByText('ogni 15 giorni')).toHaveCount(0);
        expect(therapies()).toEqual([{ drug: 'Colecalciferolo Sintetico', dosage: '25.000 UI una fiala ogni 30 giorni', aic: null, atc: null }]);
        expect(services()).toEqual([]);
        expect(entries()).toEqual([]);
        await expect(visit.getByText('Decisa in parte', { exact: true })).toBeVisible();

        await proposal('Esenzione proposta').getByRole('button', { name: 'Scarta', exact: true }).click();
        await expect(decided.getByText('Scartata', { exact: true })).toHaveCount(1);
        expect(await exemptions()).toEqual([]);
        const [discard] = events('agent.item.discarded');
        expect(discard?.at).toBeGreaterThan(0);
        expect(discard?.actor).toBeTruthy();

        await proposal('Prestazione proposta').getByRole('button', { name: 'Tieni', exact: true }).click();
        await expect(decided.getByText('In scheda', { exact: true })).toHaveCount(1);
        expect(services()).toHaveLength(1);
        await shot('3-voci-decise');
        expect(events('agent.visit.applied')).toEqual([]);

        await visit.getByRole('button', { name: 'Applica la visita', exact: true }).click();
        await expect(visit).toHaveCount(0);
        expect(entries()).toHaveLength(1);
        expect(therapies()).toHaveLength(1);
        expect(await exemptions()).toEqual([]);
        expect(events('agent.visit.decided')).toHaveLength(1);
        expect(events('agent.visit.applied').map(event => JSON.parse(event.metadata).flags)).toEqual([['review']]);
        const incoming = await (await documentRequests(page).get('/api/agent-mandates/incoming?visit=' + visitId)).json();
        expect(incoming.discardedItemIds).toHaveLength(1);
        const index = await (await documentRequests(page).get('/api/agent-mandates/incoming')).json();
        expect(index.visits).not.toContainEqual(expect.objectContaining({ id: visitId }));
        await shot('4-visita-decisa');
    } finally { database.close(); }

    await page.getByRole('navigation', { name: 'Filtri', exact: true }).getByRole('link', { name: 'Documenti', exact: true }).click();
    await expect(page).toHaveURL(/\/da-decidere\?vista=documenti$/u);
    await expect(page.getByRole('button', { name: 'Scegli cartella', exact: true })).toBeVisible();
    await shot('5-filtro-documenti');
});

test('a therapy from a prescription without a stated status asks the physician, and Tieni writes the chosen status once, with audit, on the visit chart', async ({ page, isolatedRuntime }, info) => {
    test.setTimeout(150000);
    const shot = async (name: string) => {
        await page.screenshot({ path: info.outputPath(name + '.png'), fullPage: true });
        if (captures) await page.screenshot({ path: path.join(captures, name + '.png'), fullPage: true });
    };
    const { credentials, agentRef, patient } = await pairKitAndCreatePatient(page, isolatedRuntime, info);
    const visitId = randomUUID();
    const directory = info.outputPath(visitId);
    mkdirSync(directory, { mode: 0o700 });
    const source = syntheticSources(directory);
    const drug = 'FARMACO SINTETICO 150MG 28 compresse';
    const recipe = await source(['Paziente CF ' + fiscalCode, 'Data Prescrizione: 23/11/2026', 'Rp/', drug, 'Confezioni: 1'], null, [
        { kind: 'therapy', values: { drugName: 'FARMACO SINTETICO 150MG' }, quote: drug },
    ]);
    const note = 'S: Ricetta sintetica.\nO: Dati sintetici.\nA: Stabile.\nP: Terapia dalla ricetta.';
    const visitNote = await source(['Codice fiscale paziente: ' + fiscalCode, 'Data visita: 2026-11-23', ...note.split('\n')], '2026-11-23', [
        { kind: 'document_entry', values: { text: note, date: '2026-11-23' }, quote: note },
    ], true);
    const extraction = path.join(directory, 'estrazione-preparata.json');
    writeFileSync(extraction, JSON.stringify({ schema: 'mediflow.dossier_prepared_extraction.v1',
        preparedAt: new Date().toISOString(), preparedBy: 'Ambulatorio Codex', sources: [recipe, visitNote] }));
    expect((await prepareAndDepositAgentVisit(credentials, agentRef, extraction, fiscalCode, undefined, visitId)).status).toBe('closed');

    await openDaDecidere(page, isolatedRuntime.url);
    const visit = page.getByRole('region', { name: 'Visita ' + visitId });
    const proposal = visit.locator('article').filter({ has: page.getByRole('heading', { name: 'Terapia proposta', exact: true }) });
    await expect(proposal.getByText('Il documento non indica lo stato della terapia.', { exact: true })).toBeVisible({ timeout: 30000 });
    await expect(proposal.getByText(/status|Campo obbligatorio|non valido/u)).toHaveCount(0);
    await expect(proposal.getByText('Manca lo stato', { exact: true })).toBeVisible();
    await expect(proposal.getByText('FARMACO SINTETICO 150MG', { exact: true }).first()).toBeVisible();
    await expect(proposal.getByText('23/11/2026', { exact: true })).toBeVisible();
    await expect(proposal.getByText('Non indicata nel documento', { exact: true })).toHaveCount(1);
    await expect(proposal.getByRole('button', { name: 'Apri Documento del 23/11/2026', exact: true })).toBeVisible();
    await expect(proposal.getByText(/[0-9a-f]{64}/u)).toHaveCount(0);
    const keep = proposal.getByRole('button', { name: 'Tieni', exact: true });
    await expect(keep).toBeDisabled();
    await expect(visit.getByRole('button', { name: 'Applica la visita', exact: true })).toBeDisabled();
    await shot('6-ricetta-senza-stato');

    const database = new Database(path.join(isolatedRuntime.dataDirectory, 'medical.db'), { readonly: true, fileMustExist: true });
    try {
        const therapies = () => database.prepare('SELECT id, patient_id AS patientId, drug_name AS drug, status, dosage FROM therapies').all() as
            Array<{ id: string; patientId: string; drug: string; status: string; dosage: string }>;
        await proposal.getByRole('radio', { name: 'In corso', exact: true }).check();
        await expect(keep).toBeEnabled();
        await expect(keep).toHaveClass(/mf-button-primary/u);
        await expect(proposal.getByText('Manca lo stato', { exact: true })).toHaveCount(0);
        await shot('7-ricetta-stato-scelto');
        await keep.click();
        await expect(visit.getByRole('region', { name: 'Voci decise' }).getByText('In scheda', { exact: true })).toHaveCount(1);
        const written = therapies();
        expect(written.map(({ patientId, drug, status, dosage }) => ({ patientId, drug, status, dosage })))
            .toEqual([{ patientId: patient.id, drug: 'FARMACO SINTETICO 150MG', status: 'active', dosage: 'non indicata nel documento' }]);
        expect(database.prepare("SELECT 1 FROM audit_events WHERE event_type = 'therapy.created' AND subject_ref = ?").all(written[0]!.id)).toHaveLength(1);
        const applied = database.prepare("SELECT redacted_metadata AS metadata FROM audit_events WHERE event_type = 'agent.item.applied' AND request_id = ?")
            .all(visitId) as Array<{ metadata: string }>;
        expect(applied).toHaveLength(1);
        expect(JSON.parse(applied[0]!.metadata).flags ?? []).not.toContain('corrected');
        await visit.getByRole('button', { name: 'Applica la visita', exact: true }).click();
        await expect(visit).toHaveCount(0);
        expect(therapies()).toHaveLength(1);
    } finally { database.close(); }
});


test('WUL-973: Da decidere keeps closed deposits after lock and renewal, including a legacy transcription without a PDF', async ({ page, isolatedRuntime }, info) => {
    test.setTimeout(150000);
    await createSyntheticAgentMandate(page);
    const credentials = info.outputPath('private-agent');
    mkdirSync(credentials, { mode: 0o700 });
    const name = 'Kit sintetico WUL-973';
    const pairing = await requestAgentPairing(credentials, isolatedRuntime.url, name);
    await page.getByRole('button', { name: 'Aggiorna', exact: true }).click();
    await page.getByLabel('Rinnova allo sblocco', { exact: true }).check();
    await page.getByLabel('PIN per ' + name, { exact: true }).fill(agentVisitPin);
    await page.getByRole('button', { name: 'Approva ' + pairing.code, exact: true }).click();
    const access = await completeAgentPairing(credentials, pairing.requestId);
    if (access.status !== 'registered') throw new Error('Synthetic agent registration unavailable');

    const lockAndUnlock = async () => {
        const locked = page.waitForResponse(response => response.url().endsWith('/api/auth/lock'));
        await page.getByRole('button', { name: 'Blocca', exact: true }).first().click();
        expect((await locked).ok()).toBe(true);
        await page.getByLabel('Passphrase', { exact: true }).fill(agentVisitPassphrase);
        const renewed = page.waitForResponse(response => response.url().endsWith('/api/agent-mandates/unlock'));
        await page.getByRole('button', { name: 'Sblocca', exact: true }).click();
        expect((await renewed).status()).toBe(204);
        await expect(page.getByRole('navigation', { name: 'Navigazione principale', exact: true })).toBeVisible();
    };
    await lockAndUnlock();
    const mandateA = await retrieveAgentMandate(credentials, access.agentRef);
    const context = await loadAgentVisitContext(credentials, access.agentRef);
    const legacyId = randomUUID(), openId = randomUUID(), preparedId = randomUUID();
    const anotherCf = 'RSSMRA85T10A562S';
    const call = async (data: object) => {
        const response = await fetch(isolatedRuntime.url + '/api/agent/v1/visits', {
            method: 'POST', headers: { Authorization: 'Bearer ' + context.access.token, 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        expect(response.ok).toBe(true);
        return (await response.json()).receipt as { revision: number; status: string };
    };
    const seal = (visitId: string, itemId: string, kind: 'anchor' | 'transcription', value: object) => {
        const bytes = new TextEncoder().encode(JSON.stringify(value));
        return { envelope: sealAgentItemNode(context.publicKey, { mandateRef: mandateA.mandateRef, visitId, itemId, kind }, bytes), byteLength: bytes.byteLength };
    };
    const open = (visitId: string) => call({ operation: 'visita.apri', visitId,
        anchor: seal(visitId, visitId, 'anchor', { fiscalCode: anotherCf }).envelope });
    const started = await open(legacyId);
    const transcriptId = randomUUID();
    const added = await call({ operation: 'visita.trascrizione', visitId: legacyId, expectedRevision: started.revision, item: {
        id: transcriptId, kind: 'transcription', ...seal(legacyId, transcriptId, 'transcription', { text: 'Trascrizione sintetica' }), documentHash: null,
    } });
    expect((await call({ operation: 'visita.chiudi', visitId: legacyId, expectedRevision: added.revision })).status).toBe('closed');
    expect((await open(openId)).status).toBe('open');

    const directory = info.outputPath('prepared');
    mkdirSync(directory, { mode: 0o700 });
    const note = 'Nota sintetica della visita.';
    const pdf = await syntheticSources(directory, { taxCode: fiscalCode, firstName: 'Ada', lastName: 'Sintetica' })(
        ['Paziente CF ' + fiscalCode, note], '2026-11-27', [{ kind: 'document_entry', values: { text: note }, quote: note }], true);
    const extraction = path.join(directory, 'prepared.json');
    writeFileSync(extraction, JSON.stringify({ schema: 'mediflow.dossier_prepared_extraction.v1',
        preparedAt: new Date().toISOString(), preparedBy: 'Ambulatorio Codex', sources: [pdf] }));
    const receipt = await prepareAndDepositAgentVisit(credentials, access.agentRef, extraction, fiscalCode, undefined, preparedId);
    expect(receipt).toMatchObject({ status: 'closed', mandateRef: mandateA.mandateRef });

    await lockAndUnlock();
    const mandateB = await retrieveAgentMandate(credentials, access.agentRef);
    expect(mandateB.mandateRef).not.toBe(mandateA.mandateRef);
    const database = new Database(path.join(isolatedRuntime.dataDirectory, 'medical.db'), { readonly: true, fileMustExist: true });
    try {
        expect(database.prepare('SELECT revoked_at FROM agent_mandates WHERE id=?').pluck().get(mandateA.mandateRef)).toEqual(expect.any(Number));
        await page.getByRole('button', { name: 'Riduci navigazione', exact: true }).click();
        await page.setViewportSize({ width: 440, height: 850 });
        const nav = page.getByRole('navigation', { name: 'Navigazione principale', exact: true });
        const more = nav.locator('summary').filter({ hasText: 'Altro' });
        await expect.soft(more.locator('small')).toBeVisible({ timeout: 5000 });
        await expect.soft(more.locator('small')).toHaveText('3', { timeout: 10000 });
        await more.click();
        const incoming = nav.getByRole('link', { name: /^Da decidere/u });
        await expect.soft(incoming.locator('small')).toHaveText('3', { timeout: 3000 });
        await expect.soft(incoming.locator('small')).toBeVisible({ timeout: 3000 });
        await incoming.click();
        const region = (id: string) => page.getByRole('region', { name: 'Visita ' + id });
        const apply = (id: string) => region(id).getByRole('button', { name: /applica la visita/iu });
        const newName = (id: string) => region(id).getByLabel('Nome', { exact: true });
        const lastName = (id: string) => region(id).getByLabel('Cognome', { exact: true });
        await expect.soft(region(openId).getByRole('alert')).toHaveText('Il deposito della visita non è concluso.', { timeout: 3000 });
        await expect(region(openId).getByRole('button', { name: /applica la visita/iu })).toHaveCount(0);
        await expect.soft(newName(legacyId)).toHaveValue('', { timeout: 3000 });
        await expect.soft(newName(preparedId)).toHaveValue('Ada', { timeout: 3000 });
        await expect.soft(lastName(preparedId)).toHaveValue('Sintetica', { timeout: 3000 });
        if (await newName(legacyId).isVisible()) {
            await expect(apply(legacyId)).toBeDisabled();
            await newName(legacyId).fill('Lia');
            await lastName(legacyId).fill('Sintetica');
            const cf = region(legacyId).getByLabel('Codice fiscale', { exact: true });
            await expect(cf).toHaveValue(anotherCf);
            await cf.fill('ERRATO');
            await expect(apply(legacyId)).toBeDisabled();
            await expect(region(legacyId).getByText('Controlla il codice fiscale della visita.', { exact: true })).toBeVisible();
            await cf.fill('BNCLGU78C15H501Y');
        }
        if (await newName(preparedId).isVisible()) await newName(preparedId).fill('Ada Maria');
        await page.screenshot({ path: info.outputPath('prima-della-conferma.png'), fullPage: true });
        for (const id of [legacyId, preparedId]) {
            await expect.soft(apply(id)).toBeEnabled({ timeout: 3000 });
            if (await apply(id).isEnabled()) await apply(id).click();
            await expect.soft(region(id)).toHaveCount(0, { timeout: 5000 });
        }
        const patient = database.prepare('SELECT first_name, last_name, tax_code FROM patients WHERE id=?');
        expect.soft(patient.get(legacyId)).toEqual({ first_name: 'Lia', last_name: 'Sintetica', tax_code: 'BNCLGU78C15H501Y' });
        expect.soft(patient.get(preparedId)).toEqual({ first_name: 'Ada Maria', last_name: 'Sintetica', tax_code: fiscalCode });
        const entries = database.prepare('SELECT count(*) FROM entries WHERE patient_id=?').pluck();
        expect.soft(entries.get(legacyId)).toBe(1);
        expect.soft(entries.get(preparedId)).toBe(1);
        const applied = database.prepare("SELECT mandate_ref AS mandate, proposer_ref AS proposer FROM audit_events WHERE event_type='agent.visit.applied' AND subject_ref=?");
        for (const id of [legacyId, preparedId]) expect.soft(applied.all(id)).toEqual([{ mandate: mandateA.mandateRef, proposer: access.agentRef }]);
        await expect.soft(more.locator('small')).toHaveText('1');
        await page.screenshot({ path: info.outputPath('dopo-la-conferma.png'), fullPage: true });
    } finally { database.close(); }
});

async function openVisitDecisionFixture(page: Page, runtime: Runtime, info: Info) {
    const { credentials, agentRef, patient } = await pairKitAndCreatePatient(page, runtime, info);
    const context = await loadAgentVisitContext(credentials, agentRef);
    const { mandateRef, token } = context.access;
    const call = async (body: object) => {
        const response = await fetch(runtime.url + '/api/agent/v1/visits', {
            method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        expect(response.ok).toBe(true);
        return (await response.json()).receipt as { revision: number; status: string };
    };
    const operations = { note: 'visita.nota', transcription: 'visita.trascrizione', therapy: 'visita.proponi.terapia' };
    const deposit = async (anchor: object, items: Array<[keyof typeof operations, object]>) => {
        const visitId = randomUUID();
        const seal = (itemId: string, kind: keyof typeof operations | 'anchor', value: object) => {
            const bytes = new TextEncoder().encode(JSON.stringify(value));
            return { envelope: sealAgentItemNode(context.publicKey, { mandateRef, visitId, itemId, kind }, bytes), byteLength: bytes.byteLength };
        };
        let receipt = await call({ operation: 'visita.apri', visitId, anchor: seal(visitId, 'anchor', anchor).envelope });
        for (const [kind, value] of items) {
            const id = randomUUID();
            receipt = await call({ operation: operations[kind], visitId, expectedRevision: receipt.revision,
                item: { id, kind, ...seal(id, kind, value), documentHash: null } });
        }
        receipt = await call({ operation: 'visita.chiudi', visitId, expectedRevision: receipt.revision });
        expect(receipt.status).toBe('closed');
        return visitId;
    };
    const ready = await deposit({ fiscalCode }, [['note', { text: 'Nota sintetica pronta.' }]]);
    const newChart = await deposit({ fiscalCode: 'RSSMRA85T10A562S', firstName: 'Ada', lastName: 'Sintetica' },
        [['note', { text: 'Nota sintetica da tenere.' }], ['transcription', { text: 'Trascrizione sintetica da scartare.' }]]);
    const blocked = await deposit({ fiscalCode }, [['therapy', { values: { drugName: 'Farmaco sintetico', status: 'active' } }]]);
    await openDaDecidere(page, runtime.url);
    const visit = (id: string) => page.getByRole('region', { name: 'Visita ' + id });
    for (const id of [ready, newChart, blocked]) await expect(visit(id)).toBeVisible({ timeout: 30000 });
    return { visit, ready, newChart, blocked, patient };
}

async function captureVisitDecision(page: Page, info: Info, name: string) {
    for (const colorScheme of ['light', 'dark'] as const) {
        try {
            await page.emulateMedia({ colorScheme });
            await expect(page.locator('html')).toHaveClass(new RegExp('\\b' + colorScheme + '\\b'));
            const filename = name + '-' + colorScheme + '.png';
            await page.screenshot({ path: captures ? path.join(captures, filename) : info.outputPath(filename), fullPage: true });
        } finally { await page.emulateMedia({ colorScheme: 'light' }); }
    }
}

test('WUL-976: the batch reports progress, then the number and reasons for visits left in the queue', async ({ page, isolatedRuntime }, info) => {
    test.setTimeout(150000);
    const { visit, ready, newChart, blocked } = await openVisitDecisionFixture(page, isolatedRuntime, info);
    await captureVisitDecision(page, info, 'wul-976-coda');
    let release!: () => void, started!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const submitting = new Promise<void>(resolve => { started = resolve; });
    await page.route('**/api/agent-mandates/incoming', async route => {
        if (route.request().method() === 'POST') {
            started();
            await held;
        }
        await route.continue();
    });
    await page.getByRole('button', { name: 'Applica tutte le visite senza dubbi', exact: true }).click();
    try {
        await submitting;
        const progress = page.getByRole('progressbar', { name: 'Applicazione in corso. 0 su 1' });
        await expect.soft(progress).toBeVisible({ timeout: 3000 });
        if (await progress.isVisible()) await captureVisitDecision(page, info, 'wul-976-avanzamento');
    } finally { release(); }
    await expect(visit(ready)).toHaveCount(0);
    await expect(visit(newChart)).toBeVisible();
    await expect(visit(blocked)).toBeVisible();
    const summary = page.getByRole('status').filter({ hasText: '1 applicata, 2 restano' });
    await expect.soft(summary).toBeVisible({ timeout: 3000 });
    await expect.soft(summary.getByText('Scheda da creare')).toBeVisible({ timeout: 3000 });
    await expect.soft(summary.getByText('Manca una nota, una trascrizione o un PDF.')).toBeVisible({ timeout: 3000 });
    if (await summary.isVisible()) await captureVisitDecision(page, info, 'wul-976-riepilogo');
});

test('WUL-976: a new chart saves pending choices atomically and omits the discarded item', async ({ page, isolatedRuntime }, info) => {
    test.setTimeout(150000);
    const { visit, newChart } = await openVisitDecisionFixture(page, isolatedRuntime, info);
    const section = visit(newChart);
    const note = section.locator('article').filter({ hasText: 'Nota sintetica da tenere.' });
    const transcript = section.locator('details').filter({ hasText: 'Trascrizione sintetica da scartare.' });
    await expect(note.getByRole('button', { name: 'Tieni', exact: true })).toBeVisible({ timeout: 3000 });
    await transcript.locator('summary').click();
    await transcript.getByRole('button', { name: 'Scarta', exact: true }).click();
    await note.getByRole('button', { name: 'Tieni', exact: true }).click();
    await expect(transcript.getByText('Da scartare', { exact: true })).toBeVisible();
    const database = new Database(path.join(isolatedRuntime.dataDirectory, 'medical.db'), { readonly: true, fileMustExist: true });
    try {
        const audits = database.prepare("SELECT event_type AS type FROM audit_events WHERE request_id = ? AND event_type IN ('patient.created', 'agent.item.applied', 'agent.item.discarded')");
        expect(audits.all(newChart)).toEqual([]);
        await page.getByRole('button', { name: 'Aggiorna', exact: true }).click();
        await expect(note.getByText('Da tenere', { exact: true })).toBeVisible();
        await captureVisitDecision(page, info, 'wul-976-scelte-in-sospeso');
        await section.getByRole('button', { name: 'Crea scheda e applica la visita', exact: true }).click();
        await expect(section).toHaveCount(0);
        expect(database.prepare('SELECT first_name AS name FROM patients WHERE id = ?').get(newChart)).toEqual({ name: 'Ada' });
        expect(database.prepare('SELECT id FROM entries WHERE patient_id = ?').all(newChart)).toHaveLength(1);
        expect(audits.all(newChart)).toEqual(expect.arrayContaining([
            { type: 'patient.created' }, { type: 'agent.item.applied' }, { type: 'agent.item.discarded' },
        ]));
    } finally { database.close(); }
});

test('WUL-976: a blocked visit exposes item choices and a confirmed discard leaves an audit', async ({ page, isolatedRuntime }, info) => {
    test.setTimeout(150000);
    const { visit, blocked, patient } = await openVisitDecisionFixture(page, isolatedRuntime, info);
    const section = visit(blocked);
    const discardVisit = section.getByRole('button', { name: 'Scarta la visita', exact: true });
    await expect.soft(section.getByRole('button', { name: 'Scarta', exact: true })).toBeEnabled({ timeout: 3000 });
    await expect.soft(section.getByRole('button', { name: 'Tieni', exact: true })).toBeDisabled({ timeout: 3000 });
    await expect(discardVisit).toBeEnabled({ timeout: 3000 });
    await discardVisit.click();
    const dialog = page.getByRole('dialog', { name: 'Scartare la visita?' });
    await expect(dialog).toBeVisible();
    await captureVisitDecision(page, info, 'wul-976-conferma-scarto');
    await dialog.getByRole('button', { name: 'Annulla', exact: true }).click();
    await expect(section).toBeVisible();
    const database = new Database(path.join(isolatedRuntime.dataDirectory, 'medical.db'), { readonly: true, fileMustExist: true });
    try {
        const discards = database.prepare("SELECT actor_ref AS actor, proposer_ref AS proposer FROM audit_events WHERE event_type = 'agent.visit.discarded' AND subject_ref = ?");
        expect(discards.all(blocked)).toEqual([]);
        await discardVisit.click();
        await dialog.getByRole('button', { name: 'Scarta la visita', exact: true }).click();
        await expect(section).toHaveCount(0);
        expect(discards.all(blocked)).toEqual([{ actor: expect.any(String), proposer: expect.any(String) }]);
        expect(database.prepare('SELECT id FROM therapies WHERE patient_id = ?').all(patient.id)).toEqual([]);
        await page.getByRole('button', { name: 'Aggiorna', exact: true }).click();
        await expect(section).toHaveCount(0);
    } finally { database.close(); }
});

test('WUL-976: a first visit applies the therapy status chosen before creating the chart', async ({ page, isolatedRuntime }, info) => {
    test.setTimeout(150000);
    const { credentials, agentRef } = await pairKitAndCreatePatient(page, isolatedRuntime, info);
    const directory = info.outputPath('first-visit');
    mkdirSync(directory, { mode: 0o700 });
    const taxCode = 'RSSMRA85T10A562S';
    const source = syntheticSources(directory, { taxCode, firstName: 'Ada', lastName: 'Sintetica' });
    const drug = 'FARMACO SINTETICO 150MG 28 compresse';
    const recipe = await source(['Paziente CF ' + taxCode, 'Data Prescrizione: 23/11/2026', 'Rp/', drug, 'Confezioni: 1'], null, [
        { kind: 'therapy', values: { drugName: 'FARMACO SINTETICO 150MG' }, quote: drug },
    ]);
    const extraction = path.join(directory, 'estrazione-preparata.json');
    writeFileSync(extraction, JSON.stringify({ schema: 'mediflow.dossier_prepared_extraction.v1',
        preparedAt: new Date().toISOString(), preparedBy: 'Ambulatorio Codex', sources: [recipe] }));
    const visitId = randomUUID();
    expect((await prepareAndDepositAgentVisit(credentials, agentRef, extraction, taxCode, undefined, visitId)).status).toBe('closed');

    await openDaDecidere(page, isolatedRuntime.url);
    const visit = page.getByRole('region', { name: 'Visita ' + visitId });
    const apply = visit.getByRole('button', { name: 'Crea scheda e applica la visita', exact: true });
    await expect(apply).toBeDisabled();
    await expect(visit.getByRole('button', { name: 'Tieni', exact: true }).first()).toBeVisible();
    await visit.getByRole('radio', { name: 'Sospesa', exact: true }).check();
    await expect(apply).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Applica tutte le visite senza dubbi', exact: true })).toBeDisabled();
    await apply.click();
    await expect(visit).toHaveCount(0);

    const database = new Database(path.join(isolatedRuntime.dataDirectory, 'medical.db'), { readonly: true, fileMustExist: true });
    try {
        expect(database.prepare('SELECT status FROM therapies WHERE patient_id = ?').all(visitId)).toEqual([{ status: 'suspended' }]);
        expect(database.prepare("SELECT 1 FROM audit_events WHERE event_type = 'patient.created' AND request_id = ?").all(visitId)).toHaveLength(1);
    } finally { database.close(); }
});
