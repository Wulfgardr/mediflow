/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import { AIService } from '../../ai-service';
import { db } from '../../db';
import { buildStoredDocumentExcerpt } from './document-excerpt';
/* @Codex */
import { routeDocumentClassForSynthesis } from './document-synthesis-routing';
/* @Codex */
import { rememberPdfDocumentMetadata } from '../../pdf-document-metadata';
import { parseStructuredAnalysisResponse } from './document-synthesis-parser';
import { parseDocumentIntelligenceCasePack } from './document-intelligence-case-pack';
/* @Codex */
import { decideDocumentRouterControlFlow, DOCUMENT_ROUTER_CONTROL_FLOW_SETTING_KEY } from './document-router-control-flow';
/* @Codex */
import { selectDocumentSynthesisAnalysis, synthesizeDocument } from './document-synthesis-service';
import {
    buildDocumentParseEvidenceArtifact,
    evaluateDocumentParseEvidenceArtifact,
    parseDocumentParseEvidenceArtifactSnapshot,
    projectDocumentEvidencePack,
    serializeDocumentParseEvidenceArtifact,
} from './document-parse-evidence-artifact';

test('shadow synthesis calls the model without waiting for a pending audit write', async () => {
    const rawMarkdown = 'Referto di laboratorio con determinazione risultato e intervalli di riferimento. '.repeat(2);
    const routed = routeDocumentClassForSynthesis(rawMarkdown, '2026-07-12__laboratorio__synthetic.pdf');
    const routerDecision = decideDocumentRouterControlFlow({
        documentSynthesisKillSwitchValue: 'enabled',
        mode: 'shadow',
        routed,
        normalizedText: rawMarkdown,
    });
    let modelCalls = 0;
    let auditCalls = 0;
    const pendingAudit = () => {
        auditCalls += 1;
        return new Promise<void>(() => undefined);
    };

    const analysis = await Promise.race([
        selectDocumentSynthesisAnalysis({
            rawMarkdown,
            normalizedText: rawMarkdown,
            routed,
            routerMode: 'shadow',
            routerDecision,
            recordShadow: pendingAudit,
            analyze: async () => {
                modelCalls += 1;
                return {
                    summary: 'Sintesi modello sintetica',
                    quality: { level: 'green', reason: 'Test sintetico' },
                    medications: [],
                    diagnoses: [],
                    problemStatements: [],
                    therapyCandidates: [],
                    servicePrescriptions: [],
                };
            },
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('audit blocked synthesis')), 75)),
    ]);

    assert.equal(modelCalls, 1);
    assert.equal(auditCalls, 1);
    assert.equal(analysis.summary, 'Sintesi modello sintetica');
});

test('off synthesis preserves model output and never dispatches the shadow audit', async () => {
    const rawMarkdown = 'Referto di laboratorio con determinazione risultato e intervalli di riferimento. '.repeat(2);
    const routed = routeDocumentClassForSynthesis(rawMarkdown, '2026-07-12__laboratorio__synthetic.pdf');
    const routerDecision = decideDocumentRouterControlFlow({
        documentSynthesisKillSwitchValue: 'enabled',
        mode: 'off',
        routed,
        normalizedText: rawMarkdown,
    });
    let auditCalls = 0;
    const expected = {
        summary: 'Output modello invariato',
        quality: { level: 'green' as const, reason: 'Test sintetico' },
        medications: [],
        diagnoses: [],
        problemStatements: [],
        therapyCandidates: [],
        servicePrescriptions: [],
    };

    const analysis = await selectDocumentSynthesisAnalysis({
        rawMarkdown,
        normalizedText: rawMarkdown,
        routed,
        routerMode: 'off',
        routerDecision,
        recordShadow: async () => { auditCalls += 1; },
        analyze: async () => expected,
    });

    assert.equal(auditCalls, 0);
    assert.deepEqual(analysis, expected);
});

