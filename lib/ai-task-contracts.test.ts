import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    AI_TASK_EXTRACTION_SCHEMA_VERSION,
    buildDocumentSynthesisExtractionPrompt,
    buildPatientInsightExtractionPrompt,
    buildSmartImportExtractionPrompt,
    detectModernEnvelopeEvidence,
    extractJsonObject,
    isEnvelopeUsable,
    parseDocumentSynthesisExtractionResponse,
    parsePatientInsightExtractionResponse,
    parseSmartImportExtractionResponse,
    renderPatientInsightMarkdown,
    toPatientInsightRenderContract,
} from './ai-task-contracts';
import {
    buildDocumentSynthesisExtractionPrompt as buildDocumentSynthesisPromptDirect,
    buildSmartImportExtractionPrompt as buildSmartImportPromptDirect,
} from './ai-task-contract-prompts';

/* @Codex WUL-362 R5: il contatore misura visite di caratteri, non tempo. */
test('fragment scan bounds character visits for many unclosed openers', async () => {
    const contracts = await import('./ai-task-contracts') as unknown as {
        __testMeasureJsonFragmentScanWork?: (text: string) => {
            characterVisits: number;
            truncated: boolean;
        };
    };
    const measure = contracts.__testMeasureJsonFragmentScanWork;
    assert.equal(typeof measure, 'function');
    if (!measure) return;

    const openerCount = 4096;
    const measured = measure('{'.repeat(openerCount));
    assert.equal(measured.truncated, true);
    assert.ok(
        measured.characterVisits <= openerCount * 3,
        `expected at most ${openerCount * 3} visits, got ${measured.characterVisits}`,
    );
});

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
    assert.match(prompt, /seconda frase di currentState solo se aggiunge un secondo fatto clinico attuale/i);
    assert.match(prompt, /se diario o documenti recenti descrivono un episodio acuto, una dimissione o un percorso riabilitativo/i);
    assert.match(prompt, /storia remota solo se cambia la gestione attuale/i);
    assert.match(prompt, /non combinare nel currentState il problema attuale con comorbidita croniche/i);
    assert.match(prompt, /non citare diagnosi codificate o terapie attive di sfondo solo perche presenti nel contesto/i);
    assert.match(prompt, /se non esistono alert reali o di sicurezza, lascia alerts vuoto/i);
    assert.match(prompt, /currentState descrive il quadro clinico attuale e il follow-up immediato, non deve assorbire alert di sicurezza o monitoraggio attivo/i);
    assert.match(prompt, /gaps massimo 1 elemento e solo se utile/i);
    assert.match(prompt, /gaps solo per informazioni mancanti che limitano interpretazione, priorita o decisione clinica attuale/i);
    assert.match(prompt, /usa alerts per peggioramento recente, valori chiaramente anomali, sospensione o stop temporaneo di terapia/i);
    assert.match(prompt, /nei documenti recenti di dimissione, PS o riabilitazione, tratta mobilita ridotta, ausili, ADI\/FKT e recupero funzionale/i);
    assert.match(prompt, /se valori recenti o controlli pendenti riguardano una cronica attiva, mantieni esplicita la patologia nel currentState/i);
    assert.match(prompt, /nei casi post-dimissione, post-PS o riabilitativi non riportare in nextSteps diagnosi o terapie croniche di sfondo/i);
    assert.match(prompt, /nei casi post-dimissione o riabilitativi, usa alerts per limiti funzionali, deambulatore, mobilita ridotta o recupero da rivalutare/i);
    assert.match(prompt, /se un contenuto segnala rischio o richiede sorveglianza ravvicinata, mettilo in alerts/i);
    assert.match(prompt, /se alerts e vuoto, ricontrolla che currentState e nextSteps non stiano nascondendo/i);
    assert.match(prompt, /nextSteps deve contenere azioni, controlli o verifiche/i);
    assert.match(prompt, /lascia gaps vuoto se il caso e gia interpretabile e i prossimi passi sono gia chiari/i);
    assert.match(prompt, /in gaps privilegia aderenza, risposta a terapia, andamento funzionale, sintomi non rivalutati o dati che mancano per leggere il problema attuale/i);
    assert.match(prompt, /non usare gaps per duplicare nextSteps, per elencare dati mancanti ovvi o per riempire spazio/i);
    assert.match(prompt, /non scrivere frasi rassicuranti o boilerplate come nessuna criticita/i);
    assert.match(prompt, /hard fail interno: se anche una sola stringa non contiene \[Sx\] o \[DATI-INCOMPLETI\]/i);
    assert.match(prompt, /mantieni sempre i marker \[Sx\] anche quando riassumi piu fatti clinici/i);
    assert.match(prompt, /non usare placeholder come \[Sx\], \[S\?\] o riferimenti generici/i);
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

/* @Codex */
test('smart import extraction marks missing confidence as low', () => {
    const parsed = parseSmartImportExtractionResponse(JSON.stringify({
        schemaVersion: AI_TASK_EXTRACTION_SCHEMA_VERSION,
        task: 'smart_import',
        summary: '',
        data: {
            diagnoses: [{
                label: 'Ipertensione essenziale',
                icdQuery: 'essential hypertension',
                evidence: 'Diagnosi esplicita nel documento sintetico',
            }],
            therapies: [],
            servicePrescriptions: [],
        },
    }));

    assert.equal(parsed.value.data.diagnoses[0]?.confidence, 'low');
});

/* @Codex */
test('envelope with a mismatched task is not usable even when its JSON is valid', () => {
    const parsed = parseSmartImportExtractionResponse(JSON.stringify({
        schemaVersion: AI_TASK_EXTRACTION_SCHEMA_VERSION,
        task: 'patient_insight',
        summary: '',
        data: { diagnoses: [], therapies: [], servicePrescriptions: [] },
    }));

    assert.equal(parsed.validJson, true);
    assert.equal(parsed.validTask, false);
    assert.equal(isEnvelopeUsable(parsed), false);
});

/* @Codex: WUL-362 duplicate-key JSON fail-closed contract */
test('duplicate ASCII task keys reject both last-wins task orders', () => {
    const smartImportLast = parseSmartImportExtractionResponse(
        '{"schemaVersion":"mediflow.ai.extract.v1","task":"patient_insight","task":"smart_import","summary":"Non usare","data":{"diagnoses":[],"therapies":[],"servicePrescriptions":[]}}',
    );
    const patientInsightLast = parsePatientInsightExtractionResponse(
        '{"schemaVersion":"mediflow.ai.extract.v1","task":"smart_import","task":"patient_insight","summary":"Non usare","data":{"currentState":[],"alerts":[],"nextSteps":[],"gaps":[]}}',
    );

    for (const parsed of [smartImportLast, patientInsightLast]) {
        assert.equal(parsed.validJson, true);
        assert.equal(parsed.validTask, false);
        assert.equal(isEnvelopeUsable(parsed), false);
        assert.equal(parsed.value.summary, '');
    }
    assert.deepEqual(smartImportLast.value.data, { diagnoses: [], therapies: [], servicePrescriptions: [] });
    assert.deepEqual(patientInsightLast.value.data, { currentState: [], alerts: [], nextSteps: [], gaps: [] });
});

