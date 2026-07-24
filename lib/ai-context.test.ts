import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import Module from 'node:module';
import { buildDocumentParseEvidenceArtifact, serializeDocumentParseEvidenceArtifact } from './domain/documents/document-parse-evidence-artifact';

const moduleWithResolve = Module as unknown as {
    _resolveFilename: (
        request: string,
        parent: NodeModule | null,
        isMain: boolean,
        options?: unknown,
    ) => string;
};

const originalResolveFilename = moduleWithResolve._resolveFilename;
moduleWithResolve._resolveFilename = function resolveFilename(
    request: string,
    parent: NodeModule | null,
    isMain: boolean,
    options?: unknown,
) {
    if (request.startsWith('@/')) {
        return originalResolveFilename.call(
            this,
            path.join(process.cwd(), 'tmp-ai-context-test', request.slice(6)),
            parent,
            isMain,
            options,
        );
    }

    return originalResolveFilename.call(this, request, parent, isMain, options);
};

function stubFilter(items: unknown[]) {
    return (() => ({ toArray: async () => items })) as unknown;
}

/* @Codex */
interface HarnessOptions {
    attachments?: unknown[];
    documentInsights?: unknown;
    therapyUpdatedAt?: Date;
    observationUpdatedAt?: Date;
}

async function withHarness(options: HarnessOptions = {}) {
    const dbModule = await import('./db');
    const settingsModule = await import('./ai-insight-settings');

    const original = {
        getPatient: dbModule.db.patients.get,
        entryFilter: dbModule.db.entries.filter,
        therapyFilter: dbModule.db.therapies.filter,
        observationFilter: dbModule.db.observations.filter,
        checkupFilter: dbModule.db.checkups.filter,
        attachmentFilter: dbModule.db.attachments.filter,
        runtimeSettings: settingsModule.getAIInsightRuntimeSettings,
    };

    dbModule.db.patients.get = (async (id: string) => (
        id === 'patient-1'
            ? {
                id,
                firstName: 'Giulia',
                lastName: 'Bianchi',
                birthDate: new Date('1980-01-01T00:00:00Z'),
                taxCode: 'BNCGLI80A41H501T',
                notes: '**Quadro attuale:** stale ai output [S1]',
                monitoringProfile: 'Controllo PA domiciliare',
                diagnoses: [
                    {
                        code: 'I10',
                        description: 'Ipertensione essenziale',
                        system: 'ICD-10',
                        date: new Date('2025-02-10T00:00:00Z'),
                    },
                ],
                documentInsights: options.documentInsights ?? JSON.stringify([
                    {
                        id: 'doc-1',
                        date: '2025-03-10T00:00:00Z',
                        fileName: 'referto-lab.pdf',
                        summary: 'Azotemia in lieve aumento',
                    },
                    {
                        id: 'doc-2',
                        date: '2025-03-05T00:00:00Z',
                        fileName: 'dimissione.pdf',
                        summary: 'Follow-up cardiologico stabile',
                        rawMarkdown: [
                            'Diagnosi di dimissione',
                            'Deficit della deambulazione in postumi di frattura pertrocanterica sx',
                            'Terapia farmacologica alla dimissione',
                            'Duloxetina 60 mg 1 cp ore 20',
                            'Pregabalin 75 mg 1 cp ore 8',
                            'Indicazioni alla dimissione',
                            'FKT domiciliare 2-3 volte alla settimana',
                        ].join('\n'),
                        extractedData: {
                            diagnoses: [
                                {
                                    code: 'S72.1',
                                    description: 'Frattura pertrocanterica del femore sinistro',
                                    system: 'ICD-10',
                                },
                            ],
                            medications: [
                                'Duloxetina 60 mg 1 cp ore 20',
                                'Pregabalin 75 mg 1 cp ore 8',
                            ],
                        },
                        evidencePack: {
                            schemaVersion: 'mediflow.document_evidence_pack.v2',
                            source: {
                                documentInsightId: 'doc-2',
                                fileName: 'dimissione.pdf',
                                documentDate: '2025-03-05T00:00:00.000Z',
                                qualityLevel: 'green',
                            },
                            facts: [
                                {
                                    id: 'problem:1',
                                    kind: 'problem',
                                    label: 'Frattura pertrocanterica del femore sinistro',
                                    excerpt: 'Frattura pertrocanterica del femore sinistro',
                                    sourceId: 'doc-2',
                                    temporality: 'current',
                                    status: 'active',
                                    origin: 'documented',
                                    code: 'S72.1',
                                    system: 'ICD-10',
                                },
                                {
                                    id: 'medication:1',
                                    kind: 'medication',
                                    label: 'Duloxetina 60 mg 1 cp ore 20',
                                    excerpt: 'Duloxetina 60 mg 1 cp ore 20',
                                    sourceId: 'doc-2',
                                    temporality: 'current',
                                    status: 'active',
                                    origin: 'documented',
                                },
                                {
                                    id: 'medication:2',
                                    kind: 'medication',
                                    label: 'Pregabalin 75 mg 1 cp ore 8',
                                    excerpt: 'Pregabalin 75 mg 1 cp ore 8',
                                    sourceId: 'doc-2',
                                    temporality: 'current',
                                    status: 'active',
                                    origin: 'documented',
                                },
                                {
                                    id: 'followup:1',
                                    kind: 'followup',
                                    label: 'FKT domiciliare 2-3 volte alla settimana',
                                    excerpt: 'FKT domiciliare 2-3 volte alla settimana',
                                    sourceId: 'doc-2',
                                    temporality: 'planned',
                                    status: 'planned',
                                    origin: 'documented',
                                },
                            ],
                        },
                    },
                    {
                        id: 'doc-3',
                        date: '2025-03-05T00:00:00Z',
                        fileName: 'ps.pdf',
                        summary: 'Accesso in PS per frattura pertrocanterica femore sinistro',
                        rawMarkdown: [
                            'Verbale di pronto soccorso',
                            'Frattura pertrocanterica femore sinistro',
                            'Dimissione con controllo ortopedico',
                        ].join('\n'),
                        extractedData: {
                            diagnoses: [
                                {
                                    code: 'S72.1',
                                    description: 'Frattura pertrocanterica del femore sinistro',
                                    system: 'ICD-10',
                                },
                            ],
                        },
                    },
                ]),
            }
            : undefined
    )) as typeof dbModule.db.patients.get;

    dbModule.db.entries.filter = stubFilter([
        {
            id: 'entry-1',
            patientId: 'patient-1',
            date: new Date('2025-03-12T00:00:00Z'),
            type: 'note',
            content: 'Dolore toracico riferito in riduzione',
            createdAt: new Date('2025-03-12T00:00:00Z'),
            updatedAt: new Date('2025-03-12T00:00:00Z'),
        },
    ]) as typeof dbModule.db.entries.filter;

    dbModule.db.therapies.filter = stubFilter([
        {
            id: 'therapy-1',
            patientId: 'patient-1',
            drugName: 'Ramipril',
            dosage: '5 mg/die',
            status: 'active',
            startDate: new Date('2025-03-11T00:00:00Z'),
            endDate: null,
            createdAt: new Date('2025-03-11T00:00:00Z'),
            updatedAt: options.therapyUpdatedAt ?? new Date('2025-03-11T00:00:00Z'),
        },
    ]) as typeof dbModule.db.therapies.filter;

    dbModule.db.observations.filter = stubFilter([
        {
            id: 'obs-1',
            patientId: 'patient-1',
            codeSystem: 'LOINC',
            code: '8480-6',
            display: 'Pressione sistolica',
            unitSystem: 'UCUM',
            unitCode: 'mm[Hg]',
            value: '138',
            notes: 'Controllo domiciliare',
            observedAt: new Date('2025-03-13T00:00:00Z'),
            createdAt: new Date('2025-03-13T00:00:00Z'),
            updatedAt: options.observationUpdatedAt ?? new Date('2025-03-13T00:00:00Z'),
        },
    ]) as typeof dbModule.db.observations.filter;

    dbModule.db.checkups.filter = stubFilter([
        {
            id: 'checkup-1',
            patientId: 'patient-1',
            date: new Date('2025-03-20T00:00:00Z'),
            title: 'Controllo cardiologico',
            notes: 'Da confermare',
            status: 'pending',
            createdAt: new Date('2025-03-01T00:00:00Z'),
        },
    ]) as typeof dbModule.db.checkups.filter;

    dbModule.db.attachments.filter = stubFilter(options.attachments ?? [
        { id: 'attachment-1', patientId: 'patient-1', name: 'eco-cuore.pdf', summarySnapshot: 'Funzione sistolica conservata', createdAt: new Date('2025-03-14T00:00:00Z') },
        { id: 'attachment-2', patientId: 'patient-1', name: 'rx-polmoni.pdf', summarySnapshot: 'Addensamento basale da rivalutare', createdAt: new Date('2025-03-04T00:00:00Z') },
    ]) as typeof dbModule.db.attachments.filter;

    settingsModule.getAIInsightRuntimeSettings = (async () => ({
        mode: 'full_auto',
        resolvedProfile: 'balanced',
        maxDocuments: 3,
        maxDocumentSummaryChars: 260,
        maxDocumentContextChars: 1000,
        outputMaxTokens: 256,
    })) as typeof settingsModule.getAIInsightRuntimeSettings;

    return () => {
        dbModule.db.patients.get = original.getPatient;
        dbModule.db.entries.filter = original.entryFilter;
        dbModule.db.therapies.filter = original.therapyFilter;
        dbModule.db.observations.filter = original.observationFilter;
        dbModule.db.checkups.filter = original.checkupFilter;
        dbModule.db.attachments.filter = original.attachmentFilter;
        settingsModule.getAIInsightRuntimeSettings = original.runtimeSettings;
    };
}