test('shadow synthesis absorbs a rejected audit write and preserves model output', async (context) => {
    const rawMarkdown = 'Referto di laboratorio con determinazione risultato e intervalli di riferimento. '.repeat(2);
    const routed = routeDocumentClassForSynthesis(rawMarkdown, '2026-07-12__laboratorio__synthetic.pdf');
    const routerDecision = decideDocumentRouterControlFlow({
        documentSynthesisKillSwitchValue: 'enabled',
        mode: 'shadow',
        routed,
        normalizedText: rawMarkdown,
    });
    const warn = context.mock.method(console, 'warn', () => undefined);
    const analysis = await selectDocumentSynthesisAnalysis({
        rawMarkdown,
        normalizedText: rawMarkdown,
        routed,
        routerMode: 'shadow',
        routerDecision,
        recordShadow: async () => { throw new Error('synthetic audit failure'); },
        analyze: async () => ({
            summary: 'Output modello invariato',
            quality: { level: 'green', reason: 'Test sintetico' },
            medications: [],
            diagnoses: [],
            problemStatements: [],
            therapyCandidates: [],
            servicePrescriptions: [],
        }),
    });
    await Promise.resolve();

    assert.equal(analysis.summary, 'Output modello invariato');
    assert.equal(warn.mock.callCount(), 1);
});

test('parses explicit medications from the model JSON payload', () => {
    const analysis = parseStructuredAnalysisResponse(
        JSON.stringify({
            summary_markdown: '**Terapia domiciliare**',
            quality: { level: 'green', reason: 'Documento chiaro' },
            medications: [
                'Lasix 25 mg 1 cp al mattino',
                'Metformina 500 mg x 2/die',
                'Lasix 25 mg 1 cp al mattino',
            ],
            diagnoses: [],
            problemStatements: [
                {
                    label: 'Scompenso cardiaco',
                    icdQuery: 'heart failure',
                    confidence: 'high',
                    evidence: 'Scompenso cardiaco in terapia domiciliare',
                },
            ],
            therapyCandidates: [
                {
                    drugMention: 'Lasix',
                    drugQuery: 'furosemide',
                    activePrinciple: 'furosemide',
                    dosage: '25 mg 1 cp al mattino',
                    confidence: 'high',
                    evidence: 'Lasix 25 mg 1 cp al mattino',
                    therapyState: 'active',
                },
            ],
        }),
        'terapia domiciliare esplicita',
    );

    assert.deepEqual(analysis.medications, [
        'Lasix 25 mg 1 cp al mattino',
        'Metformina 500 mg x 2/die',
    ]);
    assert.equal(analysis.problemStatements.length, 1);
    assert.equal(analysis.therapyCandidates.length, 1);
    assert.equal(analysis.quality?.level, 'green');
});

test('falls back to empty medications when the model returns invalid JSON', () => {
    const analysis = parseStructuredAnalysisResponse('not-json', 'testo OCR rumoroso');

    assert.equal(analysis.validJson, false);
    assert.equal(analysis.validTask, false);
    assert.deepEqual(analysis.medications, []);
    assert.equal(analysis.quality?.level, 'yellow');
});

/* @Codex */
test('document synthesis does not persist or autofill when the envelope task is invalid', async () => {
    const original = {
        getSetting: db.settings.get,
        getPatient: db.patients.get,
        updatePatient: db.patients.update,
        createAi: AIService.create,
    };
    let updates = 0;

    db.settings.get = (async (key: string) => ({
        value: key === DOCUMENT_ROUTER_CONTROL_FLOW_SETTING_KEY ? 'off' : 'enabled',
    })) as unknown as typeof db.settings.get;
    db.patients.get = (async () => ({
        id: 'patient-contract-gate',
        version: 1,
        documentInsights: [],
        diagnoses: [],
    })) as unknown as typeof db.patients.get;
    db.patients.update = (async () => {
        updates += 1;
    }) as unknown as typeof db.patients.update;
    AIService.create = (async () => ({
        generate: async () => JSON.stringify({
            schemaVersion: 'mediflow.ai.extract.v1',
            task: 'smart_import',
            summary: 'Risposta con task errato',
            data: {},
        }),
    })) as unknown as typeof AIService.create;

    try {
        await assert.rejects(
            synthesizeDocument('Referto sintetico.', '2026-07-02__referto__synthetic.pdf', 'patient-contract-gate'),
            /risposta non valida per la sintesi/i,
        );
        assert.equal(updates, 0);
    } finally {
        db.settings.get = original.getSetting;
        db.patients.get = original.getPatient;
        db.patients.update = original.updatePatient;
        AIService.create = original.createAi;
    }
});

