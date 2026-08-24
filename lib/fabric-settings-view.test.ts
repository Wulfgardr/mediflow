/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
    buildFabricProviderDisclosures,
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

test('projects five provider paths without turning the snapshots into readiness or access claims', () => {
    const disclosures = buildFabricProviderDisclosures({
        schemaVersion: 'mediflow.ai.fabric-status.v1',
        contractVersion: 'mediflow.ai.fabric.v1',
        egressGateOpen: false,
        readinessNote: 'available_unqualified',
        capabilities: [],
    }, {
        schemaVersion: 'mediflow.ai.fabric-observability.v1',
        fallback: 'denied_by_contract',
        observations: [
            { venue: 'local_process', state: 'available', reason: null },
            { venue: 'home_base', state: 'offline', reason: 'mode_disabled' },
            { venue: 'on_device', state: 'unknown', reason: 'not_implemented' },
            { venue: 'cloud', state: 'offline', reason: 'egress_profile_closed' },
        ],
    });

    assert.deepEqual(disclosures.map((disclosure) => disclosure.id), [
        'ollama', 'athena', 'apple_vision_ocr', 'openai', 'anthropic',
    ]);
    assert.deepEqual(disclosures.map((disclosure) => disclosure.mark), ['O', 'A', 'V', 'O', 'A']);
    assert.match(disclosures[0].detail, /local_process/u);
    assert.match(disclosures[0].detail, /modello.*capacità.*non è esposto qui/u);
    assert.match(disclosures[1].detail, /athena_mlx.*ATHENA-R1-Qwen3-8B.*non è osservato/u);
    assert.match(disclosures[2].detail, /solo macOS.*Non è una capacità Fabric on-device/u);
    for (const disclosure of disclosures.slice(3)) {
        assert.match(disclosure.detail, /consumer_login.*Accesso non configurabile.*Egress chiuso/u);
    }
    assert.match(disclosures[0].observation, /Disponibilità non qualificata/u);
    assert.match(disclosures[1].observation, /ATHENA.*stato.*non osservato/u);
    assert.match(disclosures[2].observation, /Fallback macOS locale.*on-device Fabric/u);
    assert.match(disclosures[3].observation, /OpenAI.*candidato.*consumer_login.*Egress chiuso/u);
    assert.match(disclosures[4].observation, /Anthropic.*candidato.*consumer_login.*Egress chiuso/u);
    for (const disclosure of disclosures.slice(1)) {
        assert.doesNotMatch(disclosure.observation, /Disponibilità non qualificata/u);
    }
    assert.doesNotMatch(JSON.stringify(disclosures), /\bready\b|\bpronto\b|\bautenticato\b|\babilitato\b|configura.*modello|kill.?switch/iu);
});

test('keeps the provider disclosure component static and free of actions or provider calls', () => {
    const source = readFileSync(new URL('../components/settings/fabric-venue-section.tsx', import.meta.url), 'utf8');

    assert.match(source, /<section/u);
    assert.match(source, /<li/u);
    assert.doesNotMatch(source, /<form|<button|<input|<select|<textarea|<a\s|<Link\b|fetch\(|useEffect|useState|onClick|onSubmit|href=/u);
    assert.doesNotMatch(source, /killSwitch|model\s*:|route|router|egressGateOpen\s*=|isEgressGateOpen/u);
});