test('buildPatientInsightContext orders structured domains and documents deterministically', async () => {
    const restore = await withHarness();

    try {
        const { buildPatientInsightContext } = await import('./ai-context');
        const snapshot = await buildPatientInsightContext('patient-1');
        const prompt = snapshot.prompt;
        const sections = snapshot.sourceRefs.map((ref) => ref.section);

        assert.equal(snapshot.outputMaxTokens, 256);
        assert.deepEqual(sections, [
            'Profilo strutturato',
            'Profilo strutturato',
            'Profilo strutturato',
            'Diagnosi codificate',
            'Terapie attive',
            'Osservazioni recenti',
            'Controlli pendenti',
            'Diario clinico recente',
            'Documenti recenti',
            'Documenti recenti',
            'Documenti recenti',
        ]);
        assert.ok(prompt.indexOf('[PROFILO STRUTTURATO]') < prompt.indexOf('[DIAGNOSI CODIFICATE]'));
        assert.ok(prompt.indexOf('[DIAGNOSI CODIFICATE]') < prompt.indexOf('[TERAPIE ATTIVE]'));
        assert.ok(prompt.indexOf('[TERAPIE ATTIVE]') < prompt.indexOf('[OSSERVAZIONI RECENTI]'));
        assert.ok(prompt.indexOf('[OSSERVAZIONI RECENTI]') < prompt.indexOf('[CONTROLLI PENDENTI]'));
        assert.ok(prompt.indexOf('[CONTROLLI PENDENTI]') < prompt.indexOf('[DIARIO CLINICO RECENTE]'));
        assert.ok(prompt.indexOf('[DIARIO CLINICO RECENTE]') < prompt.indexOf('[DOCUMENTI RECENTI]'));
        assert.match(prompt, /Dai priorita clinica a documenti recenti, diario clinico recente, osservazioni recenti e controlli pendenti/i);
        assert.match(prompt, /evita cataloghi anamnestici se non cambiano la gestione attuale/i);
        assert.match(prompt, /eco-cuore\.pdf \(14\/03\/2025\): Funzione sistolica conservata/i);
        assert.match(prompt, /referto-lab\.pdf \(10\/03\/2025\): Sintesi: Azotemia in lieve aumento/i);
        assert.match(prompt, /dimissione\.pdf \(05\/03\/2025\): Problemi documentati: ICD-10 S72\.1: Frattura pertrocanterica del femore sinistro/i);
        assert.match(prompt, /Terapie documentate: Duloxetina 60 mg 1 cp ore 20; Pregabalin 75 mg 1 cp ore 8/i);
        assert.match(prompt, /Follow-up documentato: FKT domiciliare 2-3 volte alla settimana \[programmato, pianificato\]/i);
        assert.ok(!prompt.includes('ps.pdf'));
        assert.ok(!prompt.includes('rx-polmoni.pdf'));
        assert.match(snapshot.limitations.join('\n'), /note narrative della scheda sono state escluse/i);
        assert.match(snapshot.limitations.join('\n'), /contesto documentale AI e stato ridotto a 3 documenti/i);
        assert.match(snapshot.limitations.join('\n'), /documenti ai sovrapposti sullo stesso episodio sono stati consolidati/i);
        assert.match(prompt, /\[TERAPIE ATTIVE\][\s\S]*Ramipril 5 mg\/die/i);
        assert.match(prompt, /sezione TERAPIE ATTIVE come fonte primaria della terapia corrente/i);
        const diaryRef = snapshot.sourceRefs.find((ref) => ref.section === 'Diario clinico recente');
        assert.equal(diaryRef?.evidenceSourceId, 'diary:entry-1');
        assert.equal(diaryRef?.evidenceSchemaVersion, 'mediflow.evidence_queue.v1');
        assert.equal(diaryRef?.citation?.sourceId, 'diary:entry-1');
        assert.match(diaryRef?.promptLine ?? '', /Dolore toracico riferito in riduzione/i);
    } finally {
        restore();
    }
});

test('buildPatientInsightContext hash tracks therapy and observation updatedAt changes', async () => {
    const { buildPatientInsightContext } = await import('./ai-context');
    const restoreInitial = await withHarness({
        therapyUpdatedAt: new Date('2025-03-11T00:00:00Z'),
        observationUpdatedAt: new Date('2025-03-13T00:00:00Z'),
    });
    let initialHash = '';
    let initialPrompt = '';

    try {
        const snapshot = await buildPatientInsightContext('patient-1');
        initialHash = snapshot.contextHash;
        initialPrompt = snapshot.prompt;
    } finally {
        restoreInitial();
    }

    const restoreUpdated = await withHarness({
        therapyUpdatedAt: new Date('2025-03-18T00:00:00Z'),
        observationUpdatedAt: new Date('2025-03-19T00:00:00Z'),
    });

    try {
        const snapshot = await buildPatientInsightContext('patient-1');
        assert.notEqual(snapshot.contextHash, initialHash);
        assert.equal(snapshot.prompt, initialPrompt);
    } finally {
        restoreUpdated();
    }
});

