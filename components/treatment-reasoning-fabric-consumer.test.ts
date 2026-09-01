/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./treatment-reasoning-panel.tsx', import.meta.url), 'utf8');

test('roots the manual Treatment Reasoning consumer only in the browser controller', () => {
    assert.match(source, /createTreatmentReasoningBrowserController/u);
    assert.doesNotMatch(source, /generatePatientTreatmentReasoningDraft|DEFAULT_TREATMENT_REASONING_QUESTION|TreatmentReasoningDraft|treatment-reasoning-service/u);

    const proposalRead = source.indexOf('await controller.readProposal()');
    const previewRun = source.indexOf('await controller.run(');
    assert.ok(proposalRead >= 0, 'the click handler must explicitly read the context proposal');
    assert.ok(previewRun > proposalRead, 'the confirmed run must follow the proposal read');
    assert.match(
        source,
        /await controller\.run\(\{\s*patientId: patient\.id,\s*proposal,\s*contextInput: \{\s*patient,\s*entries,\s*therapies,\s*observations,\s*attachments,?\s*\},\s*\}, true\)/u,
    );
});

test('keeps the preview ephemeral, supersession-safe, and review-only', () => {
    assert.match(source, /controller\.reset\(\)/u);
    assert.match(source, /\[controller, patient\.id, patient\.version\]/u);
    assert.match(source, /operation\.current/u);
    assert.match(source, /publication\.value/u);
    assert.match(source, /publication\.sourceBindings/u);
    assert.match(source, /publication\.fabricReceipt/u);
    assert.match(source, /publication\.provenance/u);
    assert.match(source, /publication\.sourceRevision/u);
    assert.match(source, /publication\.capturedAt/u);
    assert.match(source, /publication\.attestation\.provider/u);
    assert.match(source, /ATHENA MLX/u);
    assert.match(source, /review-only/u);
    assert.doesNotMatch(source, /\.message\b|\bfetch\(|setInterval|setTimeout|localStorage|sessionStorage|\bapply\b|\bsave\b|\brefresh\w*\b/u);
});
