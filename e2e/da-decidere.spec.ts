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
    await expect(proposal.getByText('Il documento non indica lo stato della terapia: sceglilo prima di tenerla.', { exact: true })).toBeVisible({ timeout: 30000 });
    await expect(proposal.getByText(/status|Campo obbligatorio|non valido/u)).toHaveCount(0);
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