/* @Codex */
test('duplicate Unicode-escaped task and schemaVersion keys reject the envelope', () => {
    const duplicateTask = parsePatientInsightExtractionResponse(
        '{"schemaVersion":"mediflow.ai.extract.v1","ta\\u0073k":"smart_import","task":"patient_insight","summary":"Non usare","data":{"currentState":[],"alerts":[],"nextSteps":[],"gaps":[]}}',
    );
    const duplicateSchema = parsePatientInsightExtractionResponse(
        '{"schema\\u0056ersion":"mediflow.ai.extract.v2","schemaVersion":"mediflow.ai.extract.v1","task":"patient_insight","summary":"Non usare","data":{"currentState":[],"alerts":[],"nextSteps":[],"gaps":[]}}',
    );

    for (const parsed of [duplicateTask, duplicateSchema]) {
        assert.equal(parsed.validJson, true);
        assert.equal(parsed.validTask, false);
        assert.equal(isEnvelopeUsable(parsed), false);
        assert.equal(parsed.value.summary, '');
    }
});

/* @Codex */
test('duplicate keys reject equal values and duplicates inside data', () => {
    const equalTask = parsePatientInsightExtractionResponse(
        '{"schemaVersion":"mediflow.ai.extract.v1","task":"patient_insight","task":"patient_insight","summary":"Non usare","data":{"currentState":[],"alerts":[],"nextSteps":[],"gaps":[]}}',
    );
    const nestedData = parsePatientInsightExtractionResponse(
        '{"schemaVersion":"mediflow.ai.extract.v1","task":"patient_insight","summary":"Non usare","data":{"currentState":[],"currentState":[],"alerts":[],"nextSteps":[],"gaps":[]}}',
    );

    for (const parsed of [equalTask, nestedData]) {
        assert.equal(parsed.validJson, true);
        assert.equal(parsed.validTask, false);
        assert.equal(isEnvelopeUsable(parsed), false);
        assert.equal(parsed.value.summary, '');
        assert.deepEqual(parsed.value.data, { currentState: [], alerts: [], nextSteps: [], gaps: [] });
    }
});

/* @Codex */
test('same keys in parent, child, sibling objects, and array objects remain usable', () => {
    const parentChild = parsePatientInsightExtractionResponse(
        '{"schemaVersion":"mediflow.ai.extract.v1","task":"patient_insight","summary":"x","data":{"summary":"y","currentState":[],"alerts":[],"nextSteps":[],"gaps":[]}}',
    );
    const separateScopes = parsePatientInsightExtractionResponse(
        '{"schemaVersion":"mediflow.ai.extract.v1","task":"patient_insight","summary":"x","data":{"currentState":[],"alerts":[],"nextSteps":[],"gaps":[]},"first":{"summary":"a"},"second":{"summary":"b"},"items":[{"summary":"c"},{"summary":"d"}]}',
    );

    assert.equal(isEnvelopeUsable(parentChild), true);
    assert.equal(isEnvelopeUsable(separateScopes), true);
});

/* @Codex */
test('all task parsers reject a duplicate task key for their own envelope', () => {
    const patientInsight = parsePatientInsightExtractionResponse(
        '{"schemaVersion":"mediflow.ai.extract.v1","task":"patient_insight","task":"patient_insight","summary":"Non usare","data":{"currentState":[],"alerts":[],"nextSteps":[],"gaps":[]}}',
    );
    const smartImport = parseSmartImportExtractionResponse(
        '{"schemaVersion":"mediflow.ai.extract.v1","task":"smart_import","task":"smart_import","summary":"Non usare","data":{"diagnoses":[],"therapies":[],"servicePrescriptions":[]}}',
    );
    const documentSynthesis = parseDocumentSynthesisExtractionResponse(
        '{"schemaVersion":"mediflow.ai.extract.v1","task":"document_synthesis","task":"document_synthesis","summary":"Non usare","data":{"qualityLevel":"green","medications":[],"diagnoses":[],"problemStatements":[],"therapyCandidates":[]}}',
        'testo OCR sintetico',
    );

    for (const parsed of [patientInsight, smartImport, documentSynthesis]) {
        assert.equal(parsed.validJson, true);
        assert.equal(parsed.validTask, false);
        assert.equal(isEnvelopeUsable(parsed), false);
    }
});

/* @Codex */
test('a modern duplicate envelope never recovers through the document legacy contract', () => {
    const parsed = parseDocumentSynthesisExtractionResponse(
        '{"schemaVersion":"mediflow.ai.extract.v1","task":"document_synthesis","task":"document_synthesis","summary_markdown":"Storico","quality":{"level":"green"},"diagnoses":[]}',
        'testo OCR sintetico',
    );

    assert.equal(parsed.validJson, true);
    assert.equal(parsed.validTask, false);
    assert.equal(parsed.legacyContract, false);
    assert.equal(isEnvelopeUsable(parsed), false);
});

test('smart import extraction drops service prescriptions from therapy suggestions', () => {
    const parsed = parseSmartImportExtractionResponse(JSON.stringify({
        schemaVersion: AI_TASK_EXTRACTION_SCHEMA_VERSION,
        task: 'smart_import',
        summary: '',
        data: {
            diagnoses: [],
            therapies: [
                {
                    drugMention: 'Visita otorinolaringoiatrica',
                    drugQuery: 'visita otorinolaringoiatrica',
                    confidence: 'high',
                    evidence: 'Prescritta visita otorinolaringoiatrica di controllo',
                    sourceId: 'document:1',
                },
                {
                    drugMention: 'Amoxicillina 1 g',
                    drugQuery: 'amoxicillina 1 g',
                    activePrinciple: 'Amoxicillina',
                    dosage: '1 g ogni 12 ore',
                    confidence: 'high',
                    evidence: 'Prescritta amoxicillina 1 g ogni 12 ore',
                    sourceId: 'document:1',
                },
            ],
        },
    }));

    assert.equal(parsed.validTask, true);
    assert.equal(parsed.legacyContract, false);
    assert.equal(parsed.value.data.therapies.length, 1);
    assert.equal(parsed.value.data.therapies[0].drugMention, 'Amoxicillina 1 g');
    assert.equal(parsed.value.data.servicePrescriptions.length, 1);
    assert.equal(parsed.value.data.servicePrescriptions[0].serviceName, 'Visita otorinolaringoiatrica');
});