test('buildPatientInsightContext recovers direct attachment text when the stored snapshot is generic', async () => {
    const restore = await withHarness({
        documentInsights: JSON.stringify([]),
        attachments: [
            {
                id: 'attachment-generic',
                patientId: 'patient-1',
                name: 'lettera-dimissione.pdf',
                type: 'application/pdf',
                data: 'data:application/pdf;base64,ZmFrZQ==',
                summarySnapshot: 'Nessuna informazione rilevante trovata.',
                createdAt: new Date('2025-03-14T00:00:00Z'),
            },
        ],
    });

    try {
        const { buildPatientInsightContext } = await import('./ai-context');
        const snapshot = await buildPatientInsightContext('patient-1', {
            recoverAttachmentText: async () => [
                'Diagnosi di dimissione',
                'Deficit della deambulazione in postumi di frattura pertrocanterica sx',
                'Indicazioni alla dimissione',
                'FKT domiciliare 2-3 volte alla settimana',
                'Visita ortopedica di controllo con Rx anca sx e femore sx',
            ].join('\n'),
        });

        assert.match(snapshot.prompt, /lettera-dimissione\.pdf \(14\/03\/2025\): Estratto diretto allegato:/i);
        assert.match(snapshot.prompt, /Deficit della deambulazione in postumi di frattura pertrocanterica sx/i);
        assert.match(snapshot.prompt, /FKT domiciliare 2-3 volte alla settima/i);
        assert.match(
            snapshot.limitations.join('\n'),
            /Alcuni allegati senza sintesi clinica strutturata sono stati riletti direttamente dal file/i,
        );
        assert.ok(!snapshot.limitations.join('\n').includes('non sono stati usati come fonti documentali'));
    } finally {
        restore();
    }
});

test('buildPatientInsightContext applies attachment text recovery budget to low-signal candidates only', async () => {
    const restore = await withHarness({
        documentInsights: JSON.stringify([]),
        attachments: [
            {
                id: 'attachment-good-1',
                patientId: 'patient-1',
                name: 'eco-cuore.pdf',
                summarySnapshot: 'Funzione sistolica conservata.',
                createdAt: new Date('2025-03-16T00:00:00Z'),
            },
            {
                id: 'attachment-good-2',
                patientId: 'patient-1',
                name: 'rx-torace.pdf',
                summarySnapshot: 'Non evidenza di addensamenti pleuroparenchimali acuti.',
                createdAt: new Date('2025-03-15T00:00:00Z'),
            },
            {
                id: 'attachment-low-signal',
                patientId: 'patient-1',
                name: 'dimissione-ortopedica.pdf',
                type: 'application/pdf',
                data: 'data:application/pdf;base64,ZmFrZQ==',
                summarySnapshot: 'Nessuna informazione rilevante trovata.',
                createdAt: new Date('2025-03-14T00:00:00Z'),
            },
        ],
    });

    try {
        const recoveredAttachmentIds: string[] = [];
        const { buildPatientInsightContext } = await import('./ai-context');
        const snapshot = await buildPatientInsightContext('patient-1', {
            recoverAttachmentText: async (attachment) => {
                recoveredAttachmentIds.push(attachment.id);
                return [
                    'Indicazioni alla dimissione',
                    'FKT domiciliare 2-3 volte alla settimana',
                    'Controllo ortopedico con Rx anca sinistra',
                ].join('\n');
            },
        });

        assert.deepEqual(recoveredAttachmentIds, ['attachment-low-signal']);
        assert.match(snapshot.prompt, /eco-cuore\.pdf \(16\/03\/2025\): Funzione sistolica conservata/i);
        assert.match(snapshot.prompt, /rx-torace\.pdf \(15\/03\/2025\): Non evidenza di addensamenti/i);
        assert.match(snapshot.prompt, /dimissione-ortopedica\.pdf \(14\/03\/2025\): Estratto diretto allegato:/i);
        assert.match(snapshot.prompt, /FKT domiciliare 2-3 volte alla settimana/i);
        assert.match(
            snapshot.limitations.join('\n'),
            /Alcuni allegati senza sintesi clinica strutturata sono stati riletti direttamente dal file/i,
        );
    } finally {
        restore();
    }
});

test('buildPatientInsightContext prefers the attachment parse/evidence artifact over the legacy document projection', async () => {
    const artifact = buildDocumentParseEvidenceArtifact({
        documentInsightId: 'doc-artifact',
        attachmentId: 'attachment-artifact',
        fileName: 'lettera-dimissione.pdf',
        documentDate: '2025-03-14T00:00:00.000Z',
        qualityLevel: 'green',
        qualityReason: 'Documento strutturato',
        summary: 'Dimissione ortopedica con follow-up domiciliare.',
        rawMarkdown: [
            'Diagnosi di dimissione',
            'Frattura pertrocanterica del femore sinistro',
            'Indicazioni alla dimissione',
            'FKT domiciliare 2-3 volte alla settimana',
            'ADI infermieristica per medicazione ferita',
        ].join('\n'),
        diagnoses: [
            {
                code: 'S72.1',
                description: 'Frattura pertrocanterica del femore sinistro',
                system: 'ICD-10',
                evidence: 'Diagnosi di dimissione: frattura pertrocanterica del femore sinistro',
                confidence: 'high',
            },
        ],
        medications: [],
    });

    const restore = await withHarness({
        documentInsights: JSON.stringify([
            {
                id: 'doc-artifact',
                attachmentId: 'attachment-artifact',
                date: '2025-03-14T00:00:00Z',
                fileName: 'lettera-dimissione.pdf',
                summary: 'Legacy summary da non usare come source of truth',
                rawMarkdown: '',
            },
        ]),
        attachments: [
            {
                id: 'attachment-artifact',
                patientId: 'patient-1',
                name: 'lettera-dimissione.pdf',
                summarySnapshot: 'Nessuna informazione rilevante trovata.',
                parseEvidenceArtifactSnapshot: serializeDocumentParseEvidenceArtifact(artifact),
                createdAt: new Date('2025-03-14T00:00:00Z'),
            },
        ],
    });

    try {
        const { buildPatientInsightContext } = await import('./ai-context');
        const snapshot = await buildPatientInsightContext('patient-1');
        const prompt = snapshot.prompt;

        assert.match(prompt, /lettera-dimissione\.pdf \(14\/03\/2025\): Problemi documentati: ICD-10 S72\.1: Frattura pertrocanterica del femore sinistro/i);
        assert.match(prompt, /Follow-up documentato: FKT domiciliare 2-3 volte alla settimana/i);
        assert.ok(!prompt.includes('Legacy summary da non usare come source of truth'));
        assert.equal((prompt.match(/lettera-dimissione\.pdf \(14\/03\/2025\):/gi) || []).length, 1);
    } finally {
        restore();
    }
});

