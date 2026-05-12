/* @Codex */
import test from 'node:test';
/* @Codex */
import assert from 'node:assert/strict';
/* @Codex */
import {
    applyDocumentDecisionGuardrails,
    buildDocumentDecision,
    createDocumentDecisionEvidenceRef,
    type DocumentDecisionAction,
} from './document-decision';
/* @Codex */
import {
    buildDocumentDecisionIdentityFromTaxCodes,
    resolveDocumentTaxCodeRoles,
} from './document-identity-resolution';

const baseSource = {
    documentId: 'synthetic-identity-doc',
    sha256: 'syntheticidentitysha256',
    mimeType: 'application/pdf',
    pageCount: 1,
    textState: 'text_present' as const,
    ocrStatus: 'not_needed' as const,
};

// Deliberately invalid CF-like tokens accepted by the structural resolver regex.
const SYNTHETIC_PATIENT_CF = 'TSTTST00A00A000A';
const SYNTHETIC_PRESCRIBER_CF = 'MEDPRS00A00A000A';
const SYNTHETIC_OPERATOR_CF = 'OPRTST00A00A000A';
const SYNTHETIC_FACILITY_CF = 'FCLTST00A00A000A';

function action(kind: DocumentDecisionAction['kind'], evidenceRefs = ['tax-code:1']): DocumentDecisionAction {
    return {
        id: `action:${kind}`,
        kind,
        target: 'synthetic-patient-target',
        evidenceRefs,
        confidence: 'high',
        rationale: 'Synthetic identity action for contract test.',
    };
}

test('tax code resolver marks explicit assisted person CF as patient_cf', () => {
    const result = resolveDocumentTaxCodeRoles({
        text: `Assistito codice fiscale ${SYNTHETIC_PATIENT_CF}. Prestazione richiesta: visita ORL.`,
    });

    assert.equal(result.taxCodes.length, 1);
    assert.equal(result.taxCodes[0].value, SYNTHETIC_PATIENT_CF);
    assert.equal(result.taxCodes[0].role, 'patient_cf');
    assert.equal(result.taxCodes[0].confidence, 'high');
    assert.equal(result.humanRequired, false);
    assert.match(result.evidenceRefs[0].snippet, /Assistito codice fiscale/i);
});

test('tax code resolver keeps prescriber CF out of patient identity', () => {
    const result = resolveDocumentTaxCodeRoles({
        text: `Medico prescrittore codice fiscale ${SYNTHETIC_PRESCRIBER_CF}. Visita cardiologica.`,
    });

    assert.equal(result.taxCodes.length, 1);
    assert.equal(result.taxCodes[0].role, 'prescriber_cf');
    assert.equal(result.humanRequired, true);
});

test('tax code resolver keeps plain physician CF out of patient identity', () => {
    const result = resolveDocumentTaxCodeRoles({
        text: `Dott. codice fiscale ${SYNTHETIC_PRESCRIBER_CF}. Visita cardiologica.`,
    });

    assert.equal(result.taxCodes.length, 1);
    assert.equal(result.taxCodes[0].role, 'physician_cf');
    assert.equal(result.humanRequired, true);
});

test('tax code resolver separates patient, prescriber, operator, and facility roles', () => {
    const result = resolveDocumentTaxCodeRoles({
        text: [
            `Paziente CF ${SYNTHETIC_PATIENT_CF}.`,
            `Medico prescrittore CF ${SYNTHETIC_PRESCRIBER_CF}.`,
            `Operatore CF ${SYNTHETIC_OPERATOR_CF}.`,
            `Struttura codice fiscale ${SYNTHETIC_FACILITY_CF}.`,
        ].join(' '),
    });

    assert.deepEqual(
        result.taxCodes.map((taxCode) => taxCode.role),
        ['patient_cf', 'prescriber_cf', 'operator_cf', 'facility_tax_code'],
    );
    assert.equal(result.humanRequired, false);
});

