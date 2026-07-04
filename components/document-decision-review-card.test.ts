/* @Codex */
import test from 'node:test';
/* @Codex */
import assert from 'node:assert/strict';
/* @Codex */
import React from 'react';
/* @Codex */
import { renderToStaticMarkup } from 'react-dom/server';
/* @Codex */
import DocumentDecisionReviewCard from './document-decision-review-card';
/* @Codex */
import {
    applyDocumentDecisionGuardrails,
    buildDocumentDecision,
    createDocumentDecisionEvidenceRef,
} from '../lib/domain/documents/document-decision';

const baseSource = {
    documentId: 'synthetic-card-doc',
    sha256: 'synthetic-card-sha256',
    mimeType: 'application/pdf',
    pageCount: 1,
    textState: 'text_present' as const,
    ocrStatus: 'not_needed' as const,
};

test('DocumentDecisionReviewCard renders allowed proposal, forbidden write, and evidence labels', () => {
    const decision = applyDocumentDecisionGuardrails(buildDocumentDecision({
        source: baseSource,
        classification: {
            type: 'specialist_service_prescription',
            family: 'prescription',
            confidence: 'high',
            rationale: 'Impegnativa sintetica.',
            evidenceRefs: ['ev:1'],
        },
        evidenceRefs: [createDocumentDecisionEvidenceRef('ev:1', 'Visita ORL sintetica.')],
        proposedActions: [
            {
                id: 'action:service',
                kind: 'create_service_prescription_proposal',
                target: 'service:orl',
                evidenceRefs: ['ev:1'],
                confidence: 'high',
                rationale: 'Prestazione specialistica, non farmaco.',
            },
            {
                id: 'action:bad-drug',
                kind: 'create_medication_prescription_proposal',
                target: 'drug:orl',
                evidenceRefs: ['ev:1'],
                confidence: 'medium',
                rationale: 'Adversarial upcast.',
            },
        ],
    }));

    const html = renderToStaticMarkup(React.createElement(DocumentDecisionReviewCard, { decision }));
    assert.match(html, /Prescrizione prestazione specialistica/);
    assert.match(html, /Proposta prestazione specialistica/);
    assert.match(html, /Azione bloccata/);
    assert.match(html, /prestazione non farmaco/);
    assert.match(html, /Visita ORL sintetica/);
});

test('DocumentDecisionReviewCard renders OCR review requirement for mute document', () => {
    const decision = buildDocumentDecision({
        source: {
            ...baseSource,
            textState: 'text_absent',
            ocrStatus: 'needed',
        },
        classification: {
            type: 'mute_or_scanned',
            family: 'unknown',
            confidence: 'blocked',
            rationale: 'PDF muto sintetico.',
            evidenceRefs: ['ocr:needed'],
        },
        evidenceRefs: [createDocumentDecisionEvidenceRef('ocr:needed', 'PDF muto sintetico.')],
        proposedActions: [{
            id: 'action:queue-ocr',
            kind: 'queue_ocr',
            target: 'synthetic-card-doc',
            evidenceRefs: ['ocr:needed'],
            confidence: 'blocked',
            rationale: 'Serve OCR prima della review.',
        }],
    });

    const html = renderToStaticMarkup(React.createElement(DocumentDecisionReviewCard, { decision }));
    assert.match(html, /PDF muto o scansionato/);
    assert.match(html, /Review OCR/);
    assert.match(html, /Accoda OCR/);
});