test('buildPatientInsightContext promotes the most recent attachment evidence before older archive documents', async () => {
    const restore = await withHarness({
        documentInsights: JSON.stringify([
            {
                id: 'doc-1',
                date: '2025-03-12T00:00:00Z',
                fileName: 'profilo-terapia.pdf',
                summary: 'Terapia antipertensiva invariata.',
            },
            {
                id: 'doc-2',
                date: '2025-03-11T00:00:00Z',
                fileName: 'lettera-specialistica.pdf',
                summary: 'Follow-up cardiologico stabile.',
            },
            {
                id: 'doc-3',
                date: '2025-03-10T00:00:00Z',
                fileName: 'vecchio-lab.pdf',
                summary: 'Esami ematici senza novita clinicamente rilevanti.',
            },
        ]),
        attachments: [
            {
                id: 'attachment-new',
                patientId: 'patient-1',
                name: 'follow-up-pneumo.pdf',
                summarySnapshot: 'Controllo pneumologico ravvicinato da programmare per addensamento basale.',
                createdAt: new Date('2025-03-13T00:00:00Z'),
            },
        ],
    });

    try {
        const { buildPatientInsightContext } = await import('./ai-context');
        const snapshot = await buildPatientInsightContext('patient-1');
        const documentRefs = snapshot.sourceRefs
            .filter((ref) => ref.section === 'Documenti recenti')
            .map((ref) => ref.promptLine);

        assert.equal(documentRefs.length, 3);
        assert.match(documentRefs[0] || '', /follow-up-pneumo\.pdf \(13\/03\/2025\): Controllo pneumologico ravvicinato/i);
        assert.match(documentRefs[1] || '', /profilo-terapia\.pdf \(12\/03\/2025\): Sintesi: Terapia antipertensiva invariata/i);
        assert.match(documentRefs[2] || '', /lettera-specialistica\.pdf \(11\/03\/2025\): Sintesi: Follow-up cardiologico stabile/i);
        assert.ok(!snapshot.prompt.includes('vecchio-lab.pdf'));
        assert.match(snapshot.limitations.join('\n'), /contesto documentale AI e stato ridotto a 3 documenti/i);
    } finally {
        restore();
    }
});

test('buildPatientInsightContext suppresses stale background documents when a newer source covers the same domain', async () => {
    const restore = await withHarness({
        documentInsights: JSON.stringify([
            {
                id: 'doc-1',
                date: '2025-02-12T00:00:00Z',
                fileName: 'profilo-cronico.pdf',
                summary: 'BPCO stabile, follow-up annuale pneumologico senza urgenze.',
            },
            {
                id: 'doc-2',
                date: '2025-03-11T00:00:00Z',
                fileName: 'lettera-specialistica.pdf',
                summary: 'Follow-up cardiologico stabile.',
            },
            {
                id: 'doc-3',
                date: '2025-03-10T00:00:00Z',
                fileName: 'vecchio-lab.pdf',
                summary: 'Esami ematici senza novita clinicamente rilevanti.',
            },
        ]),
        attachments: [
            {
                id: 'attachment-new',
                patientId: 'patient-1',
                name: 'follow-up-pneumo.pdf',
                summarySnapshot: 'Controllo pneumologico ravvicinato da programmare per addensamento basale.',
                createdAt: new Date('2025-03-27T00:00:00Z'),
            },
        ],
    });

    try {
        const { buildPatientInsightContext } = await import('./ai-context');
        const snapshot = await buildPatientInsightContext('patient-1');
        const documentRefs = snapshot.sourceRefs
            .filter((ref) => ref.section === 'Documenti recenti')
            .map((ref) => ref.promptLine);

        assert.equal(documentRefs.length, 3);
        assert.match(documentRefs[0] || '', /follow-up-pneumo\.pdf \(27\/03\/2025\): Controllo pneumologico ravvicinato/i);
        assert.match(documentRefs[1] || '', /lettera-specialistica\.pdf \(11\/03\/2025\): Sintesi: Follow-up cardiologico stabile/i);
        assert.match(documentRefs[2] || '', /vecchio-lab\.pdf \(10\/03\/2025\): Sintesi: Esami ematici senza novita clinicamente rilevanti/i);
        assert.ok(!snapshot.prompt.includes('profilo-cronico.pdf'));
        assert.match(
            snapshot.limitations.join('\n'),
            /Documenti cronici o stale sullo stesso dominio di fonti piu recenti sono stati de-prioritizzati/i,
        );
    } finally {
        restore();
    }
});

test('buildPatientInsightContext normalizes CDA-like recovered attachment text before rendering excerpts', async () => {
    const restore = await withHarness({
        documentInsights: JSON.stringify([]),
        attachments: [
            {
                id: 'attachment-cda',
                patientId: 'patient-1',
                name: 'dimissione-cda.xml',
                type: 'application/xml',
                data: 'data:application/xml;base64,ZmFrZQ==',
                summarySnapshot: 'Nessuna informazione rilevante trovata.',
                createdAt: new Date('2025-03-15T00:00:00Z'),
            },
        ],
    });

    try {
        const { buildPatientInsightContext } = await import('./ai-context');
        const snapshot = await buildPatientInsightContext('patient-1', {
            recoverAttachmentText: async () => `
                <ClinicalDocument>
                  <component>
                    <structuredBody>
                      <component>
                        <section>
                          <title>Indicazioni alla dimissione</title>
                          <text>
                            <paragraph>Controllo ortopedico tra 14 giorni</paragraph>
                            <paragraph>ADI infermieristica da proseguire</paragraph>
                          </text>
                        </section>
                      </component>
                    </structuredBody>
                  </component>
                </ClinicalDocument>
            `,
        });

        assert.match(snapshot.prompt, /dimissione-cda\.xml \(15\/03\/2025\): Estratto diretto allegato:/i);
        assert.match(snapshot.prompt, /Controllo ortopedico tra 14 giorni/i);
        assert.match(snapshot.prompt, /ADI infermieristica da proseguire/i);
        assert.doesNotMatch(snapshot.prompt, /ClinicalDocument/);
    } finally {
        restore();
    }
});

/* @Codex */
test('patient insight does not persist when the envelope task is duplicated', async () => {
    const restoreHarness = await withHarness();
    const { AIService } = await import('./ai-service');
    const { regeneratePatientSummary } = await import('./ai-summary-service');
    const { db } = await import('./db');
    const original = {
        getSetting: db.settings.get,
        getPatient: db.patients.get,
        updatePatient: db.patients.update,
        createAi: AIService.create,
    };
    let updates = 0;

    db.settings.get = (async () => ({ value: 'enabled' })) as typeof db.settings.get;
    db.patients.get = (async (id: string) => {
        const patient = await original.getPatient(id);
        return patient ? { ...patient, version: 1 } : undefined;
    }) as typeof db.patients.get;
    db.patients.update = (async () => {
        updates += 1;
    }) as typeof db.patients.update;
    AIService.create = (async () => ({
        getModelInfo: () => ({ provider: 'local', model: 'synthetic', baseUrl: 'http://127.0.0.1' }),
        generate: async () => '{"schemaVersion":"mediflow.ai.extract.v1","task":"smart_import","task":"patient_insight","summary":"Risposta duplicata","data":{"currentState":[],"alerts":[],"nextSteps":[],"gaps":[]}}',
    })) as unknown as typeof AIService.create;

    try {
        await assert.rejects(
            regeneratePatientSummary('patient-1'),
            /risposta non valida per il Patient Insight/i,
        );
        assert.equal(updates, 0);
    } finally {
        db.settings.get = original.getSetting;
        db.patients.get = original.getPatient;
        db.patients.update = original.updatePatient;
        AIService.create = original.createAi;
        restoreHarness();
    }
});

