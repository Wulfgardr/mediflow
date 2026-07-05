/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DOCUMENT_EVIDENCE_PACK_SCHEMA_VERSION,
    buildDocumentEvidencePack,
    renderDocumentEvidencePackContext,
    renderDocumentEvidencePackLines,
} from './document-evidence-pack';

test('buildDocumentEvidencePack creates a reviewable cross-surface fact pack', () => {
    const pack = buildDocumentEvidencePack({
        documentInsightId: 'doc-1',
        fileName: 'dimissione.pdf',
        documentDate: '2025-03-05T12:00:00.000Z',
        qualityLevel: 'green',
        summary: 'Dimissione post frattura con ADI e follow-up ortopedico.',
        rawMarkdown: [
            'Diagnosi di dimissione',
            'Frattura pertrocanterica del femore sinistro',
            'Terapia alla dimissione',
            'Pregabalin 75 mg 1 cp ore 8',
            'Sospendere warfarin 5 mg fino a rivalutazione INR',
            'Indicazioni alla dimissione',
            'Controllo ortopedico tra 7 giorni',
            'ADI infermieristica da proseguire',
            'Deficit della deambulazione con deambulatore',
        ].join('\n'),
        diagnoses: [
            {
                code: 'S72.1',
                description: 'Frattura pertrocanterica del femore sinistro',
                system: 'ICD-10',
                evidence: 'Frattura pertrocanterica del femore sinistro',
                confidence: 'high',
            },
        ],
        medications: [
            'Pregabalin 75 mg 1 cp ore 8',
            'Sospendere warfarin 5 mg fino a rivalutazione INR',
        ],
    });

    assert.equal(pack.schemaVersion, DOCUMENT_EVIDENCE_PACK_SCHEMA_VERSION);
    assert.equal(pack.source.documentInsightId, 'doc-1');

    const kinds = new Set(pack.facts.map((fact) => fact.kind));
    assert.deepEqual(
        Array.from(kinds).sort(),
        ['care_setting', 'followup', 'functional_status', 'medication', 'problem'],
    );

    const diagnosis = pack.facts.find((fact) => fact.kind === 'problem');
    assert.ok(diagnosis);
    assert.equal(diagnosis?.code, 'S72.1');
    assert.equal(diagnosis?.system, 'ICD-10');
    assert.equal(diagnosis?.temporality, 'current');
    assert.equal(diagnosis?.origin, 'documented');

    const suspendedMedication = pack.facts.find((fact) => fact.kind === 'medication' && fact.status === 'suspended');
    assert.ok(suspendedMedication);
    assert.match(suspendedMedication?.label || '', /warfarin/i);

    const lines = renderDocumentEvidencePackLines(pack);
    assert.match(lines.join('\n'), /Problemi documentati: ICD-10 S72\.1/i);
    assert.match(lines.join('\n'), /Terapie documentate: Pregabalin/i);
    assert.match(lines.join('\n'), /Follow-up documentato: Controllo ortopedico/i);
    assert.match(lines.join('\n'), /Setting assistenziale: ADI infermieristica/i);
    assert.match(lines.join('\n'), /Stato funzionale: Deficit della deambulazione/i);

    const compact = renderDocumentEvidencePackContext(pack, 260);
    assert.ok(compact.length <= 260);
    assert.match(compact, /Problemi documentati/i);
});

test('buildDocumentEvidencePack falls back to inferred summary facts when raw text lacks explicit lines', () => {
    const pack = buildDocumentEvidencePack({
        documentInsightId: 'doc-2',
        fileName: 'riabilitazione.pdf',
        documentDate: '2025-03-06T12:00:00.000Z',
        summary: 'Programma riabilitativo con follow-up fisiatrico e supporto domiciliare.',
        rawMarkdown: 'Documento rumoroso senza sezioni utili',
        diagnoses: [],
        medications: [],
    });

    const inferred = pack.facts.filter((fact) => fact.origin === 'inferred');
    assert.ok(inferred.length >= 1);
    assert.match(inferred.map((fact) => fact.kind).join(','), /(followup|care_setting|functional_status)/);
});

test('renderDocumentEvidencePackContext preserves follow-up before medications under tight budgets', () => {
    const pack = buildDocumentEvidencePack({
        documentInsightId: 'doc-3',
        fileName: 'dimissione-riabilitativa.pdf',
        documentDate: '2025-03-07T12:00:00.000Z',
        summary: 'Dimissione riabilitativa con FKT domiciliare e controllo ortopedico.',
        rawMarkdown: [
            'Indicazioni alla dimissione',
            'Controllo ortopedico tra 10 giorni con eventuale rivalutazione clinica.',
            'FKT domiciliare bisettimanale per recupero della mobilita.',
            'Miglioramento del cammino con supporto di un ausilio, ancora ridotta autonomia sulle scale.',
        ].join('\n'),
        diagnoses: [],
        medications: [
            'Levotiroxina 100 mcg 1 cp al mattino',
            'Colecalciferolo 25.000 UI settimanale',
            'Pantoprazolo 20 mg 1 cp la sera',
            'Pregabalin 75 mg 1 cps mattina e sera',
            'Duloxetina 30 mg 1 cps dopo cena',
        ],
    });

    const compact = renderDocumentEvidencePackContext(pack, 220);
    assert.ok(compact.length <= 220);
    assert.match(compact, /Follow-up documentato/i);
    assert.doesNotMatch(compact, /Terapie documentate/i);
});