test('smart import extraction preserves itemized lab service prescriptions', () => {
    const parsed = parseSmartImportExtractionResponse(JSON.stringify({
        schemaVersion: AI_TASK_EXTRACTION_SCHEMA_VERSION,
        task: 'smart_import',
        summary: '',
        data: {
            diagnoses: [],
            therapies: [],
            servicePrescriptions: [
                {
                    serviceName: 'Esami ematochimici',
                    category: 'lab',
                    confidence: 'high',
                    evidence: 'Richiesti emocromo, D-dimero, LDH, AST, ALT e vitamina D',
                    sourceId: 'document:1',
                    items: [
                        { serviceName: 'EMOCROMO', category: 'lab', confidence: 'high', evidence: 'emocromo' },
                        { serviceName: 'D-DIMERO', category: 'lab', confidence: 'high', evidence: 'D-dimero' },
                        { serviceName: 'LDH', category: 'lab', confidence: 'high', evidence: 'LDH' },
                        { serviceName: 'AST', category: 'lab', confidence: 'high', evidence: 'AST' },
                        { serviceName: 'ALT', category: 'lab', confidence: 'high', evidence: 'ALT' },
                        { serviceName: 'VITAMINA D', category: 'lab', confidence: 'high', evidence: 'vitamina D' },
                    ],
                },
            ],
        },
    }));

    assert.equal(parsed.value.data.therapies.length, 0);
    assert.equal(parsed.value.data.servicePrescriptions.length, 1);
    assert.equal(parsed.value.data.servicePrescriptions[0].items?.length, 6);
    assert.equal(parsed.value.data.servicePrescriptions[0].items?.[0].serviceName, 'EMOCROMO');
});

test('smart import extraction keeps drug therapies when evidence mentions a specialist visit', () => {
    const parsed = parseSmartImportExtractionResponse(JSON.stringify({
        schemaVersion: AI_TASK_EXTRACTION_SCHEMA_VERSION,
        task: 'smart_import',
        summary: '',
        data: {
            diagnoses: [],
            therapies: [
                {
                    drugMention: 'Amoxicillina 1 g',
                    drugQuery: 'amoxicillina',
                    activePrinciple: 'Amoxicillina',
                    dosage: '1 g ogni 12 ore',
                    confidence: 'high',
                    evidence: 'Amoxicillina 1 g prescritta dopo visita ORL',
                    sourceId: 'document:1',
                },
            ],
        },
    }));

    assert.equal(parsed.validTask, true);
    assert.equal(parsed.value.data.therapies.length, 1);
    assert.equal(parsed.value.data.therapies[0].drugMention, 'Amoxicillina 1 g');
});

test('smart import extraction drops service prescriptions even when evidence contains units', () => {
    const parsed = parseSmartImportExtractionResponse(JSON.stringify({
        schemaVersion: AI_TASK_EXTRACTION_SCHEMA_VERSION,
        task: 'smart_import',
        summary: '',
        data: {
            diagnoses: [],
            therapies: [
                {
                    drugMention: 'Prelievo venoso',
                    drugQuery: 'prelievo venoso',
                    confidence: 'medium',
                    evidence: 'Richiesto prelievo venoso con provetta 5 ml',
                    sourceId: 'document:1',
                },
            ],
        },
    }));

    assert.equal(parsed.validTask, true);
    assert.equal(parsed.value.data.therapies.length, 0);
    assert.equal(parsed.value.data.servicePrescriptions.length, 1);
    assert.equal(parsed.value.data.servicePrescriptions[0].category, 'lab');
});

test('smart import extraction drops fisioterapia and rehabilitation prescriptions from therapy lane', () => {
    const parsed = parseSmartImportExtractionResponse(JSON.stringify({
        schemaVersion: AI_TASK_EXTRACTION_SCHEMA_VERSION,
        task: 'smart_import',
        summary: '',
        data: {
            diagnoses: [],
            therapies: [
                {
                    drugMention: 'Fisioterapia respiratoria',
                    drugQuery: 'fisioterapia respiratoria',
                    confidence: 'high',
                    evidence: 'Prescritta fisioterapia respiratoria 6 sedute di mantenimento',
                    sourceId: 'document:1',
                },
                {
                    drugMention: 'Riabilitazione neuromotoria',
                    drugQuery: 'riabilitazione neuromotoria',
                    confidence: 'high',
                    evidence: 'Prescritta riabilitazione neuromotoria 10 sedute ambulatoriali',
                    sourceId: 'document:1',
                },
                {
                    drugMention: 'Prestazione riabilitativa cardiologica',
                    drugQuery: 'prestazione riabilitativa cardiologica',
                    confidence: 'medium',
                    evidence: 'Richiesta prestazione riabilitativa cardiologica post-evento',
                    sourceId: 'document:1',
                },
            ],
        },
    }));

    assert.equal(parsed.validTask, true);
    assert.equal(parsed.value.data.therapies.length, 0);
    assert.equal(parsed.value.data.servicePrescriptions.length, 3);
    assert.equal(parsed.value.data.servicePrescriptions[0].category, 'rehab');
});

test('smart import extraction drops lab tests with units from therapy lane', () => {
    const parsed = parseSmartImportExtractionResponse(JSON.stringify({
        schemaVersion: AI_TASK_EXTRACTION_SCHEMA_VERSION,
        task: 'smart_import',
        summary: '',
        data: {
            diagnoses: [],
            therapies: [
                {
                    drugMention: 'Emocromo completo',
                    drugQuery: 'emocromo completo con formula',
                    confidence: 'medium',
                    evidence: 'Richiesto emocromo completo con formula leucocitaria',
                    sourceId: 'document:1',
                },
                {
                    drugMention: 'HbA1c',
                    drugQuery: 'emoglobina glicata',
                    confidence: 'medium',
                    evidence: 'Richiesta HbA1c di controllo, target 7%',
                    sourceId: 'document:1',
                },
                {
                    drugMention: 'Emoglobina glicata',
                    drugQuery: 'emoglobina glicata',
                    confidence: 'medium',
                    evidence: 'Prescritta emoglobina glicata di controllo periodico',
                    sourceId: 'document:1',
                },
            ],
        },
    }));

    assert.equal(parsed.validTask, true);
    assert.equal(parsed.value.data.therapies.length, 0);
    assert.equal(parsed.value.data.servicePrescriptions.some((item) => item.serviceName.startsWith('Emocromo completo')), true);
    assert.equal(parsed.value.data.servicePrescriptions[0].category, 'lab');
});

test('smart import extraction drops imaging and ECG with units from therapy lane', () => {
    const parsed = parseSmartImportExtractionResponse(JSON.stringify({
        schemaVersion: AI_TASK_EXTRACTION_SCHEMA_VERSION,
        task: 'smart_import',
        summary: '',
        data: {
            diagnoses: [],
            therapies: [
                {
                    drugMention: 'ECG a riposo',
                    drugQuery: 'ECG a riposo',
                    confidence: 'medium',
                    evidence: 'Richiesto ECG a riposo da eseguire entro 30 giorni',
                    sourceId: 'document:1',
                },
                {
                    drugMention: 'RX torace',
                    drugQuery: 'RX torace 2 proiezioni',
                    confidence: 'medium',
                    evidence: 'Prescritta RX torace 2 proiezioni standard',
                    sourceId: 'document:1',
                },
                {
                    drugMention: 'TC encefalo',
                    drugQuery: 'TC encefalo senza mdc',
                    confidence: 'medium',
                    evidence: 'Prescritta TC encefalo senza mdc per cefalea persistente',
                    sourceId: 'document:1',
                },
            ],
        },
    }));

    assert.equal(parsed.validTask, true);
    assert.equal(parsed.value.data.therapies.length, 0);
});