/* @Codex */
test('coerceInsightToReadable keeps recovering historical provider wrappers', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        const readable = coerceInsightToReadable(JSON.stringify({
            message: { content: '## Sintesi clinica\nFollow-up post-dimissione.' },
        }));
        assert.notEqual(readable.kind, 'unreadable');
    } finally {
        restore();
    }
});

/* @Codex */
test('coerceInsightToReadable marks an invalid declared envelope as unreadable', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        const readable = coerceInsightToReadable(JSON.stringify({
            schemaVersion: 'mediflow.ai.extract.v1',
            task: 'smart_import',
            summary: 'Task errato',
            data: {},
        }));
        assert.deepEqual(readable, { kind: 'unreadable', reason: 'json-envelope' });
    } finally {
        restore();
    }
});

/* @Codex */
test('coerceInsightToReadable rejects an invalid envelope embedded in a provider wrapper', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        const readable = coerceInsightToReadable(JSON.stringify({
            message: {
                content: JSON.stringify({
                    schemaVersion: 'mediflow.ai.extract.v1',
                    task: 'smart_import',
                    summary: 'Task errato incapsulato',
                    data: {},
                }),
            },
        }));
        assert.deepEqual(readable, { kind: 'unreadable', reason: 'json-envelope' });
    } finally {
        restore();
    }
});

/* @Codex */
test('coerceInsightToReadable renders a valid envelope embedded in a provider wrapper as structured', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        const readable = coerceInsightToReadable(JSON.stringify({
            message: {
                content: JSON.stringify({
                    schemaVersion: 'mediflow.ai.extract.v1',
                    task: 'patient_insight',
                    summary: 'Sintesi clinica sintetica',
                    data: { currentState: ['Paziente stabile.'], alerts: [], nextSteps: [], gaps: [] },
                }),
            },
        }));
        assert.equal(readable.kind, 'structured');
    } finally {
        restore();
    }
});

/* @Codex */
test('coerceInsightToReadable rejects a case-variant envelope with a mismatched task', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        const readable = coerceInsightToReadable(JSON.stringify({
            SchemaVersion: 'mediflow.ai.extract.v1',
            Task: 'smart_import',
            summary: 'Chiavi con case variante',
            data: {},
        }));
        assert.deepEqual(readable, { kind: 'unreadable', reason: 'json-envelope' });
    } finally {
        restore();
    }
});

/* @Codex */
test('coerceInsightToReadable rejects a mismatched envelope nested as object in a wrapper', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        const readable = coerceInsightToReadable(JSON.stringify({
            message: {
                content: {
                    schemaVersion: 'mediflow.ai.extract.v1',
                    task: 'smart_import',
                    summary: 'Envelope annidato come oggetto',
                    data: {},
                },
            },
        }));
        assert.deepEqual(readable, { kind: 'unreadable', reason: 'json-envelope' });
    } finally {
        restore();
    }
});

/* @Codex */
test('document analysis rejects an envelope with a mismatched task', async () => {
    const restoreHarness = await withHarness();
    const { AIService } = await import('./ai-service');
    const { db } = await import('./db');
    const { analyzeDocumentContent } = await import('./domain/documents/document-synthesis-service');
    const original = { getSetting: db.settings.get, createAi: AIService.create };

    db.settings.get = (async () => ({ value: 'enabled' })) as typeof db.settings.get;
    AIService.create = (async () => ({
        getModelInfo: () => ({ provider: 'local', model: 'synthetic', baseUrl: 'http://127.0.0.1' }),
        generate: async () => JSON.stringify({
            schemaVersion: 'mediflow.ai.extract.v1',
            task: 'smart_import',
            summary: 'Task errato per la sintesi',
            data: {},
        }),
    })) as unknown as typeof AIService.create;

    try {
        await assert.rejects(
            analyzeDocumentContent('Referto sintetico di prova'),
            /risposta non valida per l'analisi del documento/i,
        );
    } finally {
        db.settings.get = original.getSetting;
        AIService.create = original.createAi;
        restoreHarness();
    }
});

/* @Codex */
test('coerceInsightToReadable rejects a broken declared envelope that embeds markdown', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        const readable = coerceInsightToReadable(
            '{"schemaVersion":"mediflow.ai.extract.v1","task":"smart_import",\n**Riassunto clinico**: sintesi sintetica non valida',
        );
        assert.deepEqual(readable, { kind: 'unreadable', reason: 'json-envelope' });
    } finally {
        restore();
    }
});

/* @Codex */
test('coerceInsightToReadable keeps mixed markdown with plain json readable', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        const readable = coerceInsightToReadable(
            '**Riassunto clinico**: paziente stabile.\n```json\n{"note":"dato sintetico"}\n```',
        );
        assert.equal(readable.kind, 'structured');
    } finally {
        restore();
    }
});

/* @Codex: matrice resolver envelope (WUL-362) */
const VALID_INSIGHT_ENVELOPE = {
    schemaVersion: 'mediflow.ai.extract.v1',
    task: 'patient_insight',
    summary: 'Sintesi clinica sintetica',
    data: { currentState: ['Paziente stabile.'], alerts: [], nextSteps: [], gaps: [] },
};

/* @Codex */
test('resolver: direct valid patient insight envelope renders structured', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        const readable = coerceInsightToReadable(JSON.stringify(VALID_INSIGHT_ENVELOPE));
        assert.equal(readable.kind, 'structured');
    } finally {
        restore();
    }
});

/* @Codex */
test('resolver: valid envelope nested as object renders structured', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        const readable = coerceInsightToReadable(JSON.stringify({
            message: { content: VALID_INSIGHT_ENVELOPE },
        }));
        assert.equal(readable.kind, 'structured');
    } finally {
        restore();
    }
});

/* @Codex */
test('resolver: provider metadata keys around a valid inner envelope render structured', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        const readable = coerceInsightToReadable(JSON.stringify({
            schemaVersion: 'provider.response.v2',
            task: 'chat.completion',
            output: VALID_INSIGHT_ENVELOPE,
        }));
        assert.equal(readable.kind, 'structured');
    } finally {
        restore();
    }
});

/* @Codex */
test('resolver: partial mediflow wrapper does not shadow a complete inner envelope', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        const readable = coerceInsightToReadable(JSON.stringify({
            schemaVersion: 'mediflow.ai.extract.v1',
            response: VALID_INSIGHT_ENVELOPE,
        }));
        assert.equal(readable.kind, 'structured');
    } finally {
        restore();
    }
});

/* @Codex */
test('resolver: deeply nested smart import envelope stays unreadable', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        const readable = coerceInsightToReadable(JSON.stringify({
            choices: [{
                message: {
                    content: {
                        schemaVersion: 'mediflow.ai.extract.v1',
                        task: 'smart_import',
                        summary: 'Import annidato in profondita',
                        data: { diagnoses: [], therapies: [], servicePrescriptions: [] },
                    },
                },
            }],
        }));
        assert.deepEqual(readable, { kind: 'unreadable', reason: 'json-envelope' });
    } finally {
        restore();
    }
});