test('tax code resolver requires high-confidence patient label before clearing review', () => {
    const result = resolveDocumentTaxCodeRoles({
        text: `Il paziente sintetico ha portato un documento amministrativo. Codice fiscale ${SYNTHETIC_PATIENT_CF}.`,
    });
    const identity = buildDocumentDecisionIdentityFromTaxCodes(result, 'link_existing_patient');

    assert.equal(result.taxCodes[0].role, 'patient_cf');
    assert.equal(result.taxCodes[0].confidence, 'medium');
    assert.equal(result.humanRequired, true);
    assert.equal(identity.action, 'review_identity');
});

test('tax code resolver marks unlabeled CF as unknown_cf and keeps identity in review', () => {
    const result = resolveDocumentTaxCodeRoles({
        text: `Documento sintetico con codice ${SYNTHETIC_PATIENT_CF} senza ruolo esplicito.`,
    });
    const identity = buildDocumentDecisionIdentityFromTaxCodes(result, 'create_patient_candidate');

    assert.equal(result.taxCodes[0].role, 'unknown_cf');
    assert.equal(identity.action, 'review_identity');
    assert.equal(identity.humanRequired, true);
});

test('tax code resolver treats same CF with multiple roles as ambiguous', () => {
    const result = resolveDocumentTaxCodeRoles({
        text: `Paziente CF ${SYNTHETIC_PATIENT_CF}. Medico prescrittore CF ${SYNTHETIC_PATIENT_CF}.`,
    });
    const identity = buildDocumentDecisionIdentityFromTaxCodes(result, 'create_patient_candidate');

    assert.deepEqual(
        result.taxCodes.map((taxCode) => taxCode.role),
        ['patient_cf', 'prescriber_cf'],
    );
    assert.equal(result.humanRequired, true);
    assert.equal(identity.action, 'review_identity');
    assert.match(result.rationale, /Conflitto di ruolo/i);
});

test('identity builder coerces non-patient-only CF roles to review', () => {
    const result = resolveDocumentTaxCodeRoles({
        text: `Medico prescrittore codice fiscale ${SYNTHETIC_PRESCRIBER_CF}.`,
    });
    const identity = buildDocumentDecisionIdentityFromTaxCodes(result, 'create_patient_candidate');

    assert.equal(identity.action, 'review_identity');
    assert.equal(identity.humanRequired, true);
});

test('guardrails block create patient when only a physician CF is present', () => {
    const resolved = resolveDocumentTaxCodeRoles({
        text: `Medico prescrittore codice fiscale ${SYNTHETIC_PRESCRIBER_CF}. Terapia proposta da non importare automaticamente.`,
    });
    const identity = buildDocumentDecisionIdentityFromTaxCodes(resolved, 'create_patient_candidate');
    const decision = buildDocumentDecision({
        source: baseSource,
        classification: {
            type: 'identity_document',
            family: 'identity',
            confidence: 'medium',
            rationale: 'Documento con CF medico, non paziente.',
            evidenceRefs: ['tax-code:1'],
        },
        evidenceRefs: resolved.evidenceRefs,
        identity: {
            ...identity,
            action: 'create_patient_candidate',
        },
        proposedActions: [action('create_patient_candidate')],
    });

    const guarded = applyDocumentDecisionGuardrails(decision);
    assert.ok(guarded.negativeAssertions.includes('ambiguous_identity'));
    assert.equal(guarded.writePlan.forbiddenActions[0].blockedReason, 'ambiguous_identity');
});

test('guardrails block create patient when only an operator CF is present', () => {
    const resolved = resolveDocumentTaxCodeRoles({
        text: `Operatore codice fiscale ${SYNTHETIC_OPERATOR_CF}. Documento compilato in accettazione.`,
    });
    const identity = buildDocumentDecisionIdentityFromTaxCodes(resolved, 'create_patient_candidate');
    const decision = buildDocumentDecision({
        source: baseSource,
        classification: {
            type: 'administrative',
            family: 'administrative',
            confidence: 'medium',
            rationale: 'Documento con CF operatore, non paziente.',
            evidenceRefs: ['tax-code:1'],
        },
        evidenceRefs: resolved.evidenceRefs,
        identity: {
            ...identity,
            action: 'create_patient_candidate',
        },
        proposedActions: [action('create_patient_candidate')],
    });

    const guarded = applyDocumentDecisionGuardrails(decision);
    assert.ok(guarded.negativeAssertions.includes('ambiguous_identity'));
    assert.equal(guarded.writePlan.forbiddenActions[0].blockedReason, 'ambiguous_identity');
});

