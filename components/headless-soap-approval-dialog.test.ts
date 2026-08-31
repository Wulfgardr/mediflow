/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    CLINICIAN_SOAP_DRAFT_SCHEMA,
    CLINICIAN_SOAP_OPERATION_ID,
    validateClinicianSoapWriteDraft,
} from '../lib/headless/clinician-soap-write-contract';
import { createClinicianSoapEntryFieldSet } from '../lib/headless/clinician-soap-entry-field-set';
import { HeadlessSoapApprovalDialog } from './headless-soap-approval-dialog';

test('HeadlessSoapApprovalDialog rende la review SOAP dedicata e il solo gesto esplicito verso il PIN', () => {
    const accepted = validateClinicianSoapWriteDraft(Object.assign(Object.create(null), {
        schema: CLINICIAN_SOAP_DRAFT_SCHEMA,
        operationId: CLINICIAN_SOAP_OPERATION_ID,
        subjective: 'Sintomo sintetico riferito.',
        objective: 'Esame obiettivo sintetico stabile.',
        assessment: 'Valutazione sintetica prudente.',
        plan: 'Piano sintetico condiviso.',
    }));
    assert.equal(accepted.status, 'accepted');

    const fieldSet = createClinicianSoapEntryFieldSet(accepted, 1_704_067_200_123);
    assert.ok(fieldSet);

    const html = renderToStaticMarkup(React.createElement(HeadlessSoapApprovalDialog, {
        open: true,
        fieldSet,
        status: 'ready',
        onExplicitGesture: () => undefined,
        onClose: () => undefined,
    }));
    const source = readFileSync(new URL('./headless-soap-approval-dialog.tsx', import.meta.url), 'utf8');

    assert.match(html, /role="dialog"/u);
    assert.match(html, /aria-(?:label|labelledby)="[^"]+"/u);
    assert.match(html, /visit/u);
    assert.match(html, /Voce clinica/u);
    assert.match(html, /2024-01-01T00:00:00\.000Z/u);
    assert.match(html, /ambulatory/u);
    assert.match(html, /S:[\s\S]*Sintomo sintetico riferito\./u);
    assert.match(html, /O:[\s\S]*Esame obiettivo sintetico stabile\./u);
    assert.match(html, /A:[\s\S]*Valutazione sintetica prudente\./u);
    assert.match(html, /P:[\s\S]*Piano sintetico condiviso\./u);
    assert.match(html, new RegExp(fieldSet.metadata.codec, 'u'));
    assert.match(html, new RegExp(fieldSet.metadata.sha256.hex, 'u'));
    assert.match(html, /Nessun allegato/u);
    assert.match(html, /<button[^>]*>\s*Continua con PIN\s*<\/button>/u);
    assert.doesNotMatch(html, /\b(?:chat|mini|planner)\b/iu);
    assert.doesNotMatch(source, /dangerouslySetInnerHTML/u);
    assert.doesNotMatch(source, /(?:from\s+|import\s*\()['"][^'"]*(?:chat|mini|planner)[^'"]*['"]/iu);
});
