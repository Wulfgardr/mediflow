/* @Codex — scoped source/DTO assertions, not HTTP/SQLite or UI execution. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const f = require('../security/native-ordinary.test-support.cjs');
const { parseNativeOrdinaryPreparation } = require('./native-ordinary-wire.ts');
const valid = () => ({functionId: 'patient_insight', patientId: 'synthetic-patient', ambulatoryId: 'synthetic-ambulatory', patientRevision: 1, input: {selector:'current_patient_insight'}});
test('preparation is exact passive data: four functions and no session/capability/qualification input', () => {
    for (const functionId of ['patient_insight', 'smart_import', 'document_synthesis', 'treatment_reasoning'])
        assert.equal(parseNativeOrdinaryPreparation({...valid(), functionId, input: functionId === 'document_synthesis' ? {attachmentId:'synthetic-attachment'} : {selector:'current_'+functionId}}).functionId, functionId);
    for (const key of ['capability', 'session', 'qualification', 'approved', 'provider', 'apply'])
        assert.throws(() => parseNativeOrdinaryPreparation({...valid(), [key]: true}));
    for (const patientRevision of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1', null])
        assert.throws(() => parseNativeOrdinaryPreparation({...valid(), patientRevision}));
    assert.throws(() => parseNativeOrdinaryPreparation({...valid(), functionId: 'ocr'}));
});
test('proxy/getter/coercion authority-like objects are rejected without callbacks', () => {
    let called = 0;
    assert.throws(() => parseNativeOrdinaryPreparation(new Proxy(valid(), {getPrototypeOf() { called++; return Object.prototype; }})));
    const getter = valid(); Object.defineProperty(getter, 'patientId', {enumerable:true,get(){called++;return 'patient';}});
    assert.throws(() => parseNativeOrdinaryPreparation(getter));
    assert.throws(() => parseNativeOrdinaryPreparation({...valid(), functionId: {toString(){called++;return 'patient_insight';}}}));
    assert.equal(called, 0);
});
test('eight exact guarded native routes agree with the supplemental OpenAPI and local references', () => {
    const spec = JSON.parse(fs.readFileSync(path.join(f.root,'docs/openapi/native-ordinary-v1.json'),'utf8'));
    const operations = ['prepare','status','consent','login/start','login/complete','models','generate','cancel'];
    assert.equal(Object.keys(spec.paths).length, 8);
    for (const operation of operations) {
        const endpoint = '/api/v1/network/ai/chatgpt/ordinary/'+operation, method = operation === 'status' ? 'get' : 'post';
        assert.deepEqual(Object.keys(spec.paths[endpoint]),[method]);
        assert.equal(spec.paths[endpoint][method]['x-authority-ceiling'],'scoped_local_candidate');
        assert.equal(spec.paths[endpoint][method]['x-native-only'],'macos');
        const source = fs.readFileSync(path.join(f.root,'app'+endpoint+'/route.ts'),'utf8');
        assert.ok(source.includes("return handleNativeOrdinaryHttp(request, '"+operation+"')"));
        assert.match(source, new RegExp('export async function '+method.toUpperCase()+'\\('));
        assert.doesNotMatch(source,/dbServer|create.*Owner|WebSessionProjection|qualified|applyClinical/);
    }
    function walk(value) {
        if (!value || typeof value !== 'object') return;
        if (value.$ref) { assert.ok(value.$ref.startsWith('#/')); let current=spec;
            for(const key of value.$ref.slice(2).split('/')) current=current?.[key.replace(/~1/g,'/').replace(/~0/g,'~')];
            assert.ok(current,'unresolved '+value.$ref); }
        for(const child of Object.values(value)) walk(child);
    }
    walk(spec);
});
test('native composition uses the four original function owners, never route-local DB logic', () => {
    const source = fs.readFileSync(path.join(f.root,'lib/chatgpt-product/native-ordinary-composition.ts'),'utf8');
    for(const named of ['acquireAuthenticatedPatientInsightPreview','acquireAuthenticatedSmartImportAttachmentIngest',
        'acquireAuthenticatedSmartImportPreview','acquireTreatmentReasoningIngest','acquireTreatmentReasoningPreview',
        'acquireDocumentSynthesisProductionOperation','createAuthenticatedWebSessionSelectionService']) assert.ok(source.includes(named),named);
    assert.doesNotMatch(source,/dbServer|as WebSessionProjection|create.*Qualified.*Factory/);
    const view = fs.readFileSync(path.join(f.root,'native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/NativeOrdinaryViews.swift'),'utf8');
    for(const name of ['PatientInsight','SmartImport','DocumentSynthesis','TreatmentReasoning']) assert.ok(view.includes(name),name);
});
