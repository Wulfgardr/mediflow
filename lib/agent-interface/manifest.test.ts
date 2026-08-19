/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    AGENT_INTERFACE_MANIFEST,
    validateAgentInterfaceManifest,
} from './manifest.ts';

test('classifica ogni capability dichiarata senza renderla disponibile', () => {
    assert.deepEqual(validateAgentInterfaceManifest(AGENT_INTERFACE_MANIFEST), []);
    assert.ok(AGENT_INTERFACE_MANIFEST.every((capability) => capability.headlessDisposition !== 'available'));
});

test('rifiuta una capability manuale priva di motivazione', () => {
    const [first] = AGENT_INTERFACE_MANIFEST;
    assert.ok(first);
    assert.deepEqual(validateAgentInterfaceManifest([{ ...first, reason: null }]), [
        `${first.id}: reason is required for manual_only`,
    ]);
});

test('rifiuta una capability senza una classificazione sorgente esplicita', () => {
    const [first] = AGENT_INTERFACE_MANIFEST;
    assert.ok(first);
    assert.deepEqual(validateAgentInterfaceManifest([{ ...first, sources: {} }]), [
        `${first.id}: at least one source classification is required`,
    ]);
});