test('buildDocumentEvidencePack extracts follow-up from OCR-like single-line text', () => {
    const pack = buildDocumentEvidencePack({
        documentInsightId: 'doc-4',
        fileName: 'ocr-lineare.pdf',
        documentDate: '2025-03-08T12:00:00.000Z',
        summary: 'Dimissione riabilitativa con indicazioni ortopediche.',
        rawMarkdown: [
            'Decorso clinico migliorato',
            'Diagnosi alla dimissione',
            'Esiti di frattura femorale sinistra',
            'Terapia domiciliare',
            'Pregabalin 75 mg 1 cp ore 8',
            'Indicazioni alla dimissione',
            'Controllo ortopedico tra 10 giorni.',
            'FKT domiciliare bisettimanale.',
            'Cammino con ausilio e ridotta autonomia sulle scale.',
        ].join('  '),
        diagnoses: [],
        medications: ['Pregabalin 75 mg 1 cp ore 8'],
    });

    const lines = renderDocumentEvidencePackLines(pack).join('\n');
    assert.match(lines, /Follow-up documentato: Controllo ortopedico tra 10 giorni/i);
    assert.match(lines, /Stato funzionale: Cammino con ausilio/i);
});

test('buildDocumentEvidencePack extracts follow-up from CDA-like XML narrative', () => {
    const pack = buildDocumentEvidencePack({
        documentInsightId: 'doc-5',
        fileName: 'cda-dimissione.xml',
        documentDate: '2025-03-09T12:00:00.000Z',
        summary: 'Dimissione con follow-up ortopedico e ADI.',
        rawMarkdown: `
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
        diagnoses: [],
        medications: [],
    });

    const lines = renderDocumentEvidencePackLines(pack).join('\n');
    assert.match(lines, /Follow-up documentato: Controllo ortopedico tra 14 giorni/i);
    assert.match(lines, /Setting assistenziale: ADI infermieristica da proseguire/i);
});

test('buildDocumentEvidencePack records suppressed candidates without rendering them as facts', () => {
    const pack = buildDocumentEvidencePack({
        documentInsightId: 'doc-6',
        fileName: 'lettera-con-rumore.pdf',
        documentDate: '2026-03-20T00:00:00.000Z',
        qualityLevel: 'green',
        summary: 'Valutazione respiratoria con problema corrente e rumore anamnestico.',
        rawMarkdown: [
            'Diagnosi attuale: BPCO riacutizzata.',
            'Anamnesi remota: pregressa frattura di polso destro guarita.',
            'Familiarita: madre con carcinoma mammario.',
            'Non evidenza di embolia polmonare.',
        ].join('\n'),
        diagnoses: [
            {
                code: 'J44.1',
                description: 'BPCO riacutizzata',
                system: 'ICD-10',
                evidence: 'Diagnosi attuale: BPCO riacutizzata.',
                confidence: 'high',
            },
            {
                code: 'C50',
                description: 'Carcinoma mammario materno',
                system: 'ICD-10',
                evidence: 'Familiarita: madre con carcinoma mammario.',
                confidence: 'medium',
            },
            {
                code: 'S62.1',
                description: 'Pregressa frattura di polso destro',
                system: 'ICD-10',
                evidence: 'Anamnesi remota: pregressa frattura di polso destro guarita.',
                confidence: 'medium',
            },
            {
                code: 'I26',
                description: 'Embolia polmonare',
                system: 'ICD-10',
                evidence: 'Non evidenza di embolia polmonare.',
                confidence: 'medium',
            },
        ],
        medications: [],
    });

    assert.ok(pack.sourceGovernance);
    assert.equal(pack.sourceGovernance.freshness, 'recent');
    assert.ok(pack.sourceGovernance.sourcePriority > 0);
    const suppressedReasons = new Set(pack.sourceGovernance.suppressedCandidates.map((candidate) => candidate.reason));
    assert.ok(suppressedReasons.has('family_history'));
    assert.ok(suppressedReasons.has('historical_only'));
    assert.ok(suppressedReasons.has('negated'));
    assert.match(
        pack.sourceGovernance.suppressedCandidates.map((candidate) => candidate.label).join('\n'),
        /carcinoma mammario/i,
    );

    const renderedFacts = pack.facts.map((fact) => fact.label).join('\n');
    assert.match(renderedFacts, /BPCO riacutizzata/i);
    assert.doesNotMatch(renderedFacts, /Carcinoma mammario/i);
    assert.doesNotMatch(renderedFacts, /frattura di polso/i);
    assert.doesNotMatch(renderedFacts, /Embolia polmonare/i);

    const context = renderDocumentEvidencePackContext(pack, 400);
    assert.match(context, /BPCO riacutizzata/i);
    assert.doesNotMatch(context, /Carcinoma mammario/i);
    assert.doesNotMatch(context, /Embolia polmonare/i);
});
