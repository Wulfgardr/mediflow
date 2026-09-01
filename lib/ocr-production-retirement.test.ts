/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

function source(relativeUrl: string): string {
    return fs.readFileSync(new URL(relativeUrl, import.meta.url), 'utf8');
}

test('new diary entry attachment flow never starts inline OCR or generative document synthesis', () => {
    const page = source('../app/patients/[id]/entries/new/page.tsx');

    assert.doesNotMatch(page, /\/api\/ocr\/extract|extractPatientDataSmart|extractDocumentTextForSummary|synthesizeDocument|getAiModelLabels|AI OCR|OCR\/Sintesi/u);
    assert.match(page, /summarySnapshot:\s*summary/u);
});

test('production document surfaces leave automatic extraction to persisted-source AnyDoc', () => {
    const upload = source('../components/document-upload.tsx');
    const importer = source('../components/pdf-importer.tsx');
    const context = source('./ai-context.ts');

    for (const activeSource of [upload, importer, context]) {
        assert.doesNotMatch(activeSource, /extractPatientDataSmart|extractDocumentTextForSummary|extractTextFromPdf|\/api\/ocr\/extract/u);
    }
    assert.match(upload, /requestAnyDocLocalExtractionPreview\(file\.id\)/u);
    assert.match(upload, /db\.attachments\.add[\s\S]*requestAnyDocLocalExtractionPreview/u);
});

test('system diagnostics do not expose a runnable OCR health check', () => {
    const diagnostics = source('../components/diagnostic-hub.tsx');

    assert.doesNotMatch(diagnostics, /\/api\/ocr\/extract|DeepSeek OCR|id:\s*['"]ocr['"]/u);
});

test('AI settings and model labels have no writable or selectable OCR model', () => {
    const settingsController = source('./hooks/use-ai-settings-controller.ts');
    const modelsPage = source('../app/settings/ai/modelli/page.tsx');
    const modelSelector = source('../components/settings/ai-model-selector.tsx');
    const functionsPage = source('../app/settings/ai/funzioni/page.tsx');
    const modelLabels = source('./ai-summary-service.ts');

    for (const activeSource of [settingsController, modelsPage, modelSelector, modelLabels]) {
        assert.doesNotMatch(activeSource, /aiModel_ocr|model_ocr|DEFAULT_OCR_MODEL|deepseek-ocr|Segreteria \(OCR\)/u);
    }
    assert.doesNotMatch(modelSelector, /selectorId:[^;]*['"]ocr['"]/u);
    assert.doesNotMatch(functionsPage, /aiOcrKillSwitch|ocr-kill-switch-card|aria-label="OCR documentale locale"/u);
    assert.match(functionsPage, /OCR non disponibile/u);
});

test('the active AI service task catalog cannot route OCR', () => {
    const registry = source('./ai-providers/registry.ts');
    const service = source('./ai-service.ts');

    assert.doesNotMatch(registry, /['"]ocr['"]\s*[,\]]|\bocr:\s*['"]ollama['"]/u);
    assert.doesNotMatch(service, /AIService\.create\(['"]ocr['"]\)|aiModel_ocr|OCR_CHAT_TIMEOUT_MS|DEFAULT_OCR_MODEL/u);
});
