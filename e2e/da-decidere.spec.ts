import { expect, test } from './fixtures/isolated-runtime';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import Database from 'better-sqlite3';
import { agentVisitPassphrase, createSyntheticAgentMandate } from './agent-visit-utils';
import { completeAgentPairing, prepareAndDepositAgentVisit, requestAgentPairing } from '../packages/agent-client/src/visit-client';
import { documentRequests } from './fixtures/trusted-web-request';

const fiscalCode = 'RSSMRA80A01F205X';
const captures = process.env.MEDIFLOW_DA_DECIDERE_CAPTURES;
test.describe.configure({ retries: 0 });

test('the physician decides a kit visit one proposal at a time, and the visit is never reported as applied in full', async ({ page, isolatedRuntime }, info) => {
    test.setTimeout(150000);
    const shot = async (name: string) => {
        await page.screenshot({ path: info.outputPath(name + '.png'), fullPage: true });
        if (captures) await page.screenshot({ path: path.join(captures, name + '.png'), fullPage: true });
    };
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

    const visitId = randomUUID();
    const directory = info.outputPath(visitId);
    mkdirSync(directory, { mode: 0o700 });
    const note = 'S: Controllo sintetico.\nO: Dati sintetici.\nA: Stabile.\nP: Vitamina D e visita pneumologica.';
    const therapy = 'Prescrivo colecalciferolo 25.000 UI una fiala ogni 15 giorni.';
    const service = 'Prescritta visita pneumologica di controllo.';
    const exemption = 'Confermata esenzione codice E30.';
    const source = async (lines: string[], documentDate: string | null, facts: unknown[], isNote = false) => {
        const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), sheet = pdf.addPage();
        lines.forEach((line, index) => sheet.drawText(line, { x: 40, y: 780 - index * 24, font, size: 11 }));
        const bytes = await pdf.save();
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        const fileName = isNote ? 'nota-visita.pdf' : sha256 + '.pdf';
        writeFileSync(path.join(directory, fileName), bytes);
        return { sha256, fileName, patient: { taxCode: fiscalCode }, documentDate,
            documentType: isNote ? 'visita_specialistica' : 'altro', facts,
            coverage: { pages: null, unreadablePages: [], complete: false, note: 'Originale da rivedere dal medico' } };
    };
    const prescription = await source(['Paziente CF ' + fiscalCode, 'Data Prescrizione: 17/11/2026', therapy, service, exemption], null, [
        { kind: 'therapy', values: { drugName: 'colecalciferolo', dosage: '25.000 UI una fiala ogni 15 giorni' }, quote: therapy },
        { kind: 'service_prescription', values: { serviceName: 'visita pneumologica di controllo' }, quote: service },
        { kind: 'exemption', values: { code: 'E30' }, quote: exemption },
    ]);
    const visitNote = await source(['Codice fiscale paziente: ' + fiscalCode, 'Data visita: 2026-11-17', ...note.split('\n')], '2026-11-17', [
        { kind: 'document_entry', values: { text: note, date: '2026-11-17' }, quote: note },
    ], true);
    const extraction = path.join(directory, 'estrazione-preparata.json');
    writeFileSync(extraction, JSON.stringify({ schema: 'mediflow.dossier_prepared_extraction.v1',
        preparedAt: new Date().toISOString(), preparedBy: 'Ambulatorio Codex', sources: [prescription, visitNote] }));
    const receipt = await prepareAndDepositAgentVisit(credentials, access.agentRef, extraction, fiscalCode, undefined, visitId);
    expect(receipt.status).toBe('closed');

    await page.goto(isolatedRuntime.url + '/in-arrivo');
    await page.getByLabel('Passphrase', { exact: true }).fill(agentVisitPassphrase);
    await page.getByRole('button', { name: 'Sblocca', exact: true }).click();
    await expect(page).toHaveURL(/\/da-decidere$/u);
    await expect(page.getByRole('heading', { name: 'Da decidere', exact: true, level: 1 })).toBeVisible();
    const visit = page.getByRole('region', { name: 'Visita ' + visitId });
    await expect(visit.getByText('Pronta da applicare', { exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('complementary', { name: 'MediFlow', exact: true }).getByRole('link', { name: 'Da decidere', exact: true })).toHaveAttribute('aria-current', 'page');
    const proposal = (heading: string) => visit.locator('article').filter({ has: page.getByRole('heading', { name: heading, exact: true }) });
    await expect(proposal('Terapia proposta').getByRole('complementary', { name: 'Fonte' }).getByText(therapy)).toBeVisible();
    await shot('1-visita-da-decidere');

    const database = new Database(path.join(isolatedRuntime.dataDirectory, 'medical.db'), { readonly: true, fileMustExist: true });
    try {
        const therapies = () => database.prepare('SELECT drug_name AS drug, dosage FROM therapies WHERE patient_id = ?').all(patient.id);
        const services = () => database.prepare('SELECT id FROM service_prescriptions WHERE patient_id = ?').all(patient.id);
        const entries = () => database.prepare('SELECT id FROM entries WHERE patient_id = ?').all(patient.id);
        const events = (type: string) => database.prepare('SELECT actor_ref AS actor, occurred_at AS at, redacted_metadata AS metadata FROM audit_events WHERE event_type = ? AND (request_id = ? OR subject_ref = ?)')
            .all(type, visitId, visitId) as Array<{ actor: string; at: number; metadata: string }>;
        const exemptions = async () => ((await (await documentRequests(page).get('/api/patients/' + patient.id)).json()).exemptions ?? []) as string[];

        await proposal('Terapia proposta').getByRole('button', { name: 'Correggi', exact: true }).click();
        const correction = visit.getByRole('form', { name: 'Correggi terapia proposta' });
        await correction.getByLabel('Posologia', { exact: true }).fill('25.000 UI una fiala ogni 30 giorni');
        await shot('2-correggi-la-dose');
        await correction.getByRole('button', { name: 'Tieni corretta', exact: true }).click();
        const decided = visit.getByRole('region', { name: 'Voci decise' });
        await expect(decided.getByText('Corretta in scheda', { exact: true })).toHaveCount(1);
        await expect(decided.getByText('ogni 15 giorni')).toHaveCount(0);
        expect(therapies()).toEqual([{ drug: 'colecalciferolo', dosage: '25.000 UI una fiala ogni 30 giorni' }]);
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
