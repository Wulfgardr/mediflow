/* @Codex */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const CARD = 'components/document-synthesis-fabric-review-card.tsx';
const UPLOAD = 'components/document-upload.tsx';
const IMPORTER = 'components/pdf-importer.tsx';

test('production document UI exposes a manual Fabric review with receipt, provenance, and citations', async () => {
    const card = await readFile(CARD, 'utf8');
    assert.match(card, /createDocumentSynthesisReviewBrowserController/u);
    assert.match(card, /Sintesi Fabric · sola proposta/u);
    assert.match(card, /0 scritture/u);
    assert.match(card, /Provenienza/u);
    assert.match(card, /Citazioni/u);
    assert.match(card, /modelCausality/u);
    assert.match(card, /providerBindingReceipt/u);
    assert.doesNotMatch(card, /prompt|apply\(|synthesizeDocument|document-synthesis-service|refreshPatientSummary/u);
});

test('document upload persists the attachment first and never invokes OCR, legacy synthesis, or Patient Insight refresh', async () => {
    const source = await readFile(UPLOAD, 'utf8');
    assert.match(source, /DocumentSynthesisFabricReviewCard/u);
    assert.match(source, /db\.attachments\.add/u);
    assert.match(source, /requestAnyDocLocalExtractionPreview/u);
    assert.doesNotMatch(source, /document-synthesis-service|synthesizeDocument|refreshPatientSummaryIfEnabled|extractPatientDataSmart|extractDocumentTextForSummary|aiModels\.ocr|OCR in corso/u);
    assert.match(source, /unsupported_local_extraction/u);
    assert.match(source, /review_required/u);
});

test('pre-persistence importer is honest about native text and manual review and has no auto archive or legacy AI path', async () => {
    const source = await readFile(IMPORTER, 'utf8');
    assert.doesNotMatch(source, /document-synthesis-service|analyzeDocumentContent|synthesizeDocument|refreshPatientSummaryIfEnabled|AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY|useAiModelLabels|OCR locale|Salvato nell.*archivio/u);
    assert.match(source, /testo nativo/u);
    assert.match(source, /review_required/u);
    assert.match(source, /unsupported_local_extraction/u);
});

test('the three production routes bind only the authenticated host operation', async () => {
    for (const phase of ['capture', 'ingest', 'preview']) {
        const source = await readFile(`app/api/ai/document-synthesis/${phase}/route.ts`, 'utf8');
        assert.match(source, /acquireDocumentSynthesisProductionOperation/u);
        assert.doesNotMatch(source, /request\.json|dbServer|provider\s*:|prompt|patientId|apply\s*\(/u);
    }
});

/* @Codex */
test('DS confirmation binds patient identity and invalidates the controller on lock or identity changes', async () => {
    const card = await readFile(CARD, 'utf8'); const upload = await readFile(UPLOAD, 'utf8');
    assert.match(upload, /DocumentSynthesisFabricReviewCard\s+patientId=\{patientId\}/u);
    assert.match(card, /controller\.run\(\{ patientId, attachmentId, proposal, ambulatory \}, true\)/u);
    assert.match(card, /!confirmed \|\| !proposal/u);
    assert.match(card, /Conferma e genera proposta/u);
    assert.match(card, /senza scritture cliniche/u);
    assert.match(card, /if \(isLocked\) return null/u);
    assert.match(card, /key=\{JSON\.stringify\(\[props.patientId, props.attachmentId, props.attachmentName, props.enabled\]\)\}/u);
    assert.match(card, /useEffect\(\(\) => \(\) => \{[\s\S]*?controller.reset\(\)/u);
});

/* @Codex */
test('DS ordinary confirmation shows human names, requires an explicit choice and uses shared action geometry', async () => {
    const card = await readFile(CARD, 'utf8'); const upload = await readFile(UPLOAD, 'utf8');
    assert.match(upload, /attachmentName=\{file.name\}/u);
    assert.match(card, /Paziente: \{proposal.patientName\}/u);
    assert.match(card, /Documento: \{attachmentName\}/u);
    assert.match(card, /\{choice.name\}/u);
    assert.doesNotMatch(card, /Paziente: \{patientId\}|Ambulatorio: \{proposal.ambulatoryId\}/u);
    assert.match(card, /<option value="">Scegli l’ambulatorio/u);
    assert.match(card, /disabled=\{!enabled \|\| !confirmed \|\| !ambulatory \|\| !picker\.canGenerate\}/u);
    assert.match(card, /setAmbulatory[\s\S]*?setConfirmed\(false\)/u);
    const buttons = card.match(/<button\b[^>]*>/gu) ?? [];
    assert.equal(buttons.length, 5);
    for (const button of buttons) assert.match(button, /data-lume-action=/u);
    assert.doesNotMatch(card, /px-2.5 py-1.5/u);
});
