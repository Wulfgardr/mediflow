import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { extractAnyDocLocalBytes } from './anydoc-local-extraction-runner';
import { splitDossierUnits } from './dossier-import';
import {
    anchorPreparedQuote,
    preparedDossierFacts,
    preparedFactEligible,
    type PreparedFactInput,
    type PreparedSource,
} from './dossier-prepared';
import { anchorTabularQuote, extractMarkdownTableRows } from './dossier-tabular-quote';

const NOW = new Date('2026-11-24T12:00:00.000Z');
const CF_A = 'RSSMRA80A01F205X';
const CF_B = 'VRDLCU65C52F205K';
const CF_C = 'NRINMR68D45F205P';
const CF_D = 'BNCGPP75B12F205Z';

function buildSyntheticPdf(streamContent: string): Buffer {
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [4 0 R] /Count 1 >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>',
        `<< /Length ${Buffer.byteLength(streamContent, 'latin1')} >>\nstream\n${streamContent}\nendstream`,
    ];
    let out = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((object, index) => {
        offsets.push(Buffer.byteLength(out, 'latin1'));
        out += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xrefStart = Buffer.byteLength(out, 'latin1');
    out += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
    for (let i = 1; i < offsets.length; i += 1) {
        out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    out += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
}

function pdfEscape(value: string): string {
    return value.replace(/\\/gu, '\\\\').replace(/\(/gu, '\\(').replace(/\)/gu, '\\)');
}

function pdfTextOp(x: number, y: number, value: string, size = 9): string {
    return `BT /F1 ${size} Tf ${x} ${y} Td (${pdfEscape(value)}) Tj ET\n`;
}

function pdfRectOp(x: number, y: number, w: number, h: number): string {
    return `${x} ${y} ${w} ${h} re S\n`;
}

function resolvePdfToText(): string {
    if (existsSync('/opt/homebrew/bin/pdftotext')) return '/opt/homebrew/bin/pdftotext';
    return 'pdftotext';
}

function extractKitText(pdfBytes: Buffer, name: string): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mediflow-promemoria-'));
    try {
        const filePath = path.join(dir, `${name}.pdf`);
        writeFileSync(filePath, pdfBytes);
        return execFileSync(resolvePdfToText(), ['-layout', filePath, '-'], { encoding: 'utf8', timeout: 30_000 });
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

function literalQuoteFrom(text: string, startNeedle: string, endNeedle: string): string {
    const start = text.indexOf(startNeedle);
    assert.ok(start >= 0, `start needle missing: ${startNeedle}`);
    const end = text.indexOf(endNeedle, start);
    assert.ok(end >= 0, `end needle missing: ${endNeedle}`);
    const quote = text.slice(start, end + endNeedle.length);
    assert.ok(text.includes(quote));
    return quote;
}

interface SyntheticPromemoria {
    name: string;
    cf: string;
    pdf: Buffer;
    makeFacts: (kitText: string) => PreparedFactInput[];
}

function buildFiveSyntheticPromemoria(): SyntheticPromemoria[] {
    const p1 = (() => {
        let s = '0.5 w\n';
        s += pdfTextOp(40, 810, "PROMEMORIA PER L'ASSISTITO - SISTEMA TS / SISS", 11);
        s += pdfRectOp(40, 750, 300, 45) + pdfRectOp(340, 750, 215, 45);
        s += pdfTextOp(45, 782, "COGNOME E NOME DELL'ASSISTITO", 7) + pdfTextOp(45, 764, 'ROSSI MARIO', 10);
        s += pdfTextOp(345, 782, 'CODICE FISCALE', 7) + pdfTextOp(345, 764, CF_A, 10);
        s += pdfRectOp(40, 705, 180, 45) + pdfRectOp(220, 705, 160, 45) + pdfRectOp(380, 705, 175, 45);
        s += pdfTextOp(45, 737, 'CODICE ESENZIONE', 7) + pdfTextOp(45, 719, '031 - IPERTENSIONE', 9);
        s += pdfTextOp(225, 737, 'TIPO RICETTA', 7) + pdfTextOp(225, 719, 'FARMACEUTICA SSN', 9);
        s += pdfTextOp(385, 737, 'DATA COMPILAZIONE', 7) + pdfTextOp(385, 719, '20/11/2026', 9);
        s += pdfRectOp(40, 680, 360, 20) + pdfRectOp(400, 680, 55, 20) + pdfRectOp(455, 680, 100, 20);
        s += pdfTextOp(45, 686, 'PRESCRIZIONE', 8) + pdfTextOp(405, 686, 'QTA', 8) + pdfTextOp(460, 686, 'CODICE AIC', 8);
        s += pdfRectOp(40, 640, 360, 40) + pdfRectOp(400, 640, 55, 40) + pdfRectOp(455, 640, 100, 40);
        s += pdfTextOp(45, 666, 'BISOPROLOLO 2,5 MG 28 COMPRESSE RIVESTITE', 9);
        s += pdfTextOp(45, 650, 'Posologia: 1 compressa al mattino', 8);
        s += pdfTextOp(420, 666, '2', 9) + pdfTextOp(460, 666, '036512018', 9);
        s += pdfRectOp(40, 600, 360, 40) + pdfRectOp(400, 600, 55, 40) + pdfRectOp(455, 600, 100, 40);
        s += pdfTextOp(45, 626, 'FUROSEMIDE 25 MG 30 COMPRESSE', 9);
        s += pdfTextOp(45, 610, 'Posologia: 1 compressa ore 8', 8);
        s += pdfTextOp(420, 626, '1', 9) + pdfTextOp(460, 626, '021456011', 9);
        return {
            name: 'promemoria-01-siss-boxed',
            cf: CF_A,
            pdf: buildSyntheticPdf(s),
            makeFacts: (kitText: string): PreparedFactInput[] => [
                { kind: 'exemption', values: { code: '031' }, quote: literalQuoteFrom(kitText, '031 - IPERTENSIONE', '20/11/2026') },
                { kind: 'therapy', values: { drugName: 'Bisoprololo', dosage: '2,5 mg', status: 'active' }, quote: literalQuoteFrom(kitText, 'BISOPROLOLO 2,5 MG', 'al mattino') },
                { kind: 'therapy', values: { drugName: 'Furosemide', dosage: '25 mg', status: 'active' }, quote: literalQuoteFrom(kitText, 'FUROSEMIDE 25 MG', '021456011') },
            ],
        };
    })();

    const p2 = (() => {
        let s = '0.5 w\n';
        s += pdfTextOp(40, 815, 'SERVIZIO SANITARIO NAZIONALE - REGIONE LOMBARDIA', 10);
        s += pdfTextOp(40, 802, "PROMEMORIA PER L'ASSISTITO - RICETTA ELETTRONICA", 10);
        s += pdfRectOp(40, 745, 260, 45) + pdfRectOp(300, 745, 255, 45);
        s += pdfTextOp(45, 778, "COGNOME E NOME DELL'ASSISTITO", 7) + pdfTextOp(45, 760, 'VERDI LUCIA', 9);
        s += pdfTextOp(305, 778, 'CODICE FISCALE ASSISTITO', 7) + pdfTextOp(305, 760, CF_B, 9);
        s += pdfRectOp(40, 700, 170, 45) + pdfRectOp(210, 700, 170, 45) + pdfRectOp(380, 700, 175, 45);
        s += pdfTextOp(45, 732, 'ESENZIONE', 7) + pdfTextOp(45, 714, '013 - DIABETE MELLITO', 8);
        s += pdfTextOp(215, 732, 'CODICE DIAGNOSI', 7) + pdfTextOp(215, 714, 'E11.9', 8);
        s += pdfTextOp(385, 732, 'DATA COMPILAZIONE', 7) + pdfTextOp(385, 714, '20/11/2026', 8);
        s += '40 685 m 555 685 l S\n';
        s += pdfTextOp(45, 672, 'COD. AIC', 8) + pdfTextOp(115, 672, 'FARMACO / PRINCIPIO ATTIVO', 8) + pdfTextOp(375, 672, 'CONFEZIONI', 8) + pdfTextOp(445, 672, 'NOTA / POSOLOGIA', 8);
        s += '40 666 m 555 666 l S\n';
        s += pdfTextOp(45, 652, '034112028', 8) + pdfTextOp(115, 652, 'METFORMINA TEVA 1000 MG 60 CPR', 8) + pdfTextOp(395, 652, '2', 8) + pdfTextOp(445, 652, '1 cp a pranzo', 8);
        s += pdfTextOp(115, 640, 'Principio attivo: METFORMINA CLORIDRATO', 7) + pdfTextOp(445, 640, 'e 1 cp a cena', 8);
        s += '40 632 m 555 632 l S\n';
        s += pdfTextOp(45, 618, '041223015', 8) + pdfTextOp(115, 618, 'EMPAGLIFLOZIN 10 MG 28 CPR RIV', 8) + pdfTextOp(395, 618, '1', 8) + pdfTextOp(445, 618, 'Nota 100', 8);
        s += pdfTextOp(115, 606, 'JARDIANCE 10 MG', 7) + pdfTextOp(445, 606, '1 cp al mattino', 8);
        s += '40 598 m 555 598 l S\n';
        return {
            name: 'promemoria-02-siss-wrapped-drugs',
            cf: CF_B,
            pdf: buildSyntheticPdf(s),
            makeFacts: (kitText: string): PreparedFactInput[] => [
                { kind: 'exemption', values: { code: '013' }, quote: literalQuoteFrom(kitText, '013 - DIABETE MELLITO', '20/11/2026') },
                { kind: 'diagnosis', values: { description: 'Diabete mellito', code: 'E11.9', system: 'ICD-10' }, quote: literalQuoteFrom(kitText, '013 - DIABETE MELLITO', '20/11/2026') },
                { kind: 'therapy', values: { drugName: 'Metformina Teva', dosage: '1000 mg', status: 'active' }, quote: literalQuoteFrom(kitText, '034112028', 'e 1 cp a cena') },
                { kind: 'therapy', values: { drugName: 'Empagliflozin', dosage: '10 mg', status: 'active' }, quote: literalQuoteFrom(kitText, '041223015', 'Nota 100') },
            ],
        };
    })();

    const p3 = (() => {
        let s = '0.5 w\n';
        s += pdfTextOp(40, 815, "PROMEMORIA PER L'ASSISTITO - RICETTA SPECIALISTICA SSN", 10);
        s += pdfRectOp(40, 745, 290, 55);
        s += pdfTextOp(45, 788, "COGNOME E NOME DELL'ASSISTITO", 7) + pdfTextOp(45, 772, 'NERI ANNA MARIA', 9) + pdfTextOp(45, 756, 'Via Milano 10 - 20100 MILANO (MI)', 8);
        s += pdfRectOp(330, 772, 225, 28) + pdfTextOp(335, 790, 'NRE', 7) + pdfTextOp(365, 778, '0300A 2000001234', 9);
        s += pdfRectOp(330, 745, 225, 27) + pdfTextOp(335, 762, 'CODICE FISCALE', 7) + pdfTextOp(335, 750, CF_C, 9);
        s += pdfRectOp(40, 705, 160, 40) + pdfRectOp(200, 705, 240, 40) + pdfRectOp(440, 705, 115, 40);
        s += pdfTextOp(45, 733, 'ESENZIONE', 7) + pdfTextOp(45, 717, '048 - PATOLOGIA ONCOLOGICA', 8);
        s += pdfTextOp(205, 733, 'QUESITO DIAGNOSTICO', 7) + pdfTextOp(205, 717, 'Controllo follow-up neoplasia', 8) + pdfTextOp(205, 708, 'tiroidea in terapia sostitutiva', 8);
        s += pdfTextOp(445, 733, 'PRIORITA / DATA', 7) + pdfTextOp(445, 717, 'Classe P', 8) + pdfTextOp(445, 708, '20/11/2026', 8);
        const cols = [40, 105, 430, 480, 555];
        const rows = [695, 675, 640, 605, 570, 535];
        for (let r = 0; r < rows.length - 1; r += 1) {
            for (let c = 0; c < cols.length - 1; c += 1) {
                s += pdfRectOp(cols[c], rows[r + 1], cols[c + 1] - cols[c], rows[r] - rows[r + 1]);
            }
        }
        s += pdfTextOp(44, 681, 'CODICE', 8) + pdfTextOp(109, 681, 'DESCRIZIONE PRESTAZIONE', 8) + pdfTextOp(436, 681, 'QTA', 8) + pdfTextOp(484, 681, 'NOTE', 8);
        s += pdfTextOp(44, 658, '88.71.4', 8) + pdfTextOp(109, 658, 'ECOGRAFIA DEL CAPO E DEL COLLO TIROIDEA', 8) + pdfTextOp(445, 658, '1', 8) + pdfTextOp(484, 658, 'Controllo', 8);
        s += pdfTextOp(109, 646, 'Con sonda lineare ad alta frequenza', 7) + pdfTextOp(484, 646, 'annuale', 7);
        s += pdfTextOp(44, 623, '89.7A.8', 8) + pdfTextOp(109, 623, 'VISITA ENDOCRINOLOGICA DI CONTROLLO', 8) + pdfTextOp(445, 623, '1', 8) + pdfTextOp(484, 623, 'Confronto', 8);
        s += pdfTextOp(109, 611, 'Portare esami precedenti', 7) + pdfTextOp(484, 611, 'precedenti', 7);
        s += pdfTextOp(44, 588, '90.62.2', 8) + pdfTextOp(109, 588, 'EMOCROMO COMPLETO CON FORMULA', 8) + pdfTextOp(445, 588, '1', 8) + pdfTextOp(484, 588, 'A digiuno', 8);
        s += pdfTextOp(44, 553, '90.42.1', 8) + pdfTextOp(109, 553, 'TIREOTROPINA RIFLESSA TSH', 8) + pdfTextOp(445, 553, '1', 8) + pdfTextOp(484, 553, 'A digiuno', 8);
        return {
            name: 'promemoria-03-siss-specialistica',
            cf: CF_C,
            pdf: buildSyntheticPdf(s),
            makeFacts: (kitText: string): PreparedFactInput[] => [
                { kind: 'exemption', values: { code: '048' }, quote: literalQuoteFrom(kitText, '048 - PATOLOGIA ONCOLOGICA', '20/11/2026') },
                { kind: 'diagnosis', values: { description: 'neoplasia tiroidea' }, quote: literalQuoteFrom(kitText, 'Controllo follow-up neoplasia', 'terapia sostitutiva') },
                { kind: 'service_prescription', values: { serviceName: 'Ecografia del capo e del collo tiroidea', category: 'imaging', requestReference: '88.71.4' }, quote: literalQuoteFrom(kitText, '88.71.4', 'annuale') },
                { kind: 'service_prescription', values: { serviceName: 'Visita endocrinologica di controllo', category: 'visit', requestReference: '89.7A.8' }, quote: literalQuoteFrom(kitText, '89.7A.8', 'Confronto') },
                { kind: 'service_prescription', values: { serviceName: 'Emocromo completo con formula', category: 'lab', requestReference: '90.62.2' }, quote: literalQuoteFrom(kitText, '90.62.2', 'A digiuno') },
            ],
        };
    })();

    const p4 = (() => {
        let s = '0.5 w\n';
        s += pdfTextOp(40, 815, 'Prescrizione di farmaci a carico assistito - Ricetta Bianca Elettronica - Promemoria per il paziente', 8);
        s += pdfRectOp(40, 765, 170, 40) + pdfRectOp(210, 765, 210, 40) + pdfRectOp(420, 765, 135, 40);
        s += pdfTextOp(45, 793, 'NRBE', 7) + pdfTextOp(45, 777, 'E26000099887', 9);
        s += pdfTextOp(215, 793, 'CODICE FISCALE PAZIENTE', 7) + pdfTextOp(215, 777, CF_A, 9);
        s += pdfTextOp(425, 793, 'PIN-NRBE', 7) + pdfTextOp(425, 777, '12345', 9);
        s += pdfRectOp(40, 725, 515, 40);
        s += pdfTextOp(45, 753, 'COGNOME E NOME DEL PAZIENTE: ROSSI MARIO', 8);
        s += pdfTextOp(45, 737, 'DATA COMPILAZIONE: 20/11/2026', 8);
        s += pdfRectOp(40, 665, 430, 60) + pdfRectOp(470, 665, 85, 60);
        s += pdfTextOp(45, 712, 'PRESCRIZIONE: 038451029 - PANTOPRAZOLO 40 MG*14 CPR', 8);
        s += pdfTextOp(45, 697, 'POSOLOGIA: 1 compressa al mattino prima di colazione', 8);
        s += pdfTextOp(45, 682, 'NOTE DEL MEDICO: Uso continuativo per 28 giorni', 8);
        s += pdfTextOp(475, 712, 'QTA: 2', 8) + pdfTextOp(475, 697, 'TDL: Si', 8) + pdfTextOp(475, 682, 'Ripetibile', 8);
        s += pdfRectOp(40, 615, 430, 50) + pdfRectOp(470, 615, 85, 50);
        s += pdfTextOp(45, 650, 'PRESCRIZIONE: 042119010 - COLECALCIFEROLO 25000 UI SOLUZIONE', 8);
        s += pdfTextOp(45, 635, 'POSOLOGIA: 1 flaconcino al mese dopo i pasti', 8);
        s += pdfTextOp(475, 650, 'QTA: 1', 8) + pdfTextOp(475, 635, 'Ripetibile', 8);
        return {
            name: 'promemoria-04-rbe-boxed',
            cf: CF_A,
            pdf: buildSyntheticPdf(s),
            makeFacts: (kitText: string): PreparedFactInput[] => [
                { kind: 'therapy', values: { drugName: 'Pantoprazolo', dosage: '40 mg', status: 'active' }, quote: literalQuoteFrom(kitText, 'PRESCRIZIONE: 038451029', 'TDL: Si') },
                { kind: 'therapy', values: { drugName: 'Colecalciferolo', dosage: '25000 UI', status: 'active' }, quote: literalQuoteFrom(kitText, 'PRESCRIZIONE: 042119010', 'Ripetibile') },
            ],
        };
    })();

    const p5 = (() => {
        let s = '0.5 w\n';
        s += pdfTextOp(40, 810, 'PROMEMORIA SPECIALISTICA E FARMACEUTICA', 10);
        s += pdfTextOp(40, 792, `NRE: 0300B2000000456   CF: ${CF_D}   Data: 20/11/2026`, 9);
        s += pdfTextOp(40, 765, 'CODICE', 8) + pdfTextOp(120, 765, 'PRESTAZIONE', 8) + pdfTextOp(420, 765, 'QTA', 8) + pdfTextOp(470, 765, 'PRIORITA', 8);
        s += pdfTextOp(40, 745, '89.7A.3', 9) + pdfTextOp(120, 745, 'VISITA CARDIOLOGICA DI CONTROLLO', 9) + pdfTextOp(425, 745, '1', 9) + pdfTextOp(475, 745, 'D', 9);
        s += pdfTextOp(120, 732, 'Quesito: cardiopatia ischemica cronica', 8);
        s += pdfTextOp(40, 708, '89.52', 9) + pdfTextOp(120, 708, 'ELETTROCARDIOGRAMMA BASALE', 9) + pdfTextOp(425, 708, '1', 9) + pdfTextOp(475, 708, 'D', 9);
        s += pdfTextOp(120, 695, 'Con refertazione specialistica', 8);
        const cols = [40, 110, 405, 455, 555];
        const rows = [660, 640, 600];
        for (let r = 0; r < rows.length - 1; r += 1) {
            for (let c = 0; c < cols.length - 1; c += 1) {
                s += pdfRectOp(cols[c], rows[r + 1], cols[c + 1] - cols[c], rows[r] - rows[r + 1]);
            }
        }
        s += pdfTextOp(44, 646, 'AIC', 8) + pdfTextOp(114, 646, 'FARMACO', 8) + pdfTextOp(410, 646, 'QTA', 8) + pdfTextOp(459, 646, 'POSOLOGIA', 8);
        s += pdfTextOp(44, 624, '034812019', 8) + pdfTextOp(114, 624, 'AMOXICILLINA/AC.CLAV 875+125MG*12CPR', 8) + pdfTextOp(425, 624, '1', 8) + pdfTextOp(459, 624, '1 cp ogni 12h', 8);
        s += pdfTextOp(114, 610, 'Principio attivo: AMOXICILLINA + AC. CLAVULANICO', 7) + pdfTextOp(459, 610, 'per 7 giorni', 7);
        return {
            name: 'promemoria-05-borderless-and-aifa',
            cf: CF_D,
            pdf: buildSyntheticPdf(s),
            makeFacts: (kitText: string): PreparedFactInput[] => [
                { kind: 'service_prescription', values: { serviceName: 'Visita cardiologica di controllo', category: 'visit', requestReference: '89.7A.3' }, quote: literalQuoteFrom(kitText, '89.7A.3', 'ischemica cronica') },
                { kind: 'diagnosis', values: { description: 'cardiopatia ischemica cronica' }, quote: literalQuoteFrom(kitText, '89.7A.3', 'ischemica cronica') },
                { kind: 'service_prescription', values: { serviceName: 'Elettrocardiogramma basale', category: 'procedure', requestReference: '89.52' }, quote: literalQuoteFrom(kitText, '89.52', 'specialistica') },
                { kind: 'therapy', values: { drugName: 'AMOXICILLINA/AC.CLAV', dosage: '875+125 mg', status: 'active' }, quote: literalQuoteFrom(kitText, '034812019', 'per 7 giorni') },
            ],
        };
    })();

    return [p1, p2, p3, p4, p5];
}

function makeSource(fileName: string, sha256: string, cf: string, facts: PreparedFactInput[]): PreparedSource {
    return {
        sha256,
        fileName,
        patient: { taxCode: cf },
        documentDate: '2026-11-20',
        documentType: 'altro',
        summary: null,
        facts,
        coverage: { pages: 1, unreadablePages: [], complete: true, note: '' },
    };
}

test('WUL-926: 100% of kit-prepared quotes across 5 synthetic promemoria PDFs verify in MediFlow', async () => {
    const promemoria = buildFiveSyntheticPromemoria();
    assert.equal(promemoria.length, 5);
    const exemptionCodes = new Set(['031', '013', '048']);
    let totalFacts = 0;
    const extractedDocs: Array<{ name: string; mediflowText: string; facts: PreparedFactInput[] }> = [];

    for (const doc of promemoria) {
        const kitText = extractKitText(doc.pdf, doc.name);
        const extracted = await extractAnyDocLocalBytes(doc.name, doc.pdf);
        assert.equal(extracted.status, 'extracted', `${doc.name}: AnyDoc extraction failed`);
        if (extracted.status !== 'extracted') continue;
        const mediflowText = extracted.markdown;
        assert.ok(extractMarkdownTableRows(mediflowText).length > 0, `${doc.name}: AnyDoc must emit a Markdown table`);

        const facts = doc.makeFacts(kitText);
        extractedDocs.push({ name: doc.name, mediflowText, facts });
        const sha256 = createHash('sha256').update(doc.pdf).digest('hex');
        const source = makeSource(`${doc.name}.pdf`, sha256, doc.cf, facts);

        const kitResult = preparedDossierFacts({
            source,
            text: kitText,
            units: splitDossierUnits(kitText, null).units,
            documentDate: '2026-11-20',
            parserFacts: [],
            now: NOW,
        });
        const mediflowResult = preparedDossierFacts({
            source,
            text: mediflowText,
            units: splitDossierUnits(mediflowText, null).units,
            documentDate: '2026-11-20',
            parserFacts: [],
            now: NOW,
        });

        assert.equal(kitResult.facts.length, facts.length);
        assert.equal(mediflowResult.facts.length, facts.length);
        for (let i = 0; i < facts.length; i += 1) {
            totalFacts += 1;
            assert.equal(kitResult.facts[i].values.preparedCheck, 'verified', `${doc.name}[${i}] kit check`);
            assert.equal(mediflowResult.facts[i].values.preparedCheck, 'verified', `${doc.name}[${i}] MediFlow check`);
            assert.equal(preparedFactEligible(mediflowResult.facts[i], exemptionCodes), true, `${doc.name}[${i}] eligible`);
        }
    }
    assert.equal(totalFacts, 18);

    for (let i = 0; i < extractedDocs.length; i += 1) {
        const target = extractedDocs[i];
        const donor = extractedDocs[(i + 1) % extractedDocs.length];
        const targetUnits = splitDossierUnits(target.mediflowText, null).units;
        for (const foreignFact of donor.facts) {
            assert.equal(
                anchorPreparedQuote(target.mediflowText, targetUnits, foreignFact.quote ?? ''),
                null,
                `foreign quote from ${donor.name} must not match ${target.name}`,
            );
        }
    }
});

test('WUL-926: tabular matcher unit behavior on cell interleaving, partial visual lines, escaped pipes, and multi-unit preference', () => {
    const tableDoc = [
        '|CODICE AIC|DESCRIZIONE FARMACO|QTA|NOTE AIFA|',
        '|---|---|---|---|',
        '|034812019|RAMIPRIL 5 MG 28 COMPRESSE 1 compressa al mattino|2|Fascia A\\|Rinnovo|',
        '|029445022|METFORMINA 500 MG 30 COMPRESSE 1 compressa dopo cena|2|Fascia A|',
    ].join('\n');
    const { units } = splitDossierUnits(tableDoc, null);

    const completeQuote = [
        '034812019       RAMIPRIL 5 MG 28 COMPRESSE              2    Fascia A',
        '                1 compressa al mattino                       Rinnovo',
    ].join('\n');
    const completeMatch = anchorTabularQuote(tableDoc, units, completeQuote);
    assert.equal(completeMatch?.match, 'exact');
    assert.equal(completeMatch?.complete, true);
    assert.equal(completeMatch?.evidence.excerpt, '034812019|RAMIPRIL 5 MG 28 COMPRESSE 1 compressa al mattino|2|Fascia A\\|Rinnovo');

    const singleSpaceComplete = [
        '034812019 RAMIPRIL 5 MG 28 COMPRESSE 2 Fascia A',
        '1 compressa al mattino Rinnovo',
    ].join('\n');
    assert.equal(anchorTabularQuote(tableDoc, units, singleSpaceComplete)?.complete, true);

    const visualLineQuote = '034812019       RAMIPRIL 5 MG 28 COMPRESSE              2    Fascia A';
    const visualMatch = anchorTabularQuote(tableDoc, units, visualLineQuote);
    assert.equal(visualMatch?.match, 'exact');
    assert.equal(visualMatch?.complete, false);
    assert.equal(visualMatch?.words.includes('mattino'), true);

    const multiPage = [
        '## Pagina 1',
        '|CODICE|DESCRIZIONE|QTA|',
        '|---|---|---|',
        '|034812019|RAMIPRIL 5 MG 28 COMPRESSE 1 cp al mattino|2|',
        '## Pagina 2',
        '|CODICE|DESCRIZIONE|QTA|',
        '|---|---|---|',
        '|034812019|RAMIPRIL 5 MG 28 COMPRESSE|2|',
    ].join('\n');
    const pageUnits = splitDossierUnits(multiPage, 2).units;
    const preferred = anchorTabularQuote(multiPage, pageUnits, '034812019   RAMIPRIL 5 MG 28 COMPRESSE   2');
    assert.equal(preferred?.complete, true);
    assert.equal(preferred?.evidence.unit, 2);
});

test('WUL-926: counterexamples stay unverified and ineligible', () => {
    const tableDoc = [
        '# PROMEMORIA SISS',
        '|CODICE AIC|DESCRIZIONE FARMACO|QTA|NOTE AIFA|',
        '|---|---|---|---|',
        '|034812019|RAMIPRIL 5 MG 28 COMPRESSE 1 compressa al mattino|2|Fascia A|',
        '|029445022|METFORMINA 500 MG 30 COMPRESSE 1 compressa dopo cena|2|Fascia A|',
        '|036512018|BISOPROLOLO 2,5 MG 28 COMPRESSE sospeso per bradicardia|1|Nota 13|',
        '|041112099|Il paziente non assume WARFARIN 5 MG da anni|1|Note|',
    ].join('\n');
    const { units } = splitDossierUnits(tableDoc, null);

    const rejectedQuotes = [
        '034812019       ENALAPRIL 5 MG 28 COMPRESSE             2    Fascia A',
        '034812019       RAMIPRIL 5 MG 28 COMPRESSE              2    Fascia B',
        '034812019       RAMIPRIL 10 MG 28 COMPRESSE             2    Fascia A',
        '036512018       BISOPROLOLO 25 MG 28 COMPRESSE          1    Nota 13',
        '036512018       BISOPROLOLO 2.5 MG 28 COMPRESSE         1    Nota 13',
        '034812019       RAMIPRIL 500 MG 30 COMPRESSE            2    Fascia A',
        '034812019       RAMIPRIL 5 MG 28 COMPRESSE              2    Fascia A\n                1 compressa dopo cena',
        '034812019       METFORMINA 500 MG 30 COMPRESSE          2    Fascia A',
        '038451029       PANTOPRAZOLO 40 MG 14 COMPRESSE         2    Ripetibile',
        '041112099       Il paziente assume WARFARIN 5 MG da anni     1    Note',
        '041112099       Il paziente   assume WARFARIN 5 MG da anni   1    Note',
        '041112099       Il paziente\nassume WARFARIN 5 MG da anni   1    Note',
        '034812019 RAMIPRIL 2 Fascia A',
        'Fascia A        2               RAMIPRIL 5 MG 28 COMPRESSE',
    ];

    for (const badQuote of rejectedQuotes) {
        assert.equal(anchorPreparedQuote(tableDoc, units, badQuote), null, `must reject: ${badQuote}`);
    }

    const facts: PreparedFactInput[] = [
        { kind: 'therapy', values: { drugName: 'Ramipril', dosage: '10 mg', status: 'active' }, quote: '034812019       RAMIPRIL 5 MG 28 COMPRESSE              2    Fascia A' },
        { kind: 'therapy', values: { drugName: 'Ramipril', dosage: '2 mg', status: 'active' }, quote: '034812019       RAMIPRIL                                2    Fascia A' },
        { kind: 'therapy', values: { drugName: 'Bisoprololo', dosage: '2,5 mg', status: 'active' }, quote: '036512018       BISOPROLOLO 2,5 MG 28 COMPRESSE         1    Nota 13' },
        { kind: 'therapy', values: { drugName: 'Warfarin', dosage: '5 mg', status: 'active' }, quote: '041112099       WARFARIN 5 MG da anni                   1    Note' },
        { kind: 'anamnesis', values: { text: '036512018       BISOPROLOLO 2,5 MG 28 COMPRESSE         1    Nota 13' } },
    ];
    const source = makeSource('controesempi.pdf', 'b'.repeat(64), CF_A, facts);
    const result = preparedDossierFacts({ source, text: tableDoc, units, documentDate: '2026-11-20', parserFacts: [], now: NOW });
    assert.deepEqual(
        result.facts.map((fact) => [fact.values.preparedCheck, fact.negated, preparedFactEligible(fact, new Set())]),
        [
            ['value_missing', false, false],
            ['value_missing', false, false],
            ['status_conflict', false, false],
            ['verified', true, false],
            ['paraphrase', false, false],
        ],
    );
});

test('WUL-926: non-tabular documents keep main behavior unchanged', () => {
    const proseLetter = [
        '# Lettera di dimissione',
        `Paziente: Mario Rossi, codice fiscale ${CF_A}`,
        'Terapia: Ramipril 5 mg 28 compresse al mattino, Metformina 500 mg dopo cena.',
        'Glucosio | 93 | mg/dL | 70-100',
        'Creatinina | 1,1 | mg/dL | 0,7-1,2',
    ].join('\n');
    const { units } = splitDossierUnits(proseLetter, null);

    assert.equal(extractMarkdownTableRows(proseLetter).length, 0);
    assert.equal(anchorTabularQuote(proseLetter, units, 'Ramipril 5 mg   al mattino'), null);
    assert.equal(anchorPreparedQuote(proseLetter, units, 'Ramipril 5 mg   al mattino'), null);
    assert.equal(anchorPreparedQuote(proseLetter, units, 'Glucosio   mg/dL   70-100'), null);
    assert.equal(anchorPreparedQuote(proseLetter, units, 'Glucosio 93 mg/dL 70-100')?.match, 'exact');
    assert.equal(anchorPreparedQuote(proseLetter, units, 'Ramipril 5 mg 28 compresse al mattino')?.match, 'exact');
});