test('smart import extraction drops ecocolordoppler specialist services from therapy lane', () => {
    const parsed = parseSmartImportExtractionResponse(JSON.stringify({
        schemaVersion: AI_TASK_EXTRACTION_SCHEMA_VERSION,
        task: 'smart_import',
        summary: '',
        data: {
            diagnoses: [],
            therapies: [
                {
                    drugMention: 'Ecocolordoppler venoso arti inferiori',
                    drugQuery: 'ecocolordoppler venoso arti inferiori',
                    confidence: 'high',
                    evidence: 'Prescritta prestazione codificata: ecocolordoppler venoso arti inferiori',
                    sourceId: 'document:1',
                },
                {
                    drugMention: 'Color doppler TSA',
                    drugQuery: 'codice prestazione color doppler TSA',
                    confidence: 'medium',
                    evidence: 'Impegnativa specialistica per color doppler TSA',
                    sourceId: 'document:1',
                },
            ],
        },
    }));

    assert.equal(parsed.validTask, true);
    assert.equal(parsed.value.data.therapies.length, 0);
});

test('smart import extraction keeps drug therapy whose evidence references fisioterapia follow-up', () => {
    const parsed = parseSmartImportExtractionResponse(JSON.stringify({
        schemaVersion: AI_TASK_EXTRACTION_SCHEMA_VERSION,
        task: 'smart_import',
        summary: '',
        data: {
            diagnoses: [],
            therapies: [
                {
                    drugMention: 'Tachipirina 1000 mg',
                    drugQuery: 'paracetamolo 1000 mg',
                    activePrinciple: 'Paracetamolo',
                    dosage: '1000 mg ogni 8 ore',
                    confidence: 'high',
                    evidence: 'Tachipirina 1000 mg ogni 8 ore al bisogno; rivalutare in fisioterapia',
                    sourceId: 'document:1',
                },
            ],
        },
    }));

    assert.equal(parsed.validTask, true);
    assert.equal(parsed.value.data.therapies.length, 1);
    assert.equal(parsed.value.data.therapies[0].drugMention, 'Tachipirina 1000 mg');
});

test('document synthesis extraction filters fisioterapia and lab requests from medication and therapy lanes', () => {
    const parsed = parseDocumentSynthesisExtractionResponse(JSON.stringify({
        schemaVersion: AI_TASK_EXTRACTION_SCHEMA_VERSION,
        task: 'document_synthesis',
        summary: 'Impegnativa con prestazioni miste',
        data: {
            qualityLevel: 'green',
            qualityReason: 'Documento leggibile',
            medications: [
                'Fisioterapia respiratoria',
                'Riabilitazione neuromotoria 10 sedute',
                'Emocromo completo con formula',
                'HbA1c di controllo',
                'Amoxicillina 1 g ogni 12 ore',
            ],
            diagnoses: [],
            problemStatements: [],
            therapyCandidates: [
                {
                    drugMention: 'Fisioterapia respiratoria',
                    drugQuery: 'fisioterapia respiratoria',
                    confidence: 'high',
                    evidence: 'Prescritta fisioterapia respiratoria 6 sedute',
                },
                {
                    drugMention: 'Emocromo completo',
                    drugQuery: 'emocromo completo',
                    confidence: 'medium',
                    evidence: 'Richiesto emocromo completo con formula',
                },
                {
                    drugMention: 'Amoxicillina 1 g',
                    drugQuery: 'amoxicillina',
                    activePrinciple: 'Amoxicillina',
                    dosage: '1 g ogni 12 ore',
                    confidence: 'high',
                    evidence: 'Prescritta amoxicillina 1 g ogni 12 ore',
                },
            ],
        },
    }), 'Ricetta sintetica');

    assert.deepEqual(parsed.value.data.medications, ['Amoxicillina 1 g ogni 12 ore']);
    assert.equal(parsed.value.data.therapyCandidates.length, 1);
    assert.equal(parsed.value.data.therapyCandidates[0].drugMention, 'Amoxicillina 1 g');
    assert.equal(parsed.value.data.servicePrescriptions.length, 4);
    assert.equal(parsed.value.data.servicePrescriptions.some((item) => item.serviceName.startsWith('Emocromo completo')), true);
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
    assert.match(prompt, /prestazioni sanitarie, visite specialistiche, esami, controlli, consulenze, impegnative o referral/i);
    assert.match(prompt, /chiave breve per ricerca catalogo AIFA/i);
    assert.match(prompt, /preferendo brand o principio attivo con strength se esplicita/i);
    assert.match(prompt, /forma compatibile con il catalogo locale AIFA/i);
    assert.match(prompt, /excerpt atomico riferito al singolo farmaco o alla singola diagnosi/i);
    assert.match(prompt, /se una terapia e solo proposta, in switch o da confermare, usa therapyState transition o uncertain/i);
    assert.match(prompt, /non marcare active una terapia futura, condizionale, da valutare/i);
    assert.match(prompt, /switch terapeutico, marca come transition sia il farmaco in uscita sia quello in ingresso/i);
});

test('smart import prompt stays byte-identical through the compatible barrel', () => {
    const payload = { patientId: 'synthetic-patient', sources: [{ id: 'S1', text: 'Fixture clinica sintetica' }] };
    const prompt = buildSmartImportExtractionPrompt(payload);

    assert.equal(prompt, buildSmartImportPromptDirect(payload));
    assert.equal(Buffer.byteLength(prompt, 'utf8'), 5382);
    assert.equal(createHash('sha256').update(prompt).digest('hex'), 'e0a67ae602f10e8d5e68b4dacfca678bdca72993a0597ebfe77b9bb038c6e430');
});

/* @Codex */
test('document synthesis prompt stays byte-identical through the compatible barrel', () => {
    const rawText = 'REFERTO SINTETICO\nNessun dato reale';
    const prompt = buildDocumentSynthesisExtractionPrompt(rawText);

    assert.equal(prompt, buildDocumentSynthesisPromptDirect(rawText));
    assert.equal(Buffer.byteLength(prompt, 'utf8'), 6519);
    assert.equal(createHash('sha256').update(prompt).digest('hex'), '6f03db526863f776ac3efecaaab4730963eb3be982189a29c3b30292057a2624');
});

test('document synthesis extraction keeps service prescriptions out of medication lanes', () => {
    const parsed = parseDocumentSynthesisExtractionResponse(JSON.stringify({
        schemaVersion: AI_TASK_EXTRACTION_SCHEMA_VERSION,
        task: 'document_synthesis',
        summary: 'Impegnativa con prestazione e farmaco separati',
        data: {
            qualityLevel: 'green',
            qualityReason: 'Documento leggibile',
            medications: [
                'Visita otorinolaringoiatrica di controllo',
                'Amoxicillina 1 g ogni 12 ore',
            ],
            diagnoses: [],
            problemStatements: [],
            therapyCandidates: [
                {
                    drugMention: 'Visita otorinolaringoiatrica',
                    drugQuery: 'visita otorinolaringoiatrica',
                    confidence: 'medium',
                    evidence: 'Richiesta visita otorinolaringoiatrica',
                },
                {
                    drugMention: 'Amoxicillina 1 g',
                    drugQuery: 'amoxicillina',
                    activePrinciple: 'Amoxicillina',
                    dosage: '1 g ogni 12 ore',
                    confidence: 'high',
                    evidence: 'Prescritta amoxicillina 1 g ogni 12 ore',
                },
            ],
        },
    }), 'Ricetta sintetica');

    assert.deepEqual(parsed.value.data.medications, ['Amoxicillina 1 g ogni 12 ore']);
    assert.equal(parsed.value.data.therapyCandidates.length, 1);
    assert.equal(parsed.value.data.therapyCandidates[0].drugMention, 'Amoxicillina 1 g');
    assert.equal(parsed.value.data.servicePrescriptions.length, 1);
    assert.equal(parsed.value.data.servicePrescriptions[0].serviceName, 'Visita otorinolaringoiatrica di controllo');
});

