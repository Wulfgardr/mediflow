import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    applyTerminologyRegistryVersion,
    findTerminologyRegistryEntry,
    listDefaultTerminologyRegistry,
    mergeTerminologyRegistryEntries,
    upsertTerminologyRegistryEntry,
    type TerminologyRegistryEntry,
} from './terminology-registry';
import {
    resolveStaticTerminology,
    type TerminologyItem,
    type TerminologySystemCode,
} from './terminology';

type TerminologyParityFixture = {
    schemaVersion: 1;
    systems: TerminologySystemCode[];
    registry: TerminologyRegistryEntry[];
    items: TerminologyItem[];
};

/* @Codex */
const parityFixture = JSON.parse(readFileSync(
    new URL('../native/contracts/terminology-parity.v1.json', import.meta.url),
    'utf8',
)) as TerminologyParityFixture;

test('shared fixture pins the live ATC/LOINC/UCUM registry and static items', () => {
    assert.equal(parityFixture.schemaVersion, 1);
    const registry = listDefaultTerminologyRegistry()
        .filter((entry) => parityFixture.systems.includes(entry.system));
    assert.deepEqual(registry, parityFixture.registry);

    const staticItems = parityFixture.items.filter((item) => item.system !== 'ATC');
    for (const expected of staticItems) {
        const wireItem = JSON.parse(JSON.stringify(resolveStaticTerminology(expected.system, expected.code)));
        assert.deepEqual(wireItem, expected);
    }
});

test('mergeTerminologyRegistryEntries overlays valid persisted values on defaults', () => {
    const registry = mergeTerminologyRegistryEntries([
        { system: 'LOINC', version: '2.79', source: 'manual-import', updatedAt: '2026-03-18T10:00:00.000Z' },
        { system: 'bad-system', version: 'x' },
    ]);

    const loinc = findTerminologyRegistryEntry(registry, 'LOINC');
    const atc = findTerminologyRegistryEntry(registry, 'ATC');

    assert.equal(loinc?.version, '2.79');
    assert.equal(loinc?.source, 'manual-import');
    assert.equal(loinc?.updatedAt, '2026-03-18T10:00:00.000Z');
    assert.equal(atc?.system, 'ATC');
});

test('upsertTerminologyRegistryEntry stamps updatedAt only on the changed system', () => {
    const current = listDefaultTerminologyRegistry();
    const next = upsertTerminologyRegistryEntry(
        current,
        { system: 'ATC', version: '2026-AIFA-LOCAL', source: 'local-aifa-export' },
        '2026-03-18T12:00:00.000Z',
    );

    const atc = findTerminologyRegistryEntry(next, 'ATC');
    const loinc = findTerminologyRegistryEntry(next, 'LOINC');

    assert.equal(atc?.version, '2026-AIFA-LOCAL');
    assert.equal(atc?.source, 'local-aifa-export');
    assert.equal(atc?.updatedAt, '2026-03-18T12:00:00.000Z');
    assert.equal(loinc?.updatedAt, null);
});

test('applyTerminologyRegistryVersion prefers the active registry version', () => {
    const item = applyTerminologyRegistryVersion(
        {
            system: 'ATC',
            code: 'A10BA02',
            display: 'Metformin',
            version: null,
            source: 'local-aifa-drug-catalog',
        },
        {
            system: 'ATC',
            display: 'ATC',
            version: '2026-AIFA-LOCAL',
            source: 'local-aifa-export',
            status: 'active',
            updatedAt: '2026-03-18T12:00:00.000Z',
        },
    );

    assert.equal(item.version, '2026-AIFA-LOCAL');
});
