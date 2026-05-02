/* @Codex */
import test from 'node:test';
/* @Codex */
import assert from 'node:assert/strict';
/* @Codex */
import {
    applyPatientImportDecision,
    buildPatientImportDecision,
    decidePatientImportTarget,
    PATIENT_IMPORT_DECISION_SCHEMA_VERSION,
} from './patient-import-decision';
/* @Codex */
import { buildPatientDocumentReviewDraft } from './patient-document-review';
/* @Codex */
import type { ExtractedPatientData } from './pdf-service';

test('patient import target prefers merge when tax code matches one existing patient', () => {
    const decision = decidePatientImportTarget({
        taxCode: 'RSSMRA80A01F205X',
        firstName: 'Mario',
        lastName: 'Rossi',
        birthDate: new Date('1980-01-01'),
        candidates: [
            {
                id: 'patient-1',
                taxCode: 'RSSMRA80A01F205X',
                firstName: 'Mario',
                lastName: 'Rossi',
                birthDate: '1980-01-01',
            },
        ],
    });

    assert.equal(decision.action, 'merge_existing_patient');
    assert.equal(decision.patientId, 'patient-1');
    assert.equal(decision.matchBasis, 'tax_code');
});

test('patient import target degrades to identity review for demographic-only matches', () => {
    const decision = decidePatientImportTarget({
        firstName: 'Anna',
        lastName: 'Bianchi',
        birthDate: '1955-06-20',
        candidates: [
            {
                id: 'patient-2',
                firstName: 'Anna',
                lastName: 'Bianchi',
                birthDate: '1955-06-20',
            },
        ],
    });

    assert.equal(decision.action, 'review_identity');
    assert.deepEqual(decision.candidatePatientIds, ['patient-2']);
    assert.equal(decision.matchBasis, 'demographics');
});

test('patient import decision splits structured writes from note-only carryover', () => {
    const data: ExtractedPatientData = {
        rawText: [
            'Controlli successivi',
            'TAC addome con mdc tra circa 2-3 settimane',
            'Terapia alla dimissione',
            '- Humalog 4 U ai pasti principali',
            '- Nutridrink 1 al di',
        ].join('\n'),
        source: 'hybrid',
        confidence: 0.93,
        firstName: 'Giuseppe',
        lastName: 'Lubrano',
        reviewDiagnoses: [
            {
                label: 'Type 2 diabetes mellitus',
                code: '5A11',
                description: 'Type 2 diabetes mellitus',
                system: 'ICD-11',
                confidence: 'high',
                evidence: 'Diabete mellito tipo 2',
                sourceType: 'reviewable_local_match',
            },
        ],
        reviewTherapies: [
            {
                drugName: 'HUMALOG',
                dosage: '4 U ai pasti principali',
                activePrinciple: 'INSULINA LISPRO',
                aic: '033637416',
                atc: 'A10AB04',
                confidence: 'high',
                therapyState: 'active',
                matchType: 'catalog',
                evidence: 'Humalog 4 U ai pasti principali',
                sourceType: 'reviewable_local_match',
            },
            {
                drugName: 'Nutridrink',
                dosage: '1 al di',
                confidence: 'medium',
                therapyState: 'uncertain',
                matchType: 'manual',
                blockedReason: 'Prodotto nutrizionale senza match AIFA forte.',
                evidence: 'Nutridrink 1 al di',
                sourceType: 'reviewable_local_match',
            },
        ],
    };

    const draft = buildPatientDocumentReviewDraft(data);
    const notesField = draft.fields.find((field) => field.key === 'notes');
    assert.ok(notesField);
    notesField!.included = true;
    const humalog = draft.medications.find((therapy) => therapy.drugName === 'HUMALOG');
    assert.ok(humalog);
    humalog!.included = true;
    const nutridrink = draft.medications.find((therapy) => therapy.drugName === 'Nutridrink');
    assert.ok(nutridrink);
    nutridrink!.included = true;

    const decision = buildPatientImportDecision(draft, {
        target: {
            action: 'create_new_patient',
            rationale: 'Nuova anagrafica da review documentale.',
        },
        generatedAt: new Date('2026-04-14T10:00:00.000Z'),
    });

    assert.equal(decision.schemaVersion, PATIENT_IMPORT_DECISION_SCHEMA_VERSION);
    assert.equal(decision.summary.structuredDiagnosisCount, 1);
    assert.equal(decision.summary.structuredTherapyCount, 1);
    assert.equal(decision.summary.noteOnlyTherapyCount, 1);
    assert.equal(
        decision.therapyDecisions.find((therapy) => therapy.drugName === 'HUMALOG')?.action,
        'persist_structured',
    );
    assert.equal(
        decision.therapyDecisions.find((therapy) => therapy.drugName === 'Nutridrink')?.action,
        'append_note',
    );

    const defaults = applyPatientImportDecision(decision);
    assert.equal(defaults.firstName, 'Giuseppe');
    assert.equal(defaults.diagnoses?.length, 1);
    assert.equal(defaults.therapies?.length, 1);
    assert.match(defaults.notes || '', /TAC addome/i);
    assert.match(defaults.notes || '', /Terapie documentali da riconciliare manualmente/i);
    assert.match(defaults.notes || '', /Nutridrink/i);
});