test('document synthesis extraction keeps coded ecocolordoppler prescriptions out of medication lanes', () => {
    const parsed = parseDocumentSynthesisExtractionResponse(JSON.stringify({
        schemaVersion: AI_TASK_EXTRACTION_SCHEMA_VERSION,
        task: 'document_synthesis',
        summary: 'Impegnativa specialistica codificata',
        data: {
            qualityLevel: 'green',
            qualityReason: 'Documento leggibile',
            medications: [
                'Ecocolordoppler venoso arti inferiori',
                'Codice prestazione 88.77.2 ecocolordoppler',
                'Amoxicillina 1 g ogni 12 ore',
            ],
            diagnoses: [],
            problemStatements: [],
            therapyCandidates: [
                {
                    drugMention: 'Ecocolordoppler venoso arti inferiori',
                    drugQuery: 'ecocolordoppler venoso arti inferiori',
                    confidence: 'high',
                    evidence: 'Prescritta prestazione codificata: ecocolordoppler venoso arti inferiori',
                },
                {
                    drugMention: 'Amoxicillina 1 g',
                    drugQuery: 'amoxicillina',
                    activePrinciple: 'Amoxicillina',
                    dosage: '1 g ogni 12 ore',
                    confidence: 'high',
                    evidence: 'Prescritta amoxicillina 1 g ogni 12 ore',
                },
            ],
        },
    }), 'Ricetta sintetica');

    assert.deepEqual(parsed.value.data.medications, ['Amoxicillina 1 g ogni 12 ore']);
    assert.equal(parsed.value.data.therapyCandidates.length, 1);
    assert.equal(parsed.value.data.therapyCandidates[0].drugMention, 'Amoxicillina 1 g');
});

test('document synthesis extraction filters legacy service prescription payloads', () => {
    const parsed = parseDocumentSynthesisExtractionResponse(JSON.stringify({
        summary: 'Impegnativa con sola prestazione',
        qualityLevel: 'green',
        medications: ['Visita otorinolaringoiatrica di controllo'],
        diagnoses: [],
        therapyCandidates: [
            {
                drugMention: 'Visita otorinolaringoiatrica',
                drugQuery: 'visita otorinolaringoiatrica',
                confidence: 'medium',
                evidence: 'Richiesta visita otorinolaringoiatrica',
            },
        ],
    }), 'Ricetta sintetica');

    assert.deepEqual(parsed.value.data.medications, []);
    assert.equal(parsed.value.data.therapyCandidates.length, 0);
    assert.equal(parsed.value.data.servicePrescriptions.length, 1);
    assert.equal(parsed.value.data.qualityReason, 'Analisi completata con dati parziali');
});

test('document synthesis extraction falls back when model JSON is invalid', () => {
    const parsed = parseDocumentSynthesisExtractionResponse('not-json', 'Referto clinico sintetico.');

    assert.equal(parsed.validJson, false);
    assert.equal(parsed.validTask, false);
    assert.equal(parsed.value.data.qualityLevel, 'yellow');
    assert.equal(parsed.value.data.medications.length, 0);
    assert.equal(parsed.value.data.problemStatements.length, 0);
    assert.equal(parsed.value.data.therapyCandidates.length, 0);
    assert.match(parsed.value.summary, /Referto clinico sintetico/);
});

test('document synthesis extraction accepts legacy payloads used by historical UI mocks', () => {
    const parsed = parseDocumentSynthesisExtractionResponse(JSON.stringify({
        summary_markdown: '**Riassunto clinico:** episodio depressivo lieve con codice esplicito nel referto.',
        quality: {
            level: 'green',
            reason: 'Documento leggibile con codice ICD esplicito',
        },
        diagnoses: [
            {
                code: 'EF00',
                description: 'Disturbo depressivo maggiore, episodio singolo lieve',
                system: 'ICD-11',
                evidence: 'ICD-11 EF00',
                confidence: 'high',
            },
        ],
        medications: [],
    }), 'testo OCR legacy');

    assert.equal(parsed.validTask, true);
    assert.equal(parsed.legacyContract, true);
    assert.equal(isEnvelopeUsable(parsed), true);
    assert.equal(parsed.value.data.qualityLevel, 'green');
    assert.equal(parsed.value.data.diagnoses.length, 1);
    assert.equal(parsed.value.data.problemStatements.length, 0);
    assert.equal(parsed.value.data.therapyCandidates.length, 0);
    assert.match(parsed.value.summary, /episodio depressivo lieve/i);
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
            problemStatements: [
                {
                    label: 'BPCO riacutizzata',
                    icdQuery: 'chronic obstructive pulmonary disease exacerbation',
                    confidence: 'high',
                    evidence: 'Riacutizzazione di BPCO in trattamento',
                },
            ],
            therapyCandidates: [
                {
                    drugMention: 'Tiotropio',
                    drugQuery: 'tiotropio',
                    activePrinciple: 'tiotropio',
                    dosage: '18 mcg 1 cps/die',
                    confidence: 'high',
                    evidence: 'Tiotropio 18 mcg 1 cps/die',
                    therapyState: 'active',
                },
            ],
        },
    }), 'testo OCR');

    assert.equal(parsed.validTask, true);
    assert.equal(parsed.value.data.medications.length, 1);
    assert.equal(parsed.value.data.diagnoses[0].system, 'ICD-10');
    assert.equal(parsed.value.data.problemStatements.length, 1);
    assert.equal(parsed.value.data.problemStatements[0].label, 'BPCO riacutizzata');
    assert.equal(parsed.value.data.therapyCandidates.length, 1);
    assert.equal(parsed.value.data.therapyCandidates[0].drugMention, 'Tiotropio');
    assert.equal(parsed.value.data.qualityLevel, 'green');
});

