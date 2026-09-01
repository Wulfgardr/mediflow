/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { GENERATIVE_CAPABILITY_IDS } from './contract.ts';
import { GENERATIVE_CAPABILITY_DESCRIPTORS } from './generative-catalog.ts';

test('registra il catalogo generativo congelato', () => {
    assert.deepEqual(Object.keys(GENERATIVE_CAPABILITY_DESCRIPTORS), GENERATIVE_CAPABILITY_IDS);
    const compact = Object.fromEntries(Object.entries(GENERATIVE_CAPABILITY_DESCRIPTORS).map(
        ([id, value]) => [id, [
            value.operation,
            value.availabilityDisposition,
            value.killSwitch,
            value.entryPoint,
        ]],
    ));
    assert.deepEqual(compact, {
        patient_insight: ['synthesis', 'proposal_only', 'aiPatientInsightKillSwitch', 'app/api/ai/patient-insight/preview/route.ts'],
        smart_import: ['extraction', 'proposal_only', 'aiSmartImportKillSwitch', 'app/api/ai/smart-import/preview/route.ts'],
        document_synthesis: ['synthesis', 'proposal_only', 'aiDocumentSynthesisKillSwitch', 'app/api/ai/document-synthesis/preview/route.ts'],
        ocr: ['ocr', 'unavailable', null, null],
        treatment_reasoning: ['reasoning', 'proposal_only', 'aiTreatmentReasoningKillSwitch', 'app/api/ai/treatment-reasoning/preview/route.ts'],
    });
    for (const [id, descriptor] of Object.entries(GENERATIVE_CAPABILITY_DESCRIPTORS)) {
        assert.equal(descriptor.id, id);
        assert.equal(descriptor.class, 'generative');
        assert.equal(descriptor.authorityPlane, 'clinical_application');
        assert.equal(descriptor.dataClass, 'clinical');
        assert.deepEqual(descriptor.venues, id === 'ocr' ? [] : ['local_process', 'home_base']);
        assert.equal(descriptor.egressProfileId, 'local_only');
        assert.equal(descriptor.review, 'review_first');
        assert.equal(Object.isFrozen(descriptor), true);
    }

    const ocr = GENERATIVE_CAPABILITY_DESCRIPTORS.ocr;
    assert.deepEqual(ocr.venues, []);
    assert.equal('provider' in ocr, false);
    assert.equal('fallback' in ocr, false);
});

test('ogni schema non nullo compare letteralmente nella sua fonte', () => {
    const schemaSources = {
        patient_insight: '../../ai-task-contract-prompts.ts',
        smart_import: '../../ai-task-contract-prompts.ts',
        document_synthesis: '../../ai-task-contract-prompts.ts',
        treatment_reasoning: '../../treatment-reasoning-service.ts',
    } as const;

    for (const descriptor of Object.values(GENERATIVE_CAPABILITY_DESCRIPTORS)) {
        if (descriptor.contractSchema === null) continue;
        const source = schemaSources[descriptor.id as keyof typeof schemaSources];
        assert.ok(source, `fonte schema mancante per ${descriptor.id}`);
        assert.match(readFileSync(new URL(source, import.meta.url), 'utf8'), new RegExp(
            descriptor.contractSchema.replaceAll('.', '\\.'),
        ));
    }
    assert.equal(GENERATIVE_CAPABILITY_DESCRIPTORS.ocr.contractSchema, null);
});