/* @Codex */
test('resolver: unsupported schema version with summary stays unreadable', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        const readable = coerceInsightToReadable(JSON.stringify({
            schemaVersion: 'mediflow.ai.extract.v2',
            task: 'patient_insight',
            summary: 'Schema non supportato',
            data: { currentState: ['Testo.'], alerts: [], nextSteps: [], gaps: [] },
        }));
        assert.deepEqual(readable, { kind: 'unreadable', reason: 'json-envelope' });
    } finally {
        restore();
    }
});

/* @Codex */
test('resolver: incompatible sibling envelopes stay unreadable', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        const readable = coerceInsightToReadable(JSON.stringify({
            first: VALID_INSIGHT_ENVELOPE,
            second: {
                schemaVersion: 'mediflow.ai.extract.v1',
                task: 'smart_import',
                summary: 'Envelope concorrente',
                data: { diagnoses: [], therapies: [], servicePrescriptions: [] },
            },
        }));
        assert.deepEqual(readable, { kind: 'unreadable', reason: 'json-envelope' });
    } finally {
        restore();
    }
});

/* @Codex */
const VALID_SMART_IMPORT_ENVELOPE = {
    schemaVersion: 'mediflow.ai.extract.v1',
    task: 'smart_import',
    summary: 'Import sintetico',
    data: { diagnoses: [], therapies: [], servicePrescriptions: [] },
};

/* @Codex */
test('resolver: broken declared envelope inside a nested string stays unreadable', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        const readable = coerceInsightToReadable(JSON.stringify({
            message: {
                content: '{"schemaVersion":"mediflow.ai.extract.v1","task":"smart_import",\n**Riassunto clinico**: testo del bypass',
            },
        }));
        assert.deepEqual(readable, { kind: 'unreadable', reason: 'json-envelope' });
    } finally {
        restore();
    }
});

/* @Codex */
test('resolver: fenced smart import envelope inside a wrapper string stays unreadable', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        const readable = coerceInsightToReadable(JSON.stringify({
            message: {
                content: '```json\n' + JSON.stringify(VALID_SMART_IMPORT_ENVELOPE) + '\n```',
            },
        }));
        assert.deepEqual(readable, { kind: 'unreadable', reason: 'json-envelope' });
    } finally {
        restore();
    }
});

/* @Codex */
test('resolver: node budget exhaustion resolves fail-closed, not readable', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        const readable = coerceInsightToReadable(JSON.stringify({
            noise: Array.from({ length: 260 }, () => ({})),
            payload: {
                schemaVersion: 'mediflow.ai.extract.v1',
                task: 'smart_import',
                content: 'testo del bypass 256 nodi',
                data: { diagnoses: [], therapies: [], servicePrescriptions: [] },
            },
        }));
        assert.deepEqual(readable, { kind: 'unreadable', reason: 'json-envelope' });
    } finally {
        restore();
    }
});

/* @Codex */
test('resolver: string parse budget exhaustion resolves fail-closed, not readable', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        const readable = coerceInsightToReadable(JSON.stringify({
            noise0: '{}', noise1: '{}', noise2: '{}', noise3: '{}',
            noise4: '{}', noise5: '{}', noise6: '{}', noise7: '{}',
            content: JSON.stringify(VALID_SMART_IMPORT_ENVELOPE),
        }));
        assert.deepEqual(readable, { kind: 'unreadable', reason: 'json-envelope' });
    } finally {
        restore();
    }
});

/* @Codex */
test('resolver: oversized nested string resolves fail-closed, not readable', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        const readable = coerceInsightToReadable(JSON.stringify({
            content: JSON.stringify({
                ...VALID_SMART_IMPORT_ENVELOPE,
                padding: 'x'.repeat(100001),
            }),
        }));
        assert.deepEqual(readable, { kind: 'unreadable', reason: 'json-envelope' });
    } finally {
        restore();
    }
});

/* @Codex: matrice contratto normativo WUL-362 (multi-frammento, parentela, soglie) */
test('resolver: innocuous fragment followed by wrong-task envelope stays unreadable', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        const readable = coerceInsightToReadable(
            '**Riassunto clinico**: paziente stabile.\n```json\n{"note":"example"}\n```\n```json\n'
            + JSON.stringify(VALID_SMART_IMPORT_ENVELOPE) + '\n```',
        );
        assert.deepEqual(readable, { kind: 'unreadable', reason: 'json-envelope' });
    } finally {
        restore();
    }
});

/* @Codex */
test('resolver: an innocuous fragment before patient insight is ambiguous', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        const readable = coerceInsightToReadable(
            'Nota introduttiva.\n```json\n{"note":"example"}\n```\n```json\n'
            + JSON.stringify(VALID_INSIGHT_ENVELOPE) + '\n```',
        );
        assert.deepEqual(readable, { kind: 'unreadable', reason: 'json-envelope' });
    } finally {
        restore();
    }
});

/* @Codex */
test('resolver: JSON arrays and prefixes before patient insight are ambiguous', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        const fence = `\`\`\`json\n${JSON.stringify(VALID_INSIGHT_ENVELOPE)}\n\`\`\``;

        for (const prefix of ['[1,2]', '[]', '[tru', '[nu']) {
            for (const response of [
                `${prefix}\n${fence}`,
                `\`\`\`json\n${prefix}\n\`\`\`\n${fence}`,
                `\`\`\`json\n${prefix}\n${JSON.stringify(VALID_INSIGHT_ENVELOPE)}\n\`\`\``,
            ]) {
                const readable = coerceInsightToReadable(response);
                assert.deepEqual(readable, { kind: 'unreadable', reason: 'json-envelope' }, prefix);
            }
        }
    } finally {
        restore();
    }
});

/* @Codex */
test('resolver: sibling declared-invalid envelope beside a valid one stays unreadable', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        const readable = coerceInsightToReadable(JSON.stringify({
            first: VALID_INSIGHT_ENVELOPE,
            second: {
                schemaVersion: 'mediflow.ai.extract.v2',
                task: 'patient_insight',
                summary: 'Unsupported',
                data: { currentState: ['Poison'], alerts: [], nextSteps: [], gaps: [] },
            },
        }));
        assert.deepEqual(readable, { kind: 'unreadable', reason: 'json-envelope' });
    } finally {
        restore();
    }
});

/* @Codex */
test('resolver: descendant declared-invalid inside a valid envelope stays unreadable', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        const readable = coerceInsightToReadable(JSON.stringify({
            ...VALID_INSIGHT_ENVELOPE,
            data: {
                ...VALID_INSIGHT_ENVELOPE.data,
                embedded: { schemaVersion: 'mediflow.ai.extract.v2', task: 'patient_insight' },
            },
        }));
        assert.deepEqual(readable, { kind: 'unreadable', reason: 'json-envelope' });
    } finally {
        restore();
    }
});

/* @Codex */
test('resolver: valid envelope deeper than the depth budget resolves fail-closed', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        let nested: unknown = VALID_INSIGHT_ENVELOPE;
        for (let index = 0; index < 9; index += 1) nested = { layer: nested };
        const readable = coerceInsightToReadable(JSON.stringify(nested));
        assert.deepEqual(readable, { kind: 'unreadable', reason: 'json-envelope' });
    } finally {
        restore();
    }
});

