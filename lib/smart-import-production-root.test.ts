/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const pagePath = path.join(root, 'app/patients/[id]/modules/page.tsx');

test('patient modules mounts only the Fabric Smart Import preview root', () => {
    const source = fs.readFileSync(pagePath, 'utf8');

    assert.match(source, /PatientSmartImportFabricPreviewCard/u);
    assert.match(source, /patient-smart-import-projection-capture/u);
    assert.match(source, /<PatientSmartImportFabricPreviewCard/u);
    assert.doesNotMatch(source, /PatientSmartImportPanel|patient-smart-import-panel/u);
    assert.doesNotMatch(source, /patient-smart-import-service/u);
    assert.doesNotMatch(source, /onReviewSnapshotChange|setSmartImportReview/u);
});

test('the production page cannot reach the retired apply route', () => {
    const page = fs.readFileSync(pagePath, 'utf8');
    const card = fs.readFileSync(path.join(root, 'components/patient-smart-import-fabric-preview-card.tsx'), 'utf8');

    assert.doesNotMatch(page, /api\/patients\/.*smart-import/u);
    assert.match(card, /createSmartImportReviewBrowserController/u);
    assert.doesNotMatch(card, /patient-smart-import-service|applyPatientSmartImportSelection|generatePatientSmartImportAnalysis/u);
});

test('the production queue describes preview and proposals, not legacy analysis or apply', () => {
    const source = fs.readFileSync(path.join(root, 'lib/domain/documents/patient-review-queue-summary.ts'), 'utf8');
    const smartImport = source.slice(source.indexOf('function buildSmartImportRow'), source.indexOf('function buildArchiveRow'));

    assert.match(smartImport, /anteprima/u);
    assert.match(smartImport, /propost/u);
    assert.doesNotMatch(smartImport, /analisi e applicazione|l'analisi parte/u);
});
