import test from 'node:test';
import assert from 'node:assert/strict';
import type { DocumentInsight } from '../../db';
import { auditHistoricalDiagnoses, groundDiagnosisInText, parseDiagnosisCode } from './historical-diagnosis-grounding';

// Documento sintetico: la BPCO c'è, lo scompenso sinistro (I50.1) no.
const SYNTHETIC_LETTER = [
    'Lettera di dimissione (paziente di prova)',
    'Diagnosi: riacutizzazione di BPCO in paziente con ipertensione arteriosa.',
    'Ecocardiogramma: FE conservata, non segni di disfunzione ventricolare.',
    'Terapia: tiotropio 2,5 mcg 2 puff/die.',
].join('\n');

function insight(id: string, rawMarkdown: string, diagnoses: { code: string; description: string; system?: string }[]): DocumentInsight {
    return {
        id,
        date: new Date('2026-01-10T09:00:00Z'),
        fileName: `${id}.pdf`,
        rawMarkdown,
        summary: '',
        extractedData: { diagnoses: diagnoses.map((item) => ({ system: 'ICD-10', ...item }) as never) },
    };
}

test('il controllo trova la diagnosi inventata e riconosce quella presente nel documento', () => {
    const { totals, rows } = auditHistoricalDiagnoses([{
        patientId: 'paziente-sintetico',
        insights: [insight('dimissione', SYNTHETIC_LETTER, [
            { code: 'J44.1', description: 'Broncopneumopatia cronica ostruttiva con riacutizzazione' },
            { code: 'I50.1', description: 'Insufficienza ventricolare sinistra' },
        ])],
    }]);

    assert.equal(totals.diagnoses, 2);
    assert.equal(totals.explicit, 1);
    assert.equal(totals.none, 1);
    assert.equal(totals.patientsWithNone, 1);
    const invented = rows.filter((row) => row.grounding.class === 'none');
    assert.deepEqual(invented.map((row) => row.code), ['I50.1']);
    assert.deepEqual(rows.find((row) => row.code === 'J44.1')?.grounding, { class: 'explicit', basis: 'description' });
});

test('il codice scritto nel documento basta, con punto, virgola, senza separatore o con prefisso', () => {
    for (const text of ['Dx: I50.1', 'cod. I50,1', 'ICD I501', 'diagnosi i 50.1 in anamnesi']) {
        assert.deepEqual(groundDiagnosisInText(text, { code: 'I50.1', description: 'Altro' }), { class: 'explicit', basis: 'code' }, text);
    }
    assert.deepEqual(groundDiagnosisInText('Dx: I50.1', { code: 'ICD-10: I50.1', description: '' }), { class: 'explicit', basis: 'code' });
    // Un codice diverso con la stessa categoria è un riscontro parziale, non esplicito.
    assert.deepEqual(groundDiagnosisInText('Dx: I50.9', { code: 'I50.1', description: 'Insufficienza ventricolare sinistra' }), { class: 'partial', basis: 'code_category' });
    // Il codice dentro un altro codice o un numero non conta.
    assert.equal(groundDiagnosisInText('Rif. XI50.12', { code: 'I50.1', description: '' }).class, 'none');
});

test('i codici ICD-9 solo numerici contano solo con la parte decimale', () => {
    assert.deepEqual(parseDiagnosisCode('428.0'), { stem: '428', sub: '0', numeric: true });
    assert.equal(groundDiagnosisInText('Glicemia 428 mg/dl', { code: '428', description: '' }).class, 'none');
    assert.equal(groundDiagnosisInText('Glicemia 428 mg/dl', { code: '428.0', description: '' }).class, 'none');
    assert.equal(groundDiagnosisInText('Diagnosi 428.0 alla dimissione', { code: '428.0', description: '' }).class, 'explicit');
    assert.equal(groundDiagnosisInText('Valore 1.428,0', { code: '428.0', description: '' }).class, 'none');
});

test('maiuscole, accenti, desinenze, sigle e formule ICD di comodo non nascondono il riscontro', () => {
    const cases: [string, string][] = [
        ['IPERTENSIONE ARTERIOSA ESSENZIALE', 'Ipertensione arteriosa'],
        ['insufficienza renale cronica stadio 3', 'Insufficienza renale cronico'],
        ['Paziente con IRC e DM2', 'Insufficienza renale cronica'],
        ['Paziente con IRC e DM2', 'Diabete mellito di tipo II senza menzione di complicanze'],
        ['Diabete mellito tipo 2 in trattamento', 'Diabete mellito tipo 2, non specificato'],
        ['Cardiopatia ischemica cronica (CIC)', 'CIC'],
        ['Fibrillazione atriale permanente', 'Fibrillazione atriale'],
        ['Malattia di Parkinson', 'malattìa di parkinson'],
    ];
    for (const [text, description] of cases) {
        assert.equal(groundDiagnosisInText(text, { code: '', description }).class, 'explicit', `${description} in «${text}»`);
    }
});

test('una sigla in minuscolo o un «fa» temporale non diventano diagnosi', () => {
    assert.equal(groundDiagnosisInText('come si fa ogni mattina; scatto d\'ira', { code: '', description: 'Fibrillazione atriale' }).class, 'none');
    assert.equal(groundDiagnosisInText('scatto d\'ira, umore deflesso', { code: '', description: 'Insufficienza renale acuta' }).class, 'none');
    assert.equal(groundDiagnosisInText('caduta tre anni fa, nessun esito', { code: '', description: 'Fibrillazione atriale' }).class, 'none');
    assert.equal(groundDiagnosisInText('CADUTA TRE ANNI FA, NESSUN ESITO', { code: '', description: 'Fibrillazione atriale' }).class, 'none');
    assert.equal(groundDiagnosisInText('Paziente con FA in TAO', { code: '', description: 'Fibrillazione atriale' }).class, 'explicit');
});

test('parole presenti ma sparse o solo in parte danno un riscontro parziale', () => {
    // Due parole su tre, vicine: almeno metà.
    assert.deepEqual(groundDiagnosisInText('Insufficienza cardiaca sinistra lieve', { code: '', description: 'Insufficienza ventricolare sinistra' }), { class: 'partial', basis: 'description_words' });
    // Una parola su tre: nessun riscontro.
    assert.equal(groundDiagnosisInText('Insufficienza renale', { code: '', description: 'Insufficienza ventricolare sinistra' }).class, 'none');
    // Tutte presenti ma lontane fra loro nel documento.
    const far = `Anemia ${'riga di testo clinico qualunque '.repeat(10)} sideropenica`;
    assert.equal(groundDiagnosisInText(far, { code: '', description: 'Anemia sideropenica' }).class, 'partial');
});

test('un documento senza testo si conta a parte e le voci vuote non si contano', () => {
    const { totals } = auditHistoricalDiagnoses([
        { patientId: 'a', insights: [insight('vuoto', '  \n ', [{ code: 'E11.9', description: 'Diabete mellito tipo 2' }])] },
        { patientId: 'b', insights: [insight('nulla', 'Visita di controllo', [{ code: '', description: '' }])] },
        { patientId: 'c', insights: [] },
    ]);
    assert.equal(totals.noText, 1);
    assert.equal(totals.diagnoses, 1);
    assert.equal(totals.emptySkipped, 1);
    assert.equal(totals.patientsWithDiagnoses, 1);
    assert.equal(totals.patientsWithNone, 0);
    assert.equal(totals.insights, 2);
    assert.equal(totals.insightsWithDiagnoses, 1);
});