/* @Codex */
test('resolver: fragment budget boundary is exact', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        const fragments = (count: number) => Array.from({ length: count }, (_, i) => `{"i":${i}}`).join(' testo ');
        const within = coerceInsightToReadable('Testo iniziale ' + fragments(8));
        assert.notEqual(within.kind, 'unreadable');
        const beyond = coerceInsightToReadable('Testo iniziale ' + fragments(9));
        assert.deepEqual(beyond, { kind: 'unreadable', reason: 'json-envelope' });
    } finally {
        restore();
    }
});

/* @Codex */
test('resolver: char budget boundary is exact and checked before root parse', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        const basePayload = { content: '## Nota storica sintetica.', pad: '' };
        const baseLength = JSON.stringify(basePayload).length;
        const exact = JSON.stringify({ ...basePayload, pad: 'x'.repeat(400000 - baseLength) });
        assert.equal(exact.length, 400000);
        const within = coerceInsightToReadable(exact);
        assert.notEqual(within.kind, 'unreadable');
        const beyond = coerceInsightToReadable(JSON.stringify({ ...basePayload, pad: 'x'.repeat(400001 - baseLength) }));
        assert.deepEqual(beyond, { kind: 'unreadable', reason: 'json-envelope' });
    } finally {
        restore();
    }
});

/* @Codex */
test('resolver: node budget boundary is exact', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        const noise = (count: number) => ({
            content: '## Nota storica sintetica.',
            noise: Array.from({ length: count }, () => ({})),
        });
        const within = coerceInsightToReadable(JSON.stringify(noise(254)));
        assert.notEqual(within.kind, 'unreadable');
        const beyond = coerceInsightToReadable(JSON.stringify(noise(255)));
        assert.deepEqual(beyond, { kind: 'unreadable', reason: 'json-envelope' });
    } finally {
        restore();
    }
});

/* @Codex */
test('resolver: nested string at the exact length limit is classified, not truncated', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        const basePayload = {
            schemaVersion: 'mediflow.ai.extract.v1',
            task: 'smart_import',
            summary: 'soglia',
            data: { diagnoses: [], therapies: [], servicePrescriptions: [] },
            padding: '',
        };
        const baseLength = JSON.stringify(basePayload).length;
        const exact = JSON.stringify({ ...basePayload, padding: 'p'.repeat(100000 - baseLength) });
        assert.equal(exact.length, 100000);
        const readable = coerceInsightToReadable(JSON.stringify({ content: exact }));
        assert.deepEqual(readable, { kind: 'unreadable', reason: 'json-envelope' });
    } finally {
        restore();
    }
});

/* @Codex */
test('resolver: eighth nested string is still parsed before the budget trips', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        const readable = coerceInsightToReadable(JSON.stringify({
            noise0: '{"j":0}', noise1: '{"j":1}', noise2: '{"j":2}', noise3: '{"j":3}',
            noise4: '{"j":4}', noise5: '{"j":5}', noise6: '{"j":6}',
            content: JSON.stringify(VALID_SMART_IMPORT_ENVELOPE),
        }));
        assert.deepEqual(readable, { kind: 'unreadable', reason: 'json-envelope' });
    } finally {
        restore();
    }
});

/* @Codex */
test('resolver: bare known task in a historical demo snippet stays readable', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        const readable = coerceInsightToReadable(
            '**Riassunto clinico**: paziente stabile.\n\nEsempio tecnico:\n```json\n{"task":"smart_import","example":true}\n```',
        );
        assert.equal(readable.kind, 'structured');
    } finally {
        restore();
    }
});

/* @Codex */
test('resolver: known task with summary is a modern declaration and fails closed', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        const readable = coerceInsightToReadable('{"task":"smart_import","summary":"solo accompagnamento"}');
        assert.deepEqual(readable, { kind: 'unreadable', reason: 'json-envelope' });
    } finally {
        restore();
    }
});

/* @Codex */
test('resolver: compatible schemaVersion alone is a modern declaration and fails closed', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        const readable = coerceInsightToReadable('{"schemaVersion":"mediflow.ai.extract.v1","note":"solo schema"}');
        assert.deepEqual(readable, { kind: 'unreadable', reason: 'json-envelope' });
    } finally {
        restore();
    }
});

/* @Codex: controesempi della review di conformita (ciclo fix) */
test('resolver: single-quoted pseudo envelope in a nested string stays unreadable', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        const readable = coerceInsightToReadable(JSON.stringify({
            content: "{'schemaVersion':'mediflow.ai.extract.v1','task':'smart_import','summary':'errato'}\n**Riassunto clinico**: bypass leggibile",
        }));
        assert.deepEqual(readable, { kind: 'unreadable', reason: 'json-envelope' });
    } finally {
        restore();
    }
});

/* @Codex */
test('resolver: duplicate conflicting task keys stay unreadable', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        const readable = coerceInsightToReadable(
            '{"schemaVersion":"mediflow.ai.extract.v1","task":"smart_import","task":"patient_insight","summary":"Conflitto","data":{"currentState":["Accettato"],"alerts":[],"nextSteps":[],"gaps":[]}}',
        );
        assert.deepEqual(readable, { kind: 'unreadable', reason: 'json-envelope' });
    } finally {
        restore();
    }
});

/* @Codex */
test('resolver: duplicate modern envelope in a stringified layer stays unreadable', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        const readable = coerceInsightToReadable(JSON.stringify({
            content: '{"schemaVersion":"mediflow.ai.extract.v1","task":"smart_import","task":"patient_insight","summary":"Conflitto","data":{"currentState":[],"alerts":[],"nextSteps":[],"gaps":[]}}',
        }));
        assert.deepEqual(readable, { kind: 'unreadable', reason: 'json-envelope' });
    } finally {
        restore();
    }
});

/* @Codex */
test('resolver: separate historical task fragments remain readable', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        const readable = coerceInsightToReadable(
            '**Riassunto clinico**: paziente stabile.\n```json\n{"task":"smart_import","example":true}\n```\n'
            + '```json\n{"task":"patient_insight","example":true}\n```',
        );
        assert.equal(readable.kind, 'structured');
    } finally {
        restore();
    }
});

/* @Codex */
test('resolver: whitespace padding cannot bypass the root char budget', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        const readable = coerceInsightToReadable(' '.repeat(400001) + JSON.stringify(VALID_INSIGHT_ENVELOPE));
        assert.deepEqual(readable, { kind: 'unreadable', reason: 'json-envelope' });
    } finally {
        restore();
    }
});

/* @Codex */
test('resolver: whitespace padding cannot bypass the nested string limit', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        const readable = coerceInsightToReadable(JSON.stringify({
            content: ' '.repeat(100001) + '**Riassunto clinico**: oltre limite {nota}',
        }));
        assert.deepEqual(readable, { kind: 'unreadable', reason: 'json-envelope' });
    } finally {
        restore();
    }
});

/* @Codex */
test('resolver: an unclosed opener does not hide a later valid envelope', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        const readable = coerceInsightToReadable('prefisso { non chiuso ' + JSON.stringify(VALID_INSIGHT_ENVELOPE));
        assert.equal(readable.kind, 'structured');
    } finally {
        restore();
    }
});

