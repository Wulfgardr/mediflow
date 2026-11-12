import assert from 'node:assert/strict';
import test from 'node:test';
import * as contract from '../lib/ai-providers/fabric/patient-insight-preview-contract';
import { element, find, mountContract, text } from './settings/settings-presentation.test-support.ts';

for (const remote of [false, true]) test(`verification copy follows the ${remote ? 'OpenAI' : 'local'} receipt and provenance`, () => {
    const model = remote ? 'synthetic-remote-model' : 'synthetic-local-model';
    const receipt = remote ? {
        schemaVersion: 'mediflow.ai.chatgpt-receipt.v1', capability: 'patient_insight',
        provider: 'chatgpt_subscription', venue: 'cloud', model, effort: 'high',
        egress: 'redacted_explicit_consent', retention: 'chatgpt_service_terms_apply', fallback: 'none',
        sourceSha256: `sha256_${'a'.repeat(64)}`, payloadSha256: 'b'.repeat(64), outputSha256: 'c'.repeat(64),
    } : { schemaVersion: 'mediflow.ai.fabric-resolution.v1', capability: 'patient_insight',
        provider: 'ollama', venue: 'local_process', model, egress: 'none' };
    const preview = {
        writesPerformed: 0, apply: 'denied', status: 'available', code: null,
        proposal: { schemaVersion: 'mediflow.patient-insight.review-proposal.v2', reviewOnly: true,
            summary: 'Proposta sintetica. [S1]', currentState: ['Stato sintetico. [S1]'], alerts: [], nextSteps: [], gaps: [],
            generatedAt: '2026-11-12T00:00:00.000Z', currentness: { selectionEpoch: 7, patientRevision: 1,
                projectionDigest: `sha256_${'a'.repeat(64)}`, capturedAt: '2026-11-12T00:00:00.000Z', verifiedAt: '2026-11-12T00:00:00.000Z' } },
        receipt, provenance: remote ? { schemaVersion: 'mediflow.ai.chatgpt-provenance.v1', capability: 'patient_insight',
            provider: 'chatgpt_subscription', venue: 'cloud', model,
            preprocessing: ['context_minimization', 'layer1_redaction', 'layer2_redaction', 'envelope_validation'], receipt }
            : { schemaVersion: 'mediflow.ai.fabric-provenance.v1', capability: 'patient_insight', provider: 'ollama', venue: 'local_process', model,
                preprocessing: ['context_minimization', 'envelope_validation'] },
        reviewRef: `review_${'d'.repeat(32)}`,
    };
    const parsed = contract.parsePatientInsightPreviewWireRoot({ preview });
    assert.equal(parsed?.preview.status, 'available', 'the real wire parser accepts the synthetic production-shaped receipt');
    const tree = mountContract(process.env.MEDIFLOW_COPY_COMPONENT ?? 'components/ai-patient-insight.tsx', 'default', {
        props: { patient: { id: 'synthetic-patient', version: 1 } },
        states: { 0: { patientId: 'synthetic-patient', patientKey: 'synthetic-patient:1', sourceSignature: 'synthetic', value: parsed!.preview } },
        imports: {
            '@/components/function-models/function-model-picker': {
                FunctionModelPicker: () => null,
                useFunctionModelPicker: () => ({ active: true, canGenerate: true, view: { remote: remote ? {} : null }, client: {} }),
            },
            'react-markdown': { default: (props: Record<string, unknown>) => element('div', props) },
            '@/components/privacy-blur': { default: (props: Record<string, unknown>) => element('span', props) },
            '@/components/ui/ink-state': { InkState: (props: Record<string, unknown>) => element('span', props) },
            '@/lib/ai-patient-insight-kill-switch': { isAiPatientInsightEnabledValue: () => true },
            '@/lib/ai-providers/fabric/patient-insight-preview-contract': contract,
            '@/lib/db': { db: {} }, '@/lib/live-query': { useLiveQuery: () => null },
            '@/lib/patient-insight-source-signature': {},
        },
    }).render();
    const proposal = find(tree, node => node.props['data-testid'] === 'patient-insight-review-proposal');
    const visible = text(proposal).replace(/\s+/g, ' ');
    assert.match(visible, remote ? /servizio esterno · contenuti oscurati inviati con consenso/i : /processo locale · nessuna uscita dati/i);
    assert.match(visible, /riduzione del contesto.*verifica del formato/i);
    if (remote) {
        assert.doesNotMatch(visible, /processo locale|nessuna uscita dati/i);
        assert.match(visible, /primo passaggio di oscuramento.*secondo passaggio di oscuramento/i);
    }
});