test('guardrails block patient link when only a facility tax code is present', () => {
    const resolved = resolveDocumentTaxCodeRoles({
        text: `Struttura codice fiscale ${SYNTHETIC_FACILITY_CF}. Documento amministrativo sintetico.`,
    });
    const identity = buildDocumentDecisionIdentityFromTaxCodes(resolved, 'link_existing_patient');
    const decision = buildDocumentDecision({
        source: baseSource,
        classification: {
            type: 'administrative',
            family: 'administrative',
            confidence: 'medium',
            rationale: 'Documento con CF struttura, non paziente.',
            evidenceRefs: ['tax-code:1'],
        },
        evidenceRefs: resolved.evidenceRefs,
        identity: {
            ...identity,
            action: 'link_existing_patient',
        },
        proposedActions: [action('link_patient')],
    });

    const guarded = applyDocumentDecisionGuardrails(decision);
    assert.ok(guarded.negativeAssertions.includes('ambiguous_identity'));
    assert.equal(guarded.writePlan.forbiddenActions[0].blockedReason, 'ambiguous_identity');
});

test('guardrails allow patient link proposal only with a single role-aware patient CF and resolved patientId', () => {
    const resolved = resolveDocumentTaxCodeRoles({
        text: `Paziente codice fiscale ${SYNTHETIC_PATIENT_CF}.`,
    });
    const identity = buildDocumentDecisionIdentityFromTaxCodes(resolved, 'link_existing_patient', 'synthetic-patient-1');
    const decision = buildDocumentDecision({
        source: baseSource,
        classification: {
            type: 'identity_document',
            family: 'identity',
            confidence: 'high',
            rationale: 'Documento anagrafico sintetico.',
            evidenceRefs: ['tax-code:1'],
        },
        evidenceRefs: [
            ...resolved.evidenceRefs,
            createDocumentDecisionEvidenceRef('identity:review', 'Link paziente da confermare in review.'),
        ],
        identity,
        proposedActions: [action('link_patient')],
    });

    assert.equal(identity.action, 'link_existing_patient');
    assert.equal(identity.patientId, 'synthetic-patient-1');

    const guarded = applyDocumentDecisionGuardrails(decision);
    assert.deepEqual(guarded.writePlan.forbiddenActions, []);
    assert.deepEqual(guarded.writePlan.allowedActions.map((item) => item.kind), ['link_patient']);
});

test('guardrails coerce link_existing_patient identity without patientId into review and block link_patient action', () => {
    const resolved = resolveDocumentTaxCodeRoles({
        text: `Paziente codice fiscale ${SYNTHETIC_PATIENT_CF}.`,
    });
    const identity = buildDocumentDecisionIdentityFromTaxCodes(resolved, 'link_existing_patient');
    assert.equal(identity.action, 'review_identity');
    assert.equal(identity.patientId, undefined);

    const decision = buildDocumentDecision({
        source: baseSource,
        classification: {
            type: 'identity_document',
            family: 'identity',
            confidence: 'high',
            rationale: 'Documento anagrafico sintetico.',
            evidenceRefs: ['tax-code:1'],
        },
        evidenceRefs: [
            ...resolved.evidenceRefs,
            createDocumentDecisionEvidenceRef('identity:review', 'Link paziente da confermare in review.'),
        ],
        identity,
        proposedActions: [action('link_patient')],
    });

    const guarded = applyDocumentDecisionGuardrails(decision);
    assert.equal(guarded.identity.action, 'review_identity');
    assert.ok(guarded.negativeAssertions.includes('ambiguous_identity'));
    assert.equal(guarded.writePlan.forbiddenActions[0].blockedReason, 'ambiguous_identity');
});
