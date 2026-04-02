import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import Module from 'node:module';

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

async function withHarness() {
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
                documentInsights: JSON.stringify([
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

    dbModule.db.attachments.filter = stubFilter([
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
        assert.match(prompt, /referto-lab\.pdf: Sintesi: Azotemia in lieve aumento/);
        assert.match(prompt, /dimissione\.pdf: Problemi documentati: ICD-10 S72\.1: Frattura pertrocanterica del femore sinistro/i);
        assert.match(prompt, /Terapie documentate: Duloxetina 60 mg 1 cp ore 20; Pregabalin 75 mg 1 cp ore 8/i);
        assert.match(prompt, /Follow-up documentato: FKT domiciliare 2-3 volte alla settimana \[programmato, pianificato\]/i);
        assert.ok(!prompt.includes('ps.pdf'));
        assert.match(prompt, /eco-cuore\.pdf: Funzione sistolica conservata/);
        assert.ok(!prompt.includes('rx-polmoni.pdf'));
        assert.match(snapshot.limitations.join('\n'), /note narrative della scheda sono state escluse/i);
        assert.match(snapshot.limitations.join('\n'), /contesto documentale AI e stato ridotto a 3 documenti/i);
        assert.match(snapshot.limitations.join('\n'), /documenti ai sovrapposti sullo stesso episodio sono stati consolidati/i);
        assert.match(prompt, /\[TERAPIE ATTIVE\][\s\S]*Ramipril 5 mg\/die/i);
        assert.match(prompt, /sezione TERAPIE ATTIVE come fonte primaria della terapia corrente/i);
    } finally {
        restore();
    }
});