test('document synthesis extraction repairs truncated envelope when only closing braces are missing', () => {
    const truncated = `{
  "schemaVersion": "mediflow.ai.extract.v1",
  "task": "document_synthesis",
  "summary": "Dimissione con terapia esplicita",
  "data": {
    "qualityLevel": "green",
    "qualityReason": "Documento leggibile",
    "medications": ["Humalog 4 U ai pasti principali"],
    "diagnoses": [],
    "problemStatements": [
      {
        "label": "Diabete mellito tipo 2",
        "icdQuery": "type 2 diabetes mellitus",
        "confidence": "high",
        "evidence": "Diabete mellito tipo 2"
      }
    ],
    "therapyCandidates": [
      {
        "drugMention": "Humalog",
        "drugQuery": "Humalog insulin lispro",
        "activePrinciple": "insulina lispro",
        "dosage": "4 U ai pasti principali",
        "confidence": "high",
        "evidence": "Humalog 4 U ai pasti principali",
        "therapyState": "active"
      }
    ]
  }`;

    const parsed = parseDocumentSynthesisExtractionResponse(truncated, 'testo OCR');

    assert.equal(parsed.validJson, true);
    assert.equal(parsed.validTask, true);
    assert.equal(parsed.repairedTruncation, true);
    assert.equal(parsed.value.data.medications[0], 'Humalog 4 U ai pasti principali');
    assert.equal(parsed.value.data.problemStatements[0].label, 'Diabete mellito tipo 2');
    assert.equal(parsed.value.data.therapyCandidates[0].drugMention, 'Humalog');
});

test('extractJsonObject repairs truncation inside JSON strings', () => {
    const cases = [
        '{"a":"cut',
        '{"a":"cut}',
        '{"a":"cut\\',
        '```json\n{"a":"cut\n```',
    ];

    for (const truncated of cases) {
        const extraction = extractJsonObject(truncated);

        assert.ok(extraction);
        assert.equal(extraction.repairedTruncation, true);
        assert.doesNotThrow(() => JSON.parse(extraction.rawJson));
    }
});

test('extractJsonObject preserves punctuation inside a truncated string', () => {
    const extraction = extractJsonObject('{"note":"febbre, ');

    assert.ok(extraction);
    assert.equal(extraction.repairedTruncation, true);
    assert.equal(JSON.parse(extraction.rawJson).note, 'febbre,');
});

test('extractJsonObject falls back to the last complete member', () => {
    const cases = [
        '{"a":1,"b":',
        '{"a":1,"partialKey',
        '{"a":1,"b":{"c":',
        '{"a":1,"b":"caf\\u00e',
        '{"a":1,"b":tru',
    ];

    for (const truncated of cases) {
        const extraction = extractJsonObject(truncated);

        assert.ok(extraction);
        assert.equal(extraction.repairedTruncation, true);
        assert.deepEqual(JSON.parse(extraction.rawJson), { a: 1 });
    }
});

test('extractJsonObject rejects an unrepairable first member', () => {
    const extraction = extractJsonObject('{"only":');

    assert.equal(extraction, null);
});

test('extractJsonObject does not reduce an array root to its first object', () => {
    const extraction = extractJsonObject('```json\n[{"a":1},{"b":2}]\n```\nTesto finale');

    assert.ok(extraction);
    assert.equal(extraction.repairedTruncation, false);
    assert.deepEqual(JSON.parse(extraction.rawJson), [{ a: 1 }, { b: 2 }]);
});

test('extractJsonObject ignores bracketed prose before an object', () => {
    const cases = [
        'Ecco l\'analisi [S1]:\n{"a":1,"b":',
        '[S1]:\n{"a":1,"b":',
    ];

    for (const response of cases) {
        const extraction = extractJsonObject(response);

        assert.ok(extraction);
        assert.equal(extraction.repairedTruncation, true);
        assert.deepEqual(JSON.parse(extraction.rawJson), { a: 1 });
    }
});

test('extractJsonObject preserves or rejects an array after bracketed prose', () => {
    const complete = extractJsonObject('[S1]: [{"a":1},{"b":2}]');
    const truncated = extractJsonObject('[S1]: [{"a":1},{"b":');

    assert.ok(complete);
    assert.equal(complete.repairedTruncation, false);
    assert.deepEqual(JSON.parse(complete.rawJson), [{ a: 1 }, { b: 2 }]);
    assert.equal(truncated, null);
});

test('document synthesis keeps a bare object opener invalid', () => {
    const parsed = parseDocumentSynthesisExtractionResponse('{', 'testo OCR');

    assert.equal(parsed.validJson, false);
    assert.equal(parsed.validTask, false);
    assert.equal(parsed.repairedTruncation, false);
    assert.equal(parsed.value.data.qualityReason, 'JSON del modello non valido');
});

test('extractJsonObject keeps malformed balanced JSON distinct from truncation', () => {
    const extraction = extractJsonObject('{"a": }');

    assert.ok(extraction);
    assert.equal(extraction.repairedTruncation, false);
    assert.throws(() => JSON.parse(extraction.rawJson));
});

test('document synthesis preserves earlier fields after truncation inside a string', () => {
    const truncated = `{
  "schemaVersion": "mediflow.ai.extract.v1",
  "task": "document_synthesis",
  "summary": "Referto con terapia esplicita",
  "data": {
    "qualityLevel": "green",
    "medications": ["Farmaco A"],
    "diagnoses": [
      {
        "code": "J44.9",
        "description": "Broncopneumopatia cronica ostruttiva",
        "system": "ICD-10"
      }
    ],
    "problemStatements": [{"label": "Diagnosi interrotta`;

    const parsed = parseDocumentSynthesisExtractionResponse(truncated, 'testo OCR');

    assert.equal(parsed.validJson, true);
    assert.equal(parsed.validTask, true);
    assert.equal(parsed.repairedTruncation, true);
    assert.deepEqual(parsed.value.data.medications, ['Farmaco A']);
    assert.equal(parsed.value.data.diagnoses[0].code, 'J44.9');
    assert.equal(parsed.value.data.problemStatements.length, 0);
});

/* @Codex */
test('document synthesis does not rescue a modern envelope with a mismatched task as legacy', () => {
    const parsed = parseDocumentSynthesisExtractionResponse(JSON.stringify({
        schemaVersion: AI_TASK_EXTRACTION_SCHEMA_VERSION,
        task: 'smart_import',
        summary: 'Task moderno errato',
        diagnoses: [],
    }), 'testo OCR sintetico');

    assert.equal(parsed.validJson, true);
    assert.equal(parsed.validTask, false);
    assert.equal(parsed.legacyContract, false);
    assert.equal(isEnvelopeUsable(parsed), false);
});

/* @Codex */
test('legacy rescue rejects case-variant modern envelope keys', () => {
    const parsed = parseDocumentSynthesisExtractionResponse(JSON.stringify({
        SchemaVersion: 'mediflow.ai.extract.v1',
        Task: 'smart_import',
        summary: 'Chiavi con case variante',
        diagnoses: [],
    }), 'testo OCR sintetico');

    assert.equal(parsed.validTask, false);
    assert.equal(parsed.legacyContract, false);
    assert.equal(isEnvelopeUsable(parsed), false);
});

/* @Codex */
test('legacy rescue rejects a nested modern envelope declaration', () => {
    const parsed = parseDocumentSynthesisExtractionResponse(JSON.stringify({
        summary: 'Envelope moderno annidato',
        diagnoses: [],
        provider: { schemaVersion: 'mediflow.ai.extract.v1', task: 'smart_import' },
    }), 'testo OCR sintetico');

    assert.equal(parsed.validTask, false);
    assert.equal(parsed.legacyContract, false);
    assert.equal(isEnvelopeUsable(parsed), false);
});

