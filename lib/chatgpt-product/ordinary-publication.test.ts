/* @Codex — four canonical publication codecs, synthetic content only. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { parsePatientInsightPreviewWireRoot, serializePatientInsightPreviewWireRoot } from '../ai-providers/fabric/patient-insight-preview-contract';
import { snapshotSmartImportFabricResolutionReceipt, snapshotSmartImportFabricProvenance } from '../smart-import-fabric-wire';
import { parseDocumentSynthesisPreviewWire, serializeDocumentSynthesisPreviewWire } from '../ai-providers/fabric/document-synthesis-preview-wire';
import { parseTreatmentReasoningPublication } from '../ai-providers/fabric/treatment-reasoning-browser-controller';
import { outputs, profiles } from '../chatgpt-execution/ordinary-content.test-support.ts';
import { readOrdinaryTaskProfile, readOrdinaryDocumentEnvelope } from '../chatgpt-execution/ordinary-task-profile';
import { parseOrdinaryRemoteReceipt, parseOrdinaryRemoteProvenance, type OrdinaryFunction } from './ordinary-wire';
function metadata(id:OrdinaryFunction) {
    const receipt=parseOrdinaryRemoteReceipt({schemaVersion:'mediflow.ai.chatgpt-receipt.v1',capability:id,provider:'chatgpt_subscription',venue:'cloud',model:'synthetic-current-model',effort:'medium',egress:'redacted_explicit_consent',retention:'chatgpt_service_terms_apply',fallback:'none',sourceSha256:'sha256_'+'a'.repeat(64),payloadSha256:'b'.repeat(64),outputSha256:'c'.repeat(64)},id)!;
    const provenance=parseOrdinaryRemoteProvenance({schemaVersion:'mediflow.ai.chatgpt-provenance.v1',capability:id,provider:receipt.provider,venue:'cloud',model:receipt.model,preprocessing:['context_minimization','layer1_redaction','layer2_redaction','envelope_validation'],receipt},receipt)!;
    assert.ok(receipt);assert.ok(provenance);return {receipt,provenance};
}
test('PI original proposal structure and source revision pass the remote wire codec',()=>{
    const {receipt,provenance}=metadata('patient_insight'), at='2026-09-12T10:00:00.000Z';
    const input={preview:{writesPerformed:0,apply:'denied',status:'available',code:null,proposal:{schemaVersion:'mediflow.patient-insight.review-proposal.v2',reviewOnly:true,summary:'Synthetic [S1]',currentState:['Synthetic [S1]'],alerts:[],nextSteps:[],gaps:[],generatedAt:at,currentness:{selectionEpoch:1,patientRevision:1,projectionDigest:'sha256_'+'d'.repeat(64),capturedAt:at,verifiedAt:at}},receipt,provenance,reviewRef:'review_'+'e'.repeat(32)}};
    const wire=serializePatientInsightPreviewWireRoot(input);assert.ok(wire);assert.deepEqual(parsePatientInsightPreviewWireRoot(JSON.parse(JSON.stringify(wire))),wire);
    assert.equal(parsePatientInsightPreviewWireRoot({preview:{...wire.preview,writesPerformed:1}}),null);
});
test('SI remote metadata retains the canonical, source-bound proposal without a local receipt',()=>{
    const result=readOrdinaryTaskProfile(profiles()[1]).parseOutput(JSON.stringify(outputs()[1]));
    assert.ok(result);const {receipt,provenance}=metadata('smart_import');
    assert.deepEqual(snapshotSmartImportFabricResolutionReceipt(receipt),receipt);
    assert.deepEqual(snapshotSmartImportFabricProvenance(provenance,receipt),provenance);
    assert.equal(snapshotSmartImportFabricProvenance({...provenance,venue:'local_process'},receipt),null);
});
test('DS authentic parsed envelope remains privately addressable and exact-byte citation survives serialization',()=>{
    const read=readOrdinaryTaskProfile(profiles()[2]), parsed=read.parseOutput(JSON.stringify(outputs()[2]));
    const envelope=readOrdinaryDocumentEnvelope(parsed);assert.ok(envelope);assert.equal(readOrdinaryDocumentEnvelope({...parsed}),null);
    const {receipt,provenance}=metadata('document_synthesis');
    const result=parsed as {output:unknown;citations:readonly {quote:string;quoteSha256:string;startByte:number;endByte:number}[];claims:unknown};
    for(const citation of result.citations){assert.equal(createHash('sha256').update(citation.quote,'utf8').digest('hex'),citation.quoteSha256);assert.equal(citation.endByte-citation.startByte,Buffer.byteLength(citation.quote,'utf8'));}
    const publication={schemaVersion:'mediflow.document-synthesis.publication.v1',output:result.output,citations:result.citations,claims:result.claims,
        receipt:{schemaVersion:'mediflow.document-synthesis.publication-receipt.v1',capability:'document_synthesis',outputSha256:'c'.repeat(64),claimCitationsDigestSha256:Array(32).fill(1),sourceSetDigestSha256:Array(32).fill(2),providerBindingReceipt:receipt,reviewOnly:true,applyPolicy:'none',writesPerformed:0},
        provenance:{schemaVersion:'mediflow.document-synthesis.publication-provenance.v1',capability:'document_synthesis',sourceSetAuthority:'application_host',inputDigestScope:'ordered_normalized_provider_projection_set',citationSupport:'provider_declared_host_membership_and_locator_validated',modelCausality:'not_established',fabricProvenance:provenance}};
    const wire=serializeDocumentSynthesisPreviewWire(publication);assert.ok(wire);assert.deepEqual(parseDocumentSynthesisPreviewWire(JSON.parse(JSON.stringify(wire))),wire);
    assert.equal(JSON.stringify(wire.publication.citations),JSON.stringify(result.citations));
});
test('TR remote trace and receipt are disjoint from Athena; source bindings unchanged',()=>{
    const parsed=readOrdinaryTaskProfile(profiles()[3]).parseOutput(JSON.stringify(outputs()[3])) as {value:unknown;sourceBindings:unknown};
    const {receipt,provenance}=metadata('treatment_reasoning');
    const publication={schemaVersion:'mediflow.ai.treatment-reasoning-publication.chatgpt.v1',capability:'treatment_reasoning',stage:'preview',review:'required',status:'available',value:parsed.value,sourceBindings:parsed.sourceBindings,attestation:receipt,fabricReceipt:receipt,provenance,sourceRevision:'source-revision-synthetic',capturedAt:'2026-09-12T10:00:00.000Z',writesPerformed:0,applyPolicy:'none'};
    const wire=parseTreatmentReasoningPublication(publication);assert.ok(wire);assert.deepEqual(wire.sourceBindings,parsed.sourceBindings);assert.equal(wire.value.data.trace.mode,'chatgpt_subscription');
    const poisoned=structuredClone(publication) as unknown as {value:{data:{trace:{mode:string}}}};poisoned.value.data.trace.mode='local_model';assert.equal(parseTreatmentReasoningPublication(poisoned),null);
    assert.equal(parseTreatmentReasoningPublication({...publication,attestation:{...receipt,provider:'athena_mlx'}}),null);
});