test('buildStoredDocumentExcerpt keeps high-signal sections in clinical order', () => {
    const excerpt = buildStoredDocumentExcerpt([
        'Intestazione amministrativa ripetuta',
        ...Array.from({ length: 90 }, (_, index) => `rumore burocratico ${index + 1}`),
        'Diagnosi alla dimissione',
        'Scompenso cardiaco congestizio in paziente diabetico',
        'Terapia domiciliare',
        'Furosemide 25 mg 1 cp al mattino',
        'Metformina 500 mg 1 cp x 2/die',
        'Indicazioni alla dimissione',
        'Controllo cardiologico tra 7 giorni',
        'ADI infermieristica da proseguire',
        ...Array.from({ length: 90 }, (_, index) => `appendice descrittiva ${index + 1}`),
    ].join('\n'));

    assert.match(excerpt, /Diagnosi alla dimissione/);
    assert.match(excerpt, /Scompenso cardiaco congestizio/);
    assert.match(excerpt, /Terapia domiciliare/);
    assert.match(excerpt, /Furosemide 25 mg 1 cp al mattino/);
    assert.match(excerpt, /Controllo cardiologico tra 7 giorni/);
    assert.match(excerpt, /ADI infermieristica da proseguire/);
    assert.ok(excerpt.indexOf('Diagnosi alla dimissione') < excerpt.indexOf('Terapia domiciliare'));
    assert.ok(excerpt.indexOf('Terapia domiciliare') < excerpt.indexOf('Indicazioni alla dimissione'));
});

test('buildStoredDocumentExcerpt rescues signal from OCR-like single-line documents', () => {
    const excerpt = buildStoredDocumentExcerpt([
        'Intestazione amministrativa ripetuta',
        ...Array.from({ length: 40 }, (_, index) => `rumore ${index + 1}`),
        'Diagnosi alla dimissione',
        'Esiti di frattura femorale in recupero funzionale',
        'Terapia domiciliare',
        'Pregabalin 75 mg 1 cp ore 8',
        'Indicazioni alla dimissione',
        'Controllo ortopedico tra 10 giorni.',
        'FKT domiciliare bisettimanale.',
        'Cammino con ausilio e ridotta autonomia sulle scale.',
    ].join('  '));

    assert.match(excerpt, /Diagnosi alla dimissione/);
    assert.match(excerpt, /Indicazioni alla dimissione/);
    assert.match(excerpt, /Controllo ortopedico tra 10 giorni/);
    assert.match(excerpt, /FKT domiciliare bisettimanale/);
});

test('routeDocumentClassForSynthesis includes remembered PDF producer metadata', () => {
    const rawMarkdown = 'Risultato Valore Unita';
    rememberPdfDocumentMetadata('scan.pdf', rawMarkdown, {
        producer: 'JasperReports Library version 6.20',
        creator: 'Clinical Laboratory Exporter',
    });

    const routed = routeDocumentClassForSynthesis(rawMarkdown, 'scan.pdf');

    assert.equal(routed.classification, 'lab_report');
    assert.ok(routed.signals.includes('producer:known'));
});