/* @Codex */
test('legacy rescue rejects a deeply nested modern envelope declaration', () => {
    const parsed = parseDocumentSynthesisExtractionResponse(JSON.stringify({
        summary: 'Envelope dichiarato in profondita',
        diagnoses: [],
        provider: { a: { b: { c: { schemaVersion: 'mediflow.ai.extract.v1', task: 'smart_import' } } } },
    }), 'testo OCR sintetico');

    assert.equal(parsed.validTask, false);
    assert.equal(parsed.legacyContract, false);
    assert.equal(isEnvelopeUsable(parsed), false);
});

/* @Codex: tri-state del rescue legacy - solo absent consente il recupero */
test('legacy rescue is blocked by a modern envelope in a later fragment', () => {
    const response = '```json\n{"summary_markdown":"**Riassunto clinico:** testo storico","quality":{"level":"green"},"diagnoses":[]}\n```\n```json\n'
        + JSON.stringify({ schemaVersion: 'mediflow.ai.extract.v1', task: 'smart_import', summary: 'wrong task', data: {} })
        + '\n```';
    const parsed = parseDocumentSynthesisExtractionResponse(response, 'testo OCR sintetico');

    assert.equal(parsed.validTask, false);
    assert.equal(parsed.legacyContract, false);
    assert.equal(isEnvelopeUsable(parsed), false);
});

/* @Codex */
test('legacy rescue is blocked when depth truncation makes evidence unknown', () => {
    let nested: unknown = { schemaVersion: 'mediflow.ai.extract.v1', task: 'smart_import' };
    for (let index = 0; index < 8; index += 1) nested = { layer: nested };
    const parsed = parseDocumentSynthesisExtractionResponse(JSON.stringify({
        summary_markdown: '**Riassunto clinico:** testo storico',
        quality: { level: 'green' },
        diagnoses: [],
        embedded: nested,
    }), 'testo OCR sintetico');

    assert.equal(parsed.validTask, false);
    assert.equal(parsed.legacyContract, false);
});

/* @Codex */
test('legacy rescue is blocked by present evidence at the exact depth limit', () => {
    let nested: unknown = { schemaVersion: 'mediflow.ai.extract.v1', task: 'smart_import' };
    for (let index = 0; index < 7; index += 1) nested = { layer: nested };
    const parsed = parseDocumentSynthesisExtractionResponse(JSON.stringify({
        summary_markdown: '**Riassunto clinico:** testo storico',
        quality: { level: 'green' },
        diagnoses: [],
        embedded: nested,
    }), 'testo OCR sintetico');

    assert.equal(parsed.validTask, false);
    assert.equal(parsed.legacyContract, false);
});

/* @Codex */
test('legacy rescue is blocked by a single-quoted pseudo envelope in a string field', () => {
    const parsed = parseDocumentSynthesisExtractionResponse(JSON.stringify({
        summary_markdown: '**Riassunto clinico:** storico',
        quality: { level: 'green' },
        diagnoses: [],
        content: "{'schemaVersion':'mediflow.ai.extract.v1','task':'smart_import','summary':'errato'}",
    }), 'testo OCR sintetico');

    assert.equal(parsed.validTask, false);
    assert.equal(parsed.legacyContract, false);
});

/* @Codex: lo sniff pseudo-JSON deve riconoscere una chiave task con escape. */
test('legacy rescue is blocked by an escaped task key in a single-quoted pseudo envelope', () => {
    const response = JSON.stringify({
        summary_markdown: '**Riassunto clinico:** testo storico sintetico',
        quality: { level: 'green' },
        diagnoses: [{
            code: 'I10',
            description: 'Ipertensione essenziale',
            system: 'ICD-10',
            confidence: 'high',
            evidence: 'testo sintetico',
        }],
        content: "{'ta\\u0073k':'document_synthesis','summary':'modern'}",
    });

    const parsed = parseDocumentSynthesisExtractionResponse(response, 'testo OCR sintetico');
    assert.deepEqual({
        evidence: detectModernEnvelopeEvidence(response),
        validTask: parsed.validTask,
        legacyContract: parsed.legacyContract,
        diagnosisCount: parsed.value.data.diagnoses.length,
    }, {
        evidence: 'present',
        validTask: false,
        legacyContract: false,
        diagnosisCount: 0,
    });
});

/* @Codex: anche schemaVersion escaped dichiara un envelope moderno. */
test('legacy rescue is blocked by an escaped schemaVersion key in a single-quoted pseudo envelope', () => {
    const response = JSON.stringify({
        summary_markdown: '**Riassunto clinico:** testo storico sintetico',
        quality: { level: 'green' },
        diagnoses: [],
        content: "{'schemaVer\\u0073ion':'mediflow.ai.extract.v1','summary':'modern'}",
    });

    const parsed = parseDocumentSynthesisExtractionResponse(response, 'testo OCR sintetico');
    assert.deepEqual({
        evidence: detectModernEnvelopeEvidence(response),
        validTask: parsed.validTask,
        legacyContract: parsed.legacyContract,
    }, {
        evidence: 'present',
        validTask: false,
        legacyContract: false,
    });
});

/* @Codex: un escape senza dichiarazione moderna non deve bloccare il legacy. */
test('single-quoted pseudo JSON with escapes but no modern declaration stays absent', () => {
    const response = JSON.stringify({
        summary_markdown: '**Riassunto clinico:** testo storico sintetico',
        quality: { level: 'green' },
        diagnoses: [],
        content: "{'ta\\u0073k':'nota_storica','summary':'legacy'}",
    });

    assert.equal(detectModernEnvelopeEvidence(response), 'absent');
});

/* @Codex: una sola passata copre gli escape JS ammessi senza trasformare gli
   escape di controllo nelle lettere che li nominano. */
test('single-quoted pseudo envelope sniff decodes JS escapes once', () => {
    for (const content of [
        "{'ta\\x73k':'document_synthesis','summary':'modern'}",
        "{'ta\\u{73}k':'document_synthesis','summary':'modern'}",
        "{'ta\\sk':'document_synthesis','summary':'modern'}",
    ]) {
        assert.equal(
            detectModernEnvelopeEvidence(JSON.stringify({ content })),
            'present',
        );
    }

    assert.equal(
        detectModernEnvelopeEvidence(JSON.stringify({
            content: "{'\\task':'document_synthesis','summary':'modern'}",
        })),
        'absent',
    );
});

/* @Codex: extractor non appartiene al prefisso esatto o dotted del contratto. */
test('legacy rescue accepts schemaVersion mediflow.ai.extractor as non-modern', () => {
    const response = JSON.stringify({
        schemaVersion: 'mediflow.ai.extractor',
        summary_markdown: '**Riassunto clinico:** testo storico sintetico',
        quality: { level: 'green' },
        diagnoses: [],
    });
    const parsed = parseDocumentSynthesisExtractionResponse(response, 'testo OCR sintetico');

    assert.deepEqual({
        evidence: detectModernEnvelopeEvidence(response),
        legacyContract: parsed.legacyContract,
    }, {
        evidence: 'absent',
        legacyContract: true,
    });
});

