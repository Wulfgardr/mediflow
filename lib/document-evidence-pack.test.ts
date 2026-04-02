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
