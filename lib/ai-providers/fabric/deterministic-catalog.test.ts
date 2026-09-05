/* @Codex */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { DETERMINISTIC_CAPABILITY_DESCRIPTORS } from './deterministic-catalog.ts';
import { DETERMINISTIC_CAPABILITY_IDS } from './contract.ts';

const REPOSITORY_ROOT = process.cwd();
const EXPECTED_VENUES = ['local_process', 'home_base'];

test('copre esattamente le capability deterministiche del contratto', () => {
    assert.deepEqual(
        Object.keys(DETERMINISTIC_CAPABILITY_DESCRIPTORS).sort(),
        [...DETERMINISTIC_CAPABILITY_IDS].sort(),
    );
});

test('congela ogni descrittore e allinea la chiave al relativo identificatore', () => {
    for (const [id, descriptor] of Object.entries(DETERMINISTIC_CAPABILITY_DESCRIPTORS)) {
        assert.equal(Object.isFrozen(descriptor), true, `${id} deve essere congelato`);
        assert.equal(descriptor.id, id);
    }
});

test('collega ogni capability a un entry point presente nel repository', () => {
    for (const [id, descriptor] of Object.entries(DETERMINISTIC_CAPABILITY_DESCRIPTORS)) {
        if (descriptor.entryPoint === null) assert.fail(`${id}: entry point deterministico assente`);
        const entryPoint = resolve(REPOSITORY_ROOT, descriptor.entryPoint);
        assert.equal(existsSync(entryPoint), true, `${id}: entry point mancante ${descriptor.entryPoint}`);
    }
});

test('mantiene gli schemi di contratto versionati nel relativo entry point', () => {
    for (const [id, descriptor] of Object.entries(DETERMINISTIC_CAPABILITY_DESCRIPTORS)) {
        if (descriptor.contractSchema === null) continue;
        if (descriptor.entryPoint === null) assert.fail(`${id}: entry point deterministico assente`);

        const entryPoint = resolve(REPOSITORY_ROOT, descriptor.entryPoint);
        const source = readFileSync(entryPoint, 'utf8');
        assert.equal(
            source.includes(descriptor.contractSchema),
            true,
            `${id}: schema ${descriptor.contractSchema} non trovato in ${descriptor.entryPoint}`,
        );
    }
});

test('dichiara i confini fissi delle capability deterministiche', () => {
    for (const descriptor of Object.values(DETERMINISTIC_CAPABILITY_DESCRIPTORS)) {
        assert.equal(descriptor.class, 'deterministic');
        assert.equal(descriptor.availabilityDisposition, 'available');
        assert.equal(descriptor.egressProfileId, 'local_only');
        assert.equal(descriptor.killSwitch, null);
        assert.deepEqual(descriptor.venues, EXPECTED_VENUES);
    }
});
