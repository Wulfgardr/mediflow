import test from 'node:test';
import assert from 'node:assert/strict';
import {
    AI_TASK_EXTRACTION_SCHEMA_VERSION,
    buildPatientInsightExtractionPrompt,
    buildSmartImportExtractionPrompt,
    parseDocumentSynthesisExtractionResponse,
    parsePatientInsightExtractionResponse,
    parseSmartImportExtractionResponse,
    renderPatientInsightMarkdown,
    toPatientInsightRenderContract,
} from './ai-task-contracts';

test('patient insight extraction renders local markdown sections from shared JSON contract', () => {
    const parsed = parsePatientInsightExtractionResponse(JSON.stringify({
        schemaVersion: AI_TASK_EXTRACTION_SCHEMA_VERSION,
        task: 'patient_insight',
        summary: 'BPCO stabile',
        data: {
            currentState: ['BPCO codificata e stabile [S1]'],
            alerts: ['Dispnea recente da monitorare [S2]'],
            nextSteps: ['Monitoraggio clinico [S2]'],
            gaps: [],
        },
    }));

    assert.equal(parsed.validTask, true);

    const markdown = renderPatientInsightMarkdown(toPatientInsightRenderContract(parsed.value));
    assert.match(markdown, /\*\*Quadro attuale:\*\* BPCO codificata e stabile \[S1\]/);
    assert.match(markdown, /\*\*Attenzioni:\*\*/);
    assert.match(markdown, /\*\*Prossimi passi:\*\*/);
});

test('patient insight extraction prompt enforces recency, neutral tone, and evidence discipline', () => {
    const prompt = buildPatientInsightExtractionPrompt('contesto sintetico');

    assert.match(prompt, /problema clinico o follow-up piu attuale/i);
    assert.match(prompt, /storia remota solo se cambia la gestione attuale/i);
    assert.match(prompt, /evita etichette inferite o enfatiche/i);
    assert.match(prompt, /non trasformare da soli codici storici, fattori sociali o stili di vita/i);
    assert.match(prompt, /italiano clinico neutro e non moralizzante/i);
});

test('smart import extraction keeps only valid structured suggestions', () => {
    const parsed = parseSmartImportExtractionResponse(JSON.stringify({
        schemaVersion: AI_TASK_EXTRACTION_SCHEMA_VERSION,
        task: 'smart_import',
        summary: '',
        data: {
            diagnoses: [
                {
                    label: 'Diabete mellito tipo 2',
                    icdQuery: 'type 2 diabetes mellitus',
                    confidence: 'high',
                    evidence: 'HbA1c persistente elevata',
                    sourceId: 'entry:1',
                },
            ],
            therapies: [
                {
                    drugMention: 'Metformina 500 mg',
                    drugQuery: 'metformin',
                    dosage: '500 mg x 2/die',
                    confidence: 'high',
                    evidence: 'Assume metformina 500 mg due volte al giorno',
                    sourceId: 'entry:1',
                },
                {
                    drugMention: 'Metformina 500 mg',
                    drugQuery: 'metformin',
                    dosage: '500 mg x 2/die',
                    confidence: 'medium',
                    evidence: 'Duplicato da scartare',
                    sourceId: 'entry:2',
                },
            ],
        },
    }));

    assert.equal(parsed.validTask, true);
    assert.equal(parsed.value.data.diagnoses.length, 1);
    assert.equal(parsed.value.data.therapies.length, 1);
    assert.equal(parsed.value.data.therapies[0].drugMention, 'Metformina 500 mg');
});

test('smart import prompt prioritizes current pathology coding and active therapy extraction', () => {
    const prompt = buildSmartImportExtractionPrompt({
        patientId: 'bench-smart-prompt',
        sources: [{ id: 'entry:1', kind: 'clinical-entry', label: 'VISIT', content: 'Diabete tipo 2. Metformina 500 mg x 2.' }],
    });

    assert.match(prompt, /patologie attuali, attive o rilevanti per la gestione corrente/i);
    assert.match(prompt, /fattori di rischio, stili di vita, counselling o sospetti generici/i);
    assert.match(prompt, /label deve restare in italiano clinico sintetico/i);
    assert.match(prompt, /icdQuery deve essere una query breve e specifica in inglese/i);
    assert.match(prompt, /sourceId deve coincidere esattamente con un id presente nelle fonti/i);
    assert.match(prompt, /chiave breve per ricerca catalogo AIFA/i);
    assert.match(prompt, /preferendo brand o principio attivo con strength se esplicita/i);
    assert.match(prompt, /forma compatibile con il catalogo locale AIFA/i);
    assert.match(prompt, /excerpt atomico riferito al singolo farmaco o alla singola diagnosi/i);
    assert.match(prompt, /se una terapia e solo proposta, in switch o da confermare, usa therapyState transition o uncertain/i);
    assert.match(prompt, /non marcare active una terapia futura, condizionale, da valutare/i);
    assert.match(prompt, /switch terapeutico, marca come transition sia il farmaco in uscita sia quello in ingresso/i);
});

test('document synthesis extraction falls back when model JSON is invalid', () => {
    const parsed = parseDocumentSynthesisExtractionResponse('not-json', 'Referto clinico sintetico.');

    assert.equal(parsed.validJson, false);
    assert.equal(parsed.validTask, false);
    assert.equal(parsed.value.data.qualityLevel, 'yellow');
    assert.equal(parsed.value.data.medications.length, 0);
    assert.match(parsed.value.summary, /Referto clinico sintetico/);
});

test('document synthesis extraction normalizes structured diagnoses from shared contract', () => {
    const parsed = parseDocumentSynthesisExtractionResponse(JSON.stringify({
        schemaVersion: AI_TASK_EXTRACTION_SCHEMA_VERSION,
        task: 'document_synthesis',
        summary: 'BPCO con terapia inalatoria in atto',
        data: {
            qualityLevel: 'green',
            qualityReason: 'Documento chiaro',
            medications: ['LAMA/LABA', 'LAMA/LABA'],
            diagnoses: [
                {
                    code: 'J44.9',
                    description: 'Broncopneumopatia cronica ostruttiva',
                    system: 'ICD-10',
                    evidence: 'Diagnosi esplicita nel referto',
                    confidence: 'high',
                },
            ],
        },
    }), 'testo OCR');

    assert.equal(parsed.validTask, true);
    assert.equal(parsed.value.data.medications.length, 1);
    assert.equal(parsed.value.data.diagnoses[0].system, 'ICD-10');
    assert.equal(parsed.value.data.qualityLevel, 'green');
});