/* WUL-362 F2: un marcatore canonico [Sx] non e un candidato JSON e non consuma
   il budget frammenti; le parentesi bilanciate da sole non provano una
   candidatura JSON. Nove candidati JSON reali restano fail-closed. */

const CANONICAL_INSIGHT_WITH_CITATIONS = [
    '**Quadro attuale:** paziente stabile in follow-up territoriale [S1] [S2] [S3].',
    '',
    '**Attenzioni:**',
    '- Controllo pressorio domiciliare da proseguire [S4] [S5]',
    '- Aderenza terapeutica da confermare al prossimo accesso [S6]',
    '',
    '**Prossimi passi:**',
    '- Rivalutazione ambulatoriale programmata [S7] [S8]',
    '- Esami ematochimici di controllo [S9] [S10]',
].join('\n');

/* @Codex WUL-362 R5b: fixture fedele alla distribuzione avversa della review. */
const DISTRIBUTED_CANDIDATE_INSIGHT = JSON.stringify({
    content: '**Riassunto clinico**: testo storico sintetico leggibile.',
    ...Object.fromEntries(
        Array.from({ length: 9 }, (_, index) => [`c${index}`, `[S${index + 1}]`]),
    ),
    ...Object.fromEntries(
        Array.from({ length: 8 }, (_, index) => [
            `s${index}`,
            index === 7
                ? `${JSON.stringify({ i: index })} text ${JSON.stringify({ i: 8 })}`
                : JSON.stringify({ i: index }),
        ]),
    ),
});

test('resolver: canonical insight markdown with more than eight citations stays readable', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        const readable = coerceInsightToReadable(CANONICAL_INSIGHT_WITH_CITATIONS);
        // Leggibile in entrambe le forme (structured o markdown): il contratto
        // F2 vieta solo l'esito unreadable da esaurimento budget citazioni.
        assert.notEqual(readable.kind, 'unreadable');
    } finally {
        restore();
    }
});

/* @Codex WUL-362 R5: summary + otto claim citati sono il massimo valido. */
test('resolver: valid patient insight with citations across all allowed strings stays structured', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        const readable = coerceInsightToReadable(JSON.stringify({
            schemaVersion: 'mediflow.ai.extract.v1',
            task: 'patient_insight',
            summary: 'Sintesi clinica sintetica [S1]',
            data: {
                currentState: ['Quadro sintetico uno [S2]', 'Quadro sintetico due [S3]'],
                alerts: ['Attenzione sintetica uno [S4]', 'Attenzione sintetica due [S5]'],
                nextSteps: [
                    'Passo sintetico uno [S6]',
                    'Passo sintetico due [S7]',
                    'Passo sintetico tre [S8]',
                ],
                gaps: ['Gap sintetico [S9]'],
            },
        }));
        assert.equal(readable.kind, 'structured');
    } finally {
        restore();
    }
});

test('detection: canonical citation markers beyond the fragment budget stay absent', async () => {
    const { detectModernEnvelopeEvidence } = await import('./ai-task-contracts');
    assert.equal(detectModernEnvelopeEvidence(CANONICAL_INSIGHT_WITH_CITATIONS), 'absent');
});

test('resolver: citations never launder a wrong-task envelope into readability', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        const readable = coerceInsightToReadable(
            `${CANONICAL_INSIGHT_WITH_CITATIONS}\n\n\`\`\`json\n${JSON.stringify(VALID_SMART_IMPORT_ENVELOPE)}\n\`\`\``,
        );
        assert.deepEqual(readable, { kind: 'unreadable', reason: 'json-envelope' });
    } finally {
        restore();
    }
});

test('detection: nine real JSON candidates without evidence stay unknown', async () => {
    const { detectModernEnvelopeEvidence } = await import('./ai-task-contracts');
    const text = Array.from({ length: 9 }, (_, index) => `{"i":${index}}`).join(' testo ');
    assert.equal(detectModernEnvelopeEvidence(text), 'unknown');
});

test('detection: cited strings share one global real-candidate budget', async () => {
    const { detectModernEnvelopeEvidence } = await import('./ai-task-contracts');
    assert.notEqual(detectModernEnvelopeEvidence(DISTRIBUTED_CANDIDATE_INSIGHT), 'absent');
});

test('resolver: cited strings share one global real-candidate budget', async () => {
    const { resolveInsightEnvelope } = await import('./ai-task-contracts');
    assert.notEqual(resolveInsightEnvelope(DISTRIBUTED_CANDIDATE_INSIGHT).status, 'legacy-text');
});

test('resolver: distributed candidate budget exhaustion never becomes structured legacy text', async () => {
    const restore = await withHarness();
    try {
        const { coerceInsightToReadable } = await import('./patient-insight-view-model');
        assert.notEqual(coerceInsightToReadable(DISTRIBUTED_CANDIDATE_INSIGHT).kind, 'structured');
    } finally {
        restore();
    }
});

/* @Codex */
test('smart import generation rejects an envelope with a mismatched task', async () => {
    const restoreHarness = await withHarness();
    const { AIService } = await import('./ai-service');
    const { db } = await import('./db');
    const { generatePatientSmartImportAnalysis } = await import('./domain/documents/patient-smart-import-service');
    const original = {
        getSetting: db.settings.get,
        getPatient: db.patients.get,
        filterEntries: db.entries.filter,
        filterAttachments: db.attachments.filter,
        filterTherapies: db.therapies.filter,
        createAi: AIService.create,
    };

    db.settings.get = (async () => ({ value: 'enabled' })) as typeof db.settings.get;
    db.patients.get = (async () => ({
        id: 'patient-1',
        firstName: 'Paziente',
        lastName: 'Sintetico',
        diagnoses: [],
        version: 1,
    })) as unknown as typeof db.patients.get;
    db.entries.filter = (() => ({
        toArray: async () => [{
            id: 'entry-1',
            patientId: 'patient-1',
            type: 'note',
            title: 'Nota clinica',
            content: 'Contenuto clinico sintetico sufficiente come sorgente smart import.',
            date: new Date('2026-01-01T10:00:00Z'),
        }],
    })) as unknown as typeof db.entries.filter;
    db.attachments.filter = (() => ({ toArray: async () => [] })) as unknown as typeof db.attachments.filter;
    db.therapies.filter = (() => ({ toArray: async () => [] })) as unknown as typeof db.therapies.filter;
    AIService.create = (async () => ({
        getModelInfo: () => ({ provider: 'local', model: 'synthetic', baseUrl: 'http://127.0.0.1' }),
        generate: async () => JSON.stringify({
            schemaVersion: 'mediflow.ai.extract.v1',
            task: 'patient_insight',
            summary: 'Task errato per lo smart import',
            data: {},
        }),
    })) as unknown as typeof AIService.create;

    try {
        await assert.rejects(
            generatePatientSmartImportAnalysis('patient-1'),
            /risposta non valida per lo smart import/i,
        );
    } finally {
        db.settings.get = original.getSetting;
        db.patients.get = original.getPatient;
        db.entries.filter = original.filterEntries;
        db.attachments.filter = original.filterAttachments;
        db.therapies.filter = original.filterTherapies;
        AIService.create = original.createAi;
        restoreHarness();
    }
});