/* @Codex: il ramo pseudo-JSON usa lo stesso contratto ASCII exact-or-dotted. */
test('legacy rescue accepts pseudo-JSON schemaVersion mediflow.ai.extractor as non-modern', () => {
    const response = JSON.stringify({
        summary_markdown: '**Riassunto clinico:** testo storico sintetico',
        quality: { level: 'green' },
        diagnoses: [],
        content: "{'schemaVersion':'mediflow.ai.extractor'}",
    });
    const parsed = parseDocumentSynthesisExtractionResponse(response, 'testo OCR sintetico');

    assert.deepEqual({
        evidence: detectModernEnvelopeEvidence(response),
        legacyContract: parsed.legacyContract,
    }, {
        evidence: 'absent',
        legacyContract: true,
    });
});

/* @Codex: lo schema esatto e le sole estensioni dotted restano moderne. */
test('exact and dotted schemaVersion values remain present without support keys', () => {
    for (const schemaVersion of [
        'mediflow.ai.extract',
        'mediflow.ai.extract.v1',
        'MEDIFLOW.AI.EXTRACT.V1',
    ]) {
        assert.equal(
            detectModernEnvelopeEvidence(JSON.stringify({ schemaVersion })),
            'present',
        );
    }
});

/* @Codex: schemaVersion resta una chiave di supporto anche con valore non moderno. */
test('known task with extractor schemaVersion support remains present', () => {
    assert.equal(detectModernEnvelopeEvidence(JSON.stringify({
        task: 'document_synthesis',
        schemaVersion: 'mediflow.ai.extractor',
    })), 'present');
});

/* @Codex */
test('tri-state precedence: collected evidence wins over fragment truncation', () => {
    const text = [
        JSON.stringify({
            schemaVersion: 'mediflow.ai.extract.v1',
            task: 'smart_import',
            summary: 'Envelope in testa',
            data: { diagnoses: [], therapies: [], servicePrescriptions: [] },
        }),
        ...Array.from({ length: 8 }, (_, index) => JSON.stringify({ i: index })),
    ].join(' testo ');

    assert.equal(detectModernEnvelopeEvidence(text), 'present');
});

/* WUL-362 F1: l'evidenza moderna vive nelle chiavi RAW, prima della riduzione
   last-wins di JSON.parse. Una chiave riservata duplicata o in collisione di
   case non deve nascondere la dichiarazione moderna al rescue legacy. */

const LEGACY_TAIL = '"summary_markdown":"**Riassunto clinico:** testo storico","quality":{"level":"green"},"diagnoses":[]';

test('last-wins: modern task first, junk last stays present and never rescues as legacy', () => {
    const response = `{"task":"document_synthesis","task":"Nota storica libera",${LEGACY_TAIL}}`;

    assert.equal(detectModernEnvelopeEvidence(response), 'present');
    const parsed = parseDocumentSynthesisExtractionResponse(response, 'testo OCR sintetico');
    assert.equal(parsed.validTask, false);
    assert.equal(parsed.legacyContract, false);
    assert.equal(isEnvelopeUsable(parsed), false);
});

test('last-wins: junk task first, modern task last stays present and never rescues as legacy', () => {
    const response = `{"task":"Nota storica libera","task":"document_synthesis",${LEGACY_TAIL}}`;

    assert.equal(detectModernEnvelopeEvidence(response), 'present');
    const parsed = parseDocumentSynthesisExtractionResponse(response, 'testo OCR sintetico');
    assert.equal(parsed.validTask, false);
    assert.equal(parsed.legacyContract, false);
    assert.equal(isEnvelopeUsable(parsed), false);
});

test('escaped duplicate task key cannot hide the modern declaration', () => {
    const response = `{"ta\\u0073k":"document_synthesis","task":"Nota storica",${LEGACY_TAIL}}`;

    assert.equal(detectModernEnvelopeEvidence(response), 'present');
    const parsed = parseDocumentSynthesisExtractionResponse(response, 'testo OCR sintetico');
    assert.equal(parsed.validTask, false);
    assert.equal(parsed.legacyContract, false);
});

test('reserved-key case collision cannot hide the modern declaration in either order', () => {
    for (const response of [
        `{"Task":"document_synthesis","task":"Nota storica",${LEGACY_TAIL}}`,
        `{"task":"Nota storica","Task":"document_synthesis",${LEGACY_TAIL}}`,
    ]) {
        assert.equal(detectModernEnvelopeEvidence(response), 'present');
        const parsed = parseDocumentSynthesisExtractionResponse(response, 'testo OCR sintetico');
        assert.equal(parsed.validTask, false);
        assert.equal(parsed.legacyContract, false);
    }
});

test('parser rejects a reserved-key case collision on an otherwise valid envelope', () => {
    const parsed = parsePatientInsightExtractionResponse(
        '{"schemaVersion":"mediflow.ai.extract.v1","Task":"smart_import","task":"patient_insight","summary":"Non usare","data":{"currentState":[],"alerts":[],"nextSteps":[],"gaps":[]}}',
    );

    assert.equal(parsed.validJson, true);
    assert.equal(parsed.validTask, false);
    assert.equal(isEnvelopeUsable(parsed), false);
});

test('duplicate task key inside an array element object blocks the legacy rescue', () => {
    const response = `{"items":[{"task":"document_synthesis","task":"Nota storica"}],${LEGACY_TAIL}}`;

    assert.equal(detectModernEnvelopeEvidence(response), 'present');
    const parsed = parseDocumentSynthesisExtractionResponse(response, 'testo OCR sintetico');
    assert.equal(parsed.validTask, false);
    assert.equal(parsed.legacyContract, false);
});

test('last-wins shadowing inside a stringified layer stays present', () => {
    const response = JSON.stringify({
        summary_markdown: '**Riassunto clinico:** testo storico',
        quality: { level: 'green' },
        diagnoses: [],
        content: '{"task":"document_synthesis","task":"Nota storica"}',
    });

    assert.equal(detectModernEnvelopeEvidence(response), 'present');
    const parsed = parseDocumentSynthesisExtractionResponse(response, 'testo OCR sintetico');
    assert.equal(parsed.validTask, false);
    assert.equal(parsed.legacyContract, false);
});

test('same task keys in distinct objects raise no false conflict', () => {
    assert.equal(
        detectModernEnvelopeEvidence('{"a":{"task":"nota uno"},"b":{"task":"nota due"}}'),
        'absent',
    );
});

test('task and support key in separate fragments are never paired', () => {
    assert.equal(
        detectModernEnvelopeEvidence('{"task":"document_synthesis"} testo {"summary":"solo testo"}'),
        'absent',
    );
});

test('no evidence with exhausted depth budget stays unknown, never absent', () => {
    let nested: unknown = { nota: 'testo storico senza envelope' };
    for (let index = 0; index < 9; index += 1) nested = { layer: nested };

    assert.equal(detectModernEnvelopeEvidence(JSON.stringify(nested)), 'unknown');
});
