/* @Codex */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FABRIC_CAPABILITY_DESCRIPTORS } from './ai-providers/fabric/catalog';
import {
    DETERMINISTIC_CAPABILITY_IDS,
    FABRIC_VENUES,
    GENERATIVE_CAPABILITY_IDS,
} from './ai-providers/fabric/contract';
import { VENUE_OBSERVATION_REASONS } from './ai-providers/fabric/routing-observability';
import {
    FABRIC_CAPABILITY_LABELS,
    FABRIC_VENUE_COPY,
    VENUE_OBSERVATION_REASON_LABELS,
    groupFabricCapabilities,
} from './fabric-settings-view';

test('maps every Fabric capability to an Italian label', () => {
    const expected = [...GENERATIVE_CAPABILITY_IDS, ...DETERMINISTIC_CAPABILITY_IDS].sort();
    assert.deepEqual(Object.keys(FABRIC_CAPABILITY_LABELS).sort(), expected);
    assert.equal(expected.length, 16);
});

test('maps every venue and observation reason exhaustively', () => {
    assert.deepEqual(Object.keys(FABRIC_VENUE_COPY).sort(), [...FABRIC_VENUES].sort());
    assert.equal(FABRIC_VENUES.length, 4);
    assert.deepEqual(
        Object.keys(VENUE_OBSERVATION_REASON_LABELS).sort(),
        [...VENUE_OBSERVATION_REASONS].sort(),
    );
    assert.equal(VENUE_OBSERVATION_REASONS.length, 6);
});

test('groups and orders the complete registry by capability class', () => {
    const capabilities = Object.values(FABRIC_CAPABILITY_DESCRIPTORS).map((descriptor) => ({
        id: descriptor.id,
        class: descriptor.class,
        operation: descriptor.operation,
        review: descriptor.review,
        venues: descriptor.venues,
        egressProfile: {
            id: descriptor.egressProfileId,
            version: 'mediflow.ai.egress-profile.v1' as const,
            egress: descriptor.egressProfileId === 'local_only'
                ? 'none' as const
                : 'redacted_explicit_consent' as const,
        },
        killSwitch: descriptor.killSwitch,
        contractSchema: descriptor.contractSchema,
    }));

    const groups = groupFabricCapabilities(capabilities);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].id, 'generative');
    assert.deepEqual(groups[0].capabilities.map((item) => item.id), [...GENERATIVE_CAPABILITY_IDS]);
    assert.equal(groups[1].id, 'deterministic');
    assert.deepEqual(groups[1].capabilities.map((item) => item.id), [...DETERMINISTIC_CAPABILITY_IDS]);
});
