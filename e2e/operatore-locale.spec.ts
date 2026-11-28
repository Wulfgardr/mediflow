import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import type { Page } from '@playwright/test';

import { bootstrapUnlockedSession, onboardingPassphrase, openUnlockedDocument } from './utils';
import { expect, test } from './fixtures/isolated-runtime';
import { isValidItalianTaxCode } from '../lib/patient-identity.ts';

const PIN = '271828';
const OPERATORE = path.resolve(__dirname, '..', 'scripts', 'mediflow-operatore.mjs');

function syntheticPerson() {
    const letters = Array.from({ length: 6 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');
    const day = 1 + Math.floor(Math.random() * 28);
    const prefix = `${letters}80A${String(day).padStart(2, '0')}Z${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
    const check = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].find(letter => isValidItalianTaxCode(prefix + letter));
    if (!check) throw new Error('Synthetic tax code unavailable');
    const dd = String(day).padStart(2, '0');
    return { code: prefix + check, birth: `${dd}/01/1980`, iso: `1980-01-${dd}` };
}

async function textPdf(lines: string[]): Promise<Uint8Array> {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const page = document.addPage([595, 842]);
    lines.forEach((line, index) => page.drawText(line, { x: 40, y: 800 - index * 18, size: 11, font }));
    return document.save();
}

function operatore(url: string, stato: string, args: string[], credenziali: object | null) {
    return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
        const env: NodeJS.ProcessEnv = { ...process.env, MEDIFLOW_OPERATORE_STATO: stato, MEDIFLOW_OPERATORE_DIAGNOSI: '1' };
        delete env.PORT;
        const child = spawn(process.execPath, [OPERATORE, ...args, '--url', url, ...(credenziali ? ['--credenziali-stdin'] : [])],
            { env, stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', chunk => { stdout += String(chunk); });
        child.stderr.on('data', chunk => { stderr += String(chunk); });
        child.on('error', reject);
        child.on('close', code => resolve({ code, stdout, stderr }));
        child.stdin.end(credenziali ? JSON.stringify(credenziali) : '');
    });
}

async function rows(page: Page, resource: string, patientId?: string) {
    return page.evaluate(async ([name, id]) => {
        const query = id ? `?patientId=${encodeURIComponent(id)}` : '';
        return await (await fetch(`/api/${name}${query}`, { cache: 'no-store' })).json() as Array<Record<string, unknown>>;
    }, [resource, patientId] as const);
}

test('Operatore locale: crea le schede di un lotto con un PIN dal Portachiavi, salva gli originali e applica il verificato senza browser', async ({ page, isolatedRuntime }) => {
    test.setTimeout(300_000);
    await bootstrapUnlockedSession(page, PIN);
    const root = mkdtempSync(path.join(tmpdir(), 'mediflow-operatore-e2e-'));
    const stato = path.join(root, 'stato');
    try {
        const credenziali = { segreto: onboardingPassphrase(PIN), pin: PIN };
        const personP = syntheticPerson();
        let personQ = syntheticPerson();
        while (personQ.code === personP.code) personQ = syntheticPerson();
        const P = personP.code;
        const Q = personQ.code;
        const inbox = path.join(root, 'Settimana');
        mkdirSync(inbox, { recursive: true });
        const today = new Date();
        const day = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
        const iso = today.toISOString().slice(0, 10);
        const diagnosisQuote = (code: string) => `Diagnosi: ${code === P ? 'I10 ' : ''}Ipertensione arteriosa essenziale`;
        const letter = (person: { code: string; birth: string }, name: string, drug: string) => textPdf(['Lettera di dimissione sintetica',
            `Paziente: ${name}`, `Nato il ${person.birth}`, `Codice fiscale paziente: ${person.code}`, `Data referto: ${day}`,
            diagnosisQuote(person.code), `Terapia: ${drug}`, 'Il paziente riferisce dispnea da sforzo da circa due mesi.']);
        const a = await letter(personP, 'Inventata Prima', 'Ramipril 5 mg 1 cp al mattino');
        const b = await letter(personQ, 'Inventato Secondo', 'Bisoprololo 2,5 mg 1 cp');
        writeFileSync(path.join(inbox, 'lettera-a.pdf'), a);
        writeFileSync(path.join(inbox, 'lettera-b.pdf'), b);
        const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
        const entry = (bytes: Uint8Array, person: { code: string; iso: string }, lastName: string, firstName: string, drug: string, dosage: string, quote: string) => ({
            sha256: sha(bytes), fileName: 'lettera.pdf', documentDate: iso, documentType: 'lettera_dimissione',
            patient: { taxCode: person.code, lastName, firstName, birthDate: person.iso },
            summary: { title: 'Dimissione sintetica', text: 'Ricovero per ipertensione; dispnea da sforzo da circa due mesi.' },
            coverage: { pages: 1, unreadablePages: [], complete: true },
            facts: [
                { kind: 'diagnosis', values: { description: 'Ipertensione arteriosa essenziale',
                    ...(person.code === P ? { code: 'I10', system: 'ICD-10', proposedCode: 'BA00', proposedSystem: 'ICD-11', codeStatus: 'proposto' } : {}) },
                    quote: diagnosisQuote(person.code) },
                { kind: 'therapy', values: { drugName: drug, activePrinciple: drug.toLowerCase(), dosage, status: 'active' }, quote },
                { kind: 'therapy', values: { drugName: 'Metformina', dosage: '500 mg' }, quote: 'Metformina 500 mg due volte al giorno' },
            ],
        });
        const estrazione = path.join(root, 'estrazione.json');
        writeFileSync(estrazione, JSON.stringify({ schema: 'mediflow.dossier_prepared_extraction.v1', preparedAt: today.toISOString(), preparedBy: 'e2e', sources: [
            entry(a, personP, 'Inventata', 'Prima', 'Ramipril', '5 mg 1 cp al mattino', 'Terapia: Ramipril 5 mg 1 cp al mattino'),
            entry(b, personQ, 'Inventato', 'Secondo', 'Bisoprololo', '2,5 mg 1 cp', 'Terapia: Bisoprololo 2,5 mg 1 cp'),
        ] }));
        const ricevuta = path.join(root, 'ricevuta.json');

        const run = await operatore(isolatedRuntime.url, stato, ['dossier', '--cartella', inbox, '--estrazione', estrazione, '--ricevuta', ricevuta], credenziali);
        expect(run.code, run.stderr).toBe(0);
        const riepilogo = JSON.parse(run.stdout) as Record<string, number>;
        expect(riepilogo, readFileSync(ricevuta, 'utf8')).toMatchObject({ documenti: 2, gruppi: 2, schedeCreate: 2, schedeNonCreate: 0, gruppiBloccati: 0, gruppiDaConfermare: 0 });
        expect(run.stdout).not.toContain(P);
        expect(run.stderr).not.toContain(P);
        const esiti = (JSON.parse(readFileSync(ricevuta, 'utf8')) as { esiti: Array<{ cf4: string; scheda: string; originaliGiaPresenti: number; vociDaDecidere: number }> }).esiti;
        expect(esiti.map(esito => esito.cf4).sort()).toEqual([P.slice(-4), Q.slice(-4)].sort());
        expect(esiti.map(esito => [esito.scheda, esito.originaliGiaPresenti])).toEqual([['creata', 1], ['creata', 1]]);
        expect(esiti.every(esito => esito.vociDaDecidere > 0)).toBe(true);
        expect(readFileSync(ricevuta, 'utf8')).not.toContain(P);

        const patients = await rows(page, 'patients');
        const created = (code: string) => patients.find(patient => patient.taxCode === code);
        expect(created(P)).toBeTruthy();
        expect(created(Q)).toBeTruthy();
        for (const [code, drug] of [[P, 'Ramipril'], [Q, 'Bisoprololo']] as const) {
            const id = String(created(code)!.id);
            const attachments = (await rows(page, 'attachments', id)).filter(row => row.patientId === id);
            expect(attachments).toHaveLength(1);
            const therapies = (await rows(page, 'therapies', id)).filter(row => row.patientId === id && !row.deletedAt);
            expect(therapies.map(row => row.drugName)).toEqual([drug]);
            const entries = (await rows(page, 'entries', id)).filter(row => row.patientId === id && !row.deletedAt);
            expect(entries.map(row => row.type)).toEqual(['exam']);
        }

        const again = await operatore(isolatedRuntime.url, stato, ['dossier', '--cartella', inbox, '--estrazione', estrazione], credenziali);
        expect(again.code, again.stderr).toBe(0);
        expect(JSON.parse(again.stdout)).toMatchObject({ schedeCreate: 0, originaliSalvati: 0, fattiScritti: 0 });
        expect((await rows(page, 'patients')).length).toBe(patients.length);

        const id = String(created(P)!.id);
        await openUnlockedDocument(page, '/patients/import/dossier', PIN);
        const panel = page.getByTestId('dossier-import');
        await panel.getByLabel('Scheda', { exact: true }).selectOption(id);
        const proposed = panel.locator('[data-testid="dossier-fact"][data-kind="diagnosis"][data-origin="prepared"]')
            .filter({ hasText: 'Proposta ICD-11: BA00' });
        await expect(proposed).toHaveAttribute('data-decision', 'pending');
        await expect(proposed).toContainText('Codice nel documento: I10 · ICD-10');
        await expect(proposed.getByLabel('Codice ICD-11 da registrare')).toHaveValue('');
        await openUnlockedDocument(page, `/patients/${id}/edit`, PIN);
        await expect(page.locator('input[name="lastName"]')).toHaveValue(/^inventata$/iu);
        const codes = page.locator('input[name^="diagnoses."][name$=".code"]');
        await expect(codes).toHaveCount(0);

        const incerti = path.join(root, 'Da-verificare');
        const prepara = (gruppo: string, nome: string, bytes: Uint8Array) => {
            const directory = path.join(incerti, gruppo);
            mkdirSync(directory, { recursive: true });
            writeFileSync(path.join(directory, nome), bytes);
        };
        prepara('delegato', 'delega.pdf', await textPdf(['Delega per il ritiro.', `Riferimento: ${P}`]));
        prepara('misto', 'identificato.pdf', await letter(personQ, 'Inventato Secondo', 'Bisoprololo'));
        prepara('misto', 'senza-identita.pdf', await textPdf(['Allegato con intestazione mancante.']));
        const senzaCodice = await textPdf(['Promemoria di controllo senza anagrafica.']);
        prepara('estrazione', 'promemoria.pdf', senzaCodice);
        const proposta = syntheticPerson();
        const parziale = syntheticPerson();
        const senzaNome = await textPdf([`Codice fiscale paziente: ${parziale.code}`, `Nato il ${parziale.birth}`]);
        prepara('nome-mancante', 'fonte.pdf', senzaNome);
        writeFileSync(estrazione, JSON.stringify({ schema: 'mediflow.dossier_prepared_extraction.v1', sources: [
            entry(senzaCodice, proposta, 'Proposta', 'Terza', 'Ramipril', '5 mg', 'Ramipril'),
            entry(senzaNome, parziale, 'Proposta', 'Quarta', 'Ramipril', '5 mg', 'Ramipril'),
        ] }));
        const incerto = await operatore(isolatedRuntime.url, stato, ['dossier', '--cartella', incerti, '--estrazione', estrazione, '--ricevuta', ricevuta], credenziali);
        expect(incerto.code, incerto.stderr).toBe(0);
        expect.soft(JSON.parse(incerto.stdout), readFileSync(ricevuta, 'utf8')).toMatchObject({
            gruppiDaConfermare: 4, schedeCreate: 0, schedeAggiornate: 0, originaliSalvati: 0, fattiScritti: 0,
        });
        expect.soft((await rows(page, 'patients')).length).toBe(patients.length);
        for (const persona of [created(P)!, created(Q)!]) {
            const originali = await rows(page, 'attachments', String(persona.id));
            expect.soft(originali.filter(row => row.patientId === persona.id)).toHaveLength(1);
        }

        const audit = await page.evaluate(async () =>
            await (await fetch('/api/system/audit?eventType=auth.login.succeeded&limit=50', { cache: 'no-store' })).json() as Array<{ requestId?: string | null }>);
        expect(audit.filter(row => row.requestId?.startsWith('mfop-')).length).toBeGreaterThanOrEqual(2);

        const wrong = await operatore(isolatedRuntime.url, stato, ['accedi'], { segreto: 'Passphrase sintetica sbagliata 000', pin: PIN });
        expect(wrong.code).toBe(3);
        expect(existsSync(path.join(stato, 'credenziali-rifiutate'))).toBe(true);
        const stopped = await operatore(isolatedRuntime.url, stato, ['accedi'], credenziali);
        expect(stopped.code).toBe(3);
        expect(stopped.stderr).toContain('Operatore fermo');
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