test('buildDocumentParseEvidenceArtifact passes the canonical parser/evidence chamber on the baseline discharge case', () => {
    const casePack = parseDocumentIntelligenceCasePack({
        schemaVersion: 'mediflow.document_case_pack.v1',
        id: 'doc-lab-discharge-femur-001',
        archetype: 'discharge-letter',
        title: 'Dimissione ortopedica con follow-up e rumore anamnestico',
        sourceText: 'Lettera di dimissione ortopedica del 20/03/2026. Diagnosi: frattura pertrocanterica del femore sinistro trattata chirurgicamente. Terapia alla dimissione: Torasemide 10 mg 1 cp al mattino. Indicazioni: controllo ortopedico tra 7 giorni, fisioterapia domiciliare 3 volte/settimana, ADI infermieristica per medicazione ferita. Stato funzionale: deambulazione con deambulatore e ridotta autonomia nei trasferimenti. Anamnesi remota: pregressa frattura di polso destro guarita. Familiarita: madre con carcinoma mammario.',
        ocrVariant: 'Lettera di dimissione ortopedica del 20/03/2026. Diagnosi: frattura pertrocantcrica del femore sinistro trattata chirurgicamcnte. Terapia alla dimissione: Torasemide 10 mg 1 cp al mattino. Indicazioni: controllo ortopedico tra 7 giomi, fisioterapia domiciliare 3 volte/settimana, ADl infermieristica per medicazione ferita. Stato funzionale: deambulazione con deambulatore e ridotta autonomia nei trasferimenti.',
        goldFacts: [
            {
                kind: 'problem',
                label: 'Frattura pertrocanterica del femore sinistro',
                excerpt: 'Diagnosi: frattura pertrocanterica del femore sinistro trattata chirurgicamente.',
                temporality: 'current',
                status: 'active',
                origin: 'documented',
                codingHints: {
                    system: 'ICD-10',
                    code: 'S72.1',
                    icdQuery: 'pertrochanteric fracture of left femur',
                },
            },
            {
                kind: 'medication',
                label: 'Torasemide 10 mg 1 cp al mattino',
                excerpt: 'Terapia alla dimissione: Torasemide 10 mg 1 cp al mattino.',
                temporality: 'current',
                status: 'active',
                origin: 'documented',
                codingHints: {
                    aifaQuery: 'torasemide 10 mg compressa',
                },
            },
            {
                kind: 'followup',
                label: 'Controllo ortopedico tra 7 giorni',
                excerpt: 'Indicazioni: controllo ortopedico tra 7 giorni.',
                temporality: 'planned',
                status: 'planned',
                origin: 'documented',
            },
            {
                kind: 'care_setting',
                label: 'ADI infermieristica per medicazione ferita',
                excerpt: 'ADI infermieristica per medicazione ferita.',
                temporality: 'planned',
                status: 'planned',
                origin: 'documented',
            },
            {
                kind: 'functional_status',
                label: 'Deambulazione con deambulatore e ridotta autonomia nei trasferimenti',
                excerpt: 'Stato funzionale: deambulazione con deambulatore e ridotta autonomia nei trasferimenti.',
                temporality: 'current',
                status: 'uncertain',
                origin: 'documented',
            },
        ],
        expectedEvidencePack: {
            requiredKinds: ['problem', 'medication', 'followup', 'care_setting', 'functional_status'],
        },
        negativeAssertions: [
            {
                label: 'Carcinoma mammario materno',
                reason: 'family_history',
                note: 'Non deve emergere come problema attivo del paziente.',
            },
            {
                label: 'Pregressa frattura di polso destro',
                reason: 'historical_only',
                note: 'Anamnesi remota non rilevante per il follow-up corrente.',
            },
        ],
    });

    const diagnoses = casePack.goldFacts
        .filter((fact) => fact.kind === 'problem' && fact.codingHints?.system && fact.codingHints?.code)
        .map((fact) => ({
            code: fact.codingHints?.code as string,
            description: fact.label,
            system: fact.codingHints?.system as 'ICD-9' | 'ICD-10' | 'ICD-11',
            evidence: fact.excerpt,
            confidence: 'high' as const,
        }));
    const medications = casePack.goldFacts
        .filter((fact) => fact.kind === 'medication')
        .map((fact) => fact.label);

    const artifact = buildDocumentParseEvidenceArtifact({
        documentInsightId: 'doc-1',
        attachmentId: 'attachment-1',
        fileName: 'dimissione.pdf',
        documentDate: '2026-03-20T00:00:00.000Z',
        qualityLevel: 'green',
        qualityReason: 'Documento leggibile e coerente',
        summary: 'Dimissione ortopedica con terapia, follow-up e setting domiciliare.',
        rawMarkdown: casePack.sourceText,
        diagnoses,
        medications,
    });

    const evaluation = evaluateDocumentParseEvidenceArtifact(casePack, artifact);
    const evidencePack = projectDocumentEvidencePack(artifact);
    const parsedArtifact = parseDocumentParseEvidenceArtifactSnapshot(
        serializeDocumentParseEvidenceArtifact(artifact),
    );

    assert.deepEqual(evaluation.missingKinds, []);
    assert.deepEqual(evaluation.leakedNegativeAssertions, []);
    assert.deepEqual(
        evaluation.presentKinds.sort(),
        ['care_setting', 'followup', 'functional_status', 'medication', 'problem'].sort(),
    );
    assert.equal(artifact.source.attachmentId, 'attachment-1');
    assert.equal(artifact.parseBundle.parserDiagnostics.lineCount, 1);
    assert.ok(artifact.evidenceMemory.sourceGovernance);
    assert.equal(artifact.evidenceMemory.sourceGovernance.freshness, 'recent');
    assert.match(
        artifact.evidenceMemory.sourceGovernance.suppressedCandidates.map((candidate) => candidate.label).join('\n'),
        /carcinoma mammario/i,
    );
    assert.match(
        artifact.evidenceMemory.sourceGovernance.suppressedCandidates.map((candidate) => candidate.label).join('\n'),
        /frattura di polso/i,
    );
    assert.equal(
        parsedArtifact?.evidenceMemory.sourceGovernance?.suppressedCandidates.length,
        artifact.evidenceMemory.sourceGovernance.suppressedCandidates.length,
    );
    assert.equal(evidencePack.facts.length, artifact.evidenceMemory.facts.length);
    assert.equal(
        evidencePack.sourceGovernance?.suppressedCandidates.length,
        artifact.evidenceMemory.sourceGovernance.suppressedCandidates.length,
    );
    assert.match(
        evidencePack.facts.map((fact) => fact.label).join('\n'),
        /Frattura pertrocanterica del femore sinistro/,
    );
    assert.doesNotMatch(
        evidencePack.facts.map((fact) => fact.label).join('\n'),
        /Carcinoma mammario|frattura di polso/i,
    );
});

