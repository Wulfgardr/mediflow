import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { jsPDF } from 'jspdf';
import { detectLaboratory, extractAnalyteUnitPairs, summarizeLabFolder } from './estrai-unita-referti.mjs';

const SCRIPT = path.join(import.meta.dirname, 'estrai-unita-referti.mjs');

function writePdf(filePath, lines) {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    doc.setFont('courier', 'normal');
    doc.setFontSize(9);
    lines.forEach((line, index) => doc.text(line, 10, 20 + index * 7));
    writeFileSync(filePath, Buffer.from(doc.output('arraybuffer')));
}

const ALFA = [
    'Laboratorio Analisi Alfa Milano        Paziente: Persona Sintetica Uno',
    'CF RSSMRA80A01F205X                    Data prelievo: 14/11/2026',
    'Glicemia             104    mg/dL           70-99 H',
    'HbA1c                48     mmol/mol        20-42 H',
    'PCR                  12,4   mg/L            0-5 H',
    'VES                  14     mm/h            0-20',
    'Neutrofili           4,2    10^9/L          1,8-7,0',
];
const BETA = [
    'Centro Diagnostico Beta',
    'Assistito: Persona Sintetica Due CF RSSMRA85T10A562S',
    'Data referto: 18/11/2026',
    'PCR                  1,24   mg/dL           0-0,5 H',
    'FT4                  15,2   pmol/l          10-22',
    'Troponina I hs       12     ng/L            0-14',
    'eGFR CKD-EPI 2021    72     mL/min/1,73m2   60-120',
    'Paziente Rossi       12     mg/dL           0-20',
];
const FORBIDDEN = ['Persona', 'Sintetica', 'Rossi', 'RSSMRA80A01F205X', 'RSSMRA85T10A562S', '14/11/2026', '18/11/2026',
    'referto-alfa', 'referto-beta', 'Mario Bianchi', '104', '12,4', '1,24', '15,2', '4,2', '70-99'];

test('the laboratory label comes only from the facility words in the same column, never from a folder or a patient line', () => {
    assert.equal(detectLaboratory(ALFA.join('\n')), 'Laboratorio Analisi Alfa Milano');
    assert.equal(detectLaboratory(BETA.join('\n')), 'Centro Diagnostico Beta');
    assert.equal(detectLaboratory('Ospedale Paziente Rossi'), 'Ospedale');
    assert.equal(detectLaboratory('REDACTED Sig. Rossi'), 'REDACTED');
    assert.equal(detectLaboratory('Referto senza intestazione\nGlicemia 90 mg/dL 70-99'), 'Laboratorio non identificato');
});

test('only (exam, unit as printed) pairs leave a report: no value, range, date, name or tax code', () => {
    assert.deepEqual(extractAnalyteUnitPairs(BETA.join('\n')), [
        { esame: 'PCR', unita: 'mg/dL' }, { esame: 'FT4', unita: 'pmol/l' }, { esame: 'Troponina I hs', unita: 'ng/L' },
        { esame: 'eGFR CKD-EPI 2021', unita: 'mL/min/1,73m2' },
    ]);
});

test('a folder of synthetic PDFs is aggregated per laboratory without leaking file or folder names', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mediflow-lab-units-'));
    try {
        const patientFolder = path.join(dir, 'Mario Bianchi');
        mkdirSync(patientFolder);
        writePdf(path.join(patientFolder, 'referto-alfa-01.pdf'), ALFA);
        writePdf(path.join(dir, 'referto-alfa-02.pdf'), ALFA);
        writePdf(path.join(dir, 'referto-beta-01.pdf'), BETA);
        writeFileSync(path.join(dir, 'referto-rotto.pdf'), 'non un pdf');
        const stdout = execFileSync(process.execPath, [SCRIPT, dir, '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        const markdown = execFileSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        for (const forbidden of FORBIDDEN) {
            assert.equal(stdout.includes(forbidden), false, `json: ${forbidden}`);
            assert.equal(markdown.includes(forbidden), false, `markdown: ${forbidden}`);
        }
        const summary = JSON.parse(stdout);
        assert.deepEqual([summary.fileTrovati, summary.fileLetti + summary.fileNonLeggibili], [4, 4]);
        assert.deepEqual(summary.laboratori, [
            { laboratorio: 'Centro Diagnostico Beta', coppie: [
                { esame: 'eGFR CKD-EPI 2021', unita: 'mL/min/1,73m2', occorrenze: 1 },
                { esame: 'FT4', unita: 'pmol/l', occorrenze: 1 },
                { esame: 'PCR', unita: 'mg/dL', occorrenze: 1 },
                { esame: 'Troponina I hs', unita: 'ng/L', occorrenze: 1 },
            ] },
            { laboratorio: 'Laboratorio Analisi Alfa Milano', coppie: [
                { esame: 'Glicemia', unita: 'mg/dL', occorrenze: 2 },
                { esame: 'HbA1c', unita: 'mmol/mol', occorrenze: 2 },
                { esame: 'Neutrofili', unita: '10^9/L', occorrenze: 2 },
                { esame: 'PCR', unita: 'mg/L', occorrenze: 2 },
                { esame: 'VES', unita: 'mm/h', occorrenze: 2 },
            ] },
        ]);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('the same summary comes from the bundled PDF reader when pdftotext is missing', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mediflow-lab-units-'));
    try {
        writePdf(path.join(dir, 'referto.pdf'), ALFA);
        const env = { ...process.env, PATH: path.dirname(process.execPath) };
        const summary = JSON.parse(execFileSync(process.execPath, [SCRIPT, dir, '--json'], { encoding: 'utf8', env }));
        assert.equal(summary.fileLetti, 1);
        assert.deepEqual(summary.laboratori.map((entry) => [entry.laboratorio, entry.coppie.length]), [['Laboratorio Analisi Alfa Milano', 5]]);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('a reader failure counts the file and says nothing else about it', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mediflow-lab-units-'));
    try {
        writeFileSync(path.join(dir, 'Persona Sintetica.pdf'), '');
        const summary = await summarizeLabFolder(dir, async () => { throw new Error('Persona Sintetica'); });
        assert.deepEqual(summary, { fileTrovati: 1, fileLetti: 0, fileNonLeggibili: 1, laboratori: [] });
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
