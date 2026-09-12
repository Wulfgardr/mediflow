/* @Codex — DTO evidence is descriptive, never execution authority. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOrdinaryRemoteReceipt, parseOrdinaryRemoteProvenance, type OrdinaryFunction } from './ordinary-wire';
import { parseOrdinaryStoredSettings } from './ordinary-settings';
const ids: OrdinaryFunction[] = ['patient_insight','smart_import','document_synthesis','treatment_reasoning'];
function receipt(capability: OrdinaryFunction) { return {schemaVersion:'mediflow.ai.chatgpt-receipt.v1', capability, provider:'chatgpt_subscription',venue:'cloud',model:'synthetic-catalog-model',effort:'medium',egress:'redacted_explicit_consent',retention:'chatgpt_service_terms_apply',fallback:'none',sourceSha256:'sha256_'+'a'.repeat(64),payloadSha256:'b'.repeat(64),outputSha256:'c'.repeat(64)}; }
for (const id of ids) {
    test(`${id}: distinct remote receipt and preprocessing survive strict parsing`, () => {
        const r=parseOrdinaryRemoteReceipt(receipt(id),id); assert.ok(r);
        const p=parseOrdinaryRemoteProvenance({schemaVersion:'mediflow.ai.chatgpt-provenance.v1',capability:id,provider:r.provider,venue:r.venue,model:r.model,preprocessing:['context_minimization','layer1_redaction','layer2_redaction','envelope_validation'],receipt:r},r);
        assert.ok(p); assert.equal(p.venue,'cloud'); assert.equal(p.receipt.egress,'redacted_explicit_consent');
        assert.equal(parseOrdinaryRemoteReceipt(receipt(id),ids.find(x=>x!==id)!),null);
    });
    for (const [field,value] of Object.entries({provider:'ollama',venue:'local_process',egress:'none',retention:'zero',fallback:'ollama',effort:'unknown',outputSha256:'bad'})) {
        test(`${id}: rejects false ${field}`,()=>assert.equal(parseOrdinaryRemoteReceipt({...receipt(id),[field]:value},id),null));
    }
}
test('provenance cannot relabel a different payload or omit neural redaction',()=>{
    const r=parseOrdinaryRemoteReceipt(receipt(ids[0]),ids[0])!;
    const p={schemaVersion:'mediflow.ai.chatgpt-provenance.v1',capability:ids[0],venue:'cloud',provider:r.provider,model:r.model,preprocessing:['context_minimization','layer1_redaction','layer2_redaction','envelope_validation'],receipt:{...r,payloadSha256:'d'.repeat(64)}};
    assert.equal(parseOrdinaryRemoteProvenance(p,r),null);
    assert.equal(parseOrdinaryRemoteProvenance({...p,receipt:r,preprocessing:['context_minimization','layer1_redaction','envelope_validation']},r),null);
});
test('global opt-in is OFF absent settings, all four preferences remain local',()=>{
    const s=parseOrdinaryStoredSettings(); assert.equal(s.enabled,false);
    for(const id of ids)assert.deepEqual(s.preferences[id],{use:'local',model:null,effort:null});
});
test('preferences store names and effort only, not transient options, sessions or consent',()=>{
    const s=parseOrdinaryStoredSettings();
    const valid={...s,enabled:true,preferences:{...s.preferences,patient_insight:{use:'chatgpt_subscription',model:'synthetic-model',effort:'medium'}}};
    assert.equal(parseOrdinaryStoredSettings(JSON.stringify(valid)).preferences.patient_insight.model,'synthetic-model');
    for(const field of ['optionId','authority','consent','sessionId','approved','synthetic'])assert.throws(()=>parseOrdinaryStoredSettings(JSON.stringify({...valid,[field]:'forged'})));
    assert.throws(()=>parseOrdinaryStoredSettings(JSON.stringify({...valid,retention:'zero'})));
    assert.throws(()=>parseOrdinaryStoredSettings(JSON.stringify({...valid,preferences:{...valid.preferences,patient_insight:{...valid.preferences.patient_insight,optionId:'ephemeral'}}})));
});