test('buildDocumentParseEvidenceArtifact maps sections, anchors facts, and keeps therapy context conflicts explicit', () => {
    const rawMarkdown = [
        'Diagnosi: Scompenso cardiaco riacutizzato.',
        'Terapia corrente: Furosemide 25 mg 1 cp ore 8.',
        'Terapia alla dimissione: Furosemide 50 mg 1 cp ore 8.',
        'Indicazioni: dieta iposodica e controllo peso quotidiano.',
        'Follow-up: controllo cardiologico tra 7 giorni.',
    ].join('\n');

    const artifact = buildDocumentParseEvidenceArtifact({
        documentInsightId: 'doc-section-aware-1',
        attachmentId: 'attachment-section-aware-1',
        fileName: 'dimissione-section-aware.pdf',
        documentDate: '2026-04-10T00:00:00.000Z',
        qualityLevel: 'green',
        summary: 'Dimissione con terapia corrente, terapia alla dimissione e follow-up separati.',
        rawMarkdown,
        diagnoses: [{
            code: 'I50.9',
            description: 'Scompenso cardiaco riacutizzato',
            system: 'ICD-10',
            evidence: 'Diagnosi: Scompenso cardiaco riacutizzato.',
            confidence: 'high',
        }],
        medications: ['Furosemide 25 mg 1 cp ore 8', 'Furosemide 50 mg 1 cp ore 8'],
    });

    const sectionMap = artifact.parseBundle.sectionMap;
    assert.ok(sectionMap);
    assert.equal(sectionMap.diagnostics.unanchoredFactCount, 0);
    const sectionKinds = Array.from(new Set(sectionMap.sections.map((section) => section.kind))).sort();
    assert.deepEqual(sectionKinds, ['current_or_ward_medication', 'diagnosis', 'discharge_medication', 'followup', 'recommendations'].sort());

    const currentTherapyAnchor = sectionMap.factAnchors.find((anchor) => anchor.factKind === 'medication' && /25 mg/.test(anchor.snippet));
    const dischargeTherapyAnchor = sectionMap.factAnchors.find((anchor) => anchor.factKind === 'medication' && /50 mg/.test(anchor.snippet));

    assert.equal(currentTherapyAnchor?.sectionKind, 'current_or_ward_medication');
    assert.equal(dischargeTherapyAnchor?.sectionKind, 'discharge_medication');
    assert.ok(sectionMap.factAnchors.every((anchor) => anchor.page >= 1));
    assert.match(sectionMap.conflicts.map((conflict) => conflict.type).join('\n'), /medication_context_overlap/);

    const parsedArtifact = parseDocumentParseEvidenceArtifactSnapshot(serializeDocumentParseEvidenceArtifact(artifact));
    assert.equal(parsedArtifact?.parseBundle.sectionMap?.diagnostics.conflictCount, 1);
});
