/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    AGENT_INTERFACE_MANIFEST,
    validateAgentInterfaceManifest,
} from './manifest.ts';

test('classifica ogni capability dichiarata senza renderla disponibile', () => {
    assert.deepEqual(validateAgentInterfaceManifest(AGENT_INTERFACE_MANIFEST), []);
    assert.ok(AGENT_INTERFACE_MANIFEST.every((capability) => capability.headlessDisposition === 'manual_only'
        && capability.maximumStage === 'observe' && capability.authorityProfile === 'not_grantable'));
});

test('rifiuta una capability manuale priva di motivazione', () => {
    const [first] = AGENT_INTERFACE_MANIFEST;
    assert.ok(first);
    assert.ok(validateAgentInterfaceManifest([{ ...first, reason: null }]).includes(
        `${first.id}: reason is required for manual_only`,
    ));
});

test('rifiuta una capability senza una classificazione sorgente esplicita', () => {
    const [first] = AGENT_INTERFACE_MANIFEST;
    assert.ok(first);
    assert.deepEqual(validateAgentInterfaceManifest([{ ...first, sources: {} }]), [
        `${first.id}: sources must use known kinds and non-empty unique text arrays`,
    ]);
});

test('rifiuta ID capability duplicati', () => {
    const [first] = AGENT_INTERFACE_MANIFEST;
    assert.ok(first);
    assert.deepEqual(validateAgentInterfaceManifest([first, { ...first }]), [
        `${first.id}: duplicated capability id`,
    ]);
});

test('rifiuta una versione schema diversa dal contratto', () => {
    const [first] = AGENT_INTERFACE_MANIFEST;
    assert.ok(first);
    assert.deepEqual(validateAgentInterfaceManifest([{ ...first, schemaVersion: 'mediflow.agent-interface.manifest.v1' as never }]), [
        `${first.id}: schemaVersion must be mediflow.agent-interface.manifest.v2`,
    ]);
});

// @Codex: malformed security-bound fields are rejected at runtime.
test('valida campi di sicurezza anche oltre i tipi statici', () => {
    const [first] = AGENT_INTERFACE_MANIFEST;
    assert.ok(first);
    for (const override of [
        { requiredContext: null }, { requiredContext: Object.assign(new Array(1), { extra: 'x' }) }, { venue: [null] }, { venue: Object.assign(new Array(1), { extra: 'x' }) }, { egress: 'cloud' },
        { fallback: 'allow' }, { reason: 7 }, { sources: { fabric: [null] } }, { admin: true },
    ]) assert.notDeepEqual(validateAgentInterfaceManifest([{ ...first, ...override }]), []);
    assert.notDeepEqual(validateAgentInterfaceManifest(null), []);
});
