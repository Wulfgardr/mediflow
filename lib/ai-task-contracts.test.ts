import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
import { buildSmartImportExtractionPrompt as buildSmartImportPromptDirect } from './ai-task-contract-prompts';

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
    assert.equal(parsed.value.data.medications[0], 'Humalog 4 U ai pasti principali');
    assert.equal(parsed.value.data.problemStatements[0].label, 'Diabete mellito tipo 2');
    assert.equal(parsed.value.data.therapyCandidates[0].drugMention, 'Humalog');
});
