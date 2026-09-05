/* @Codex */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FABRIC_CAPABILITY_DESCRIPTORS } from './ai-providers/fabric/catalog';
import { buildFabricStatusSnapshot } from './ai-providers/fabric/status';
import {
    DETERMINISTIC_CAPABILITY_IDS,
    FABRIC_VENUES,
    GENERATIVE_CAPABILITY_IDS,
} from './ai-providers/fabric/contract';
import { VENUE_OBSERVATION_REASONS } from './ai-providers/fabric/routing-observability';
import {
    FABRIC_AVAILABILITY_COPY,
    FABRIC_CAPABILITY_LABELS,
    PROVIDER_DISCLOSURE_LIFECYCLE_LABELS,
    FABRIC_VENUE_COPY,
    VENUE_OBSERVATION_REASON_LABELS,
    describeProviderDisclosure,
    describeFabricCapabilityAvailability,
    groupFabricCapabilities,
    parseFabricSnapshotPair,
} from './fabric-settings-view';

test('maps every availability disposition to truthful Italian copy', () => {
    assert.deepEqual(Object.keys(FABRIC_AVAILABILITY_COPY).sort(), [
        'available',
        'manual_only',
        'proposal_only',
        'unavailable',
    ]);
    assert.deepEqual(FABRIC_AVAILABILITY_COPY.available, {
        title: 'Disponibile nell’app',
        description: 'Funzione applicativa disponibile; non attesta provider, modello o stato runtime.',
    });
    assert.equal(FABRIC_AVAILABILITY_COPY.proposal_only.title, 'Solo proposta');
    assert.equal(FABRIC_AVAILABILITY_COPY.unavailable.title, 'Non disponibile');
});

test('describes executable and terminally unavailable capabilities without implied runtime claims', () => {
    const snapshot = buildFabricStatusSnapshot();
    const byId = Object.fromEntries(snapshot.capabilities.map((capability) => [capability.id, capability]));

    assert.deepEqual(describeFabricCapabilityAvailability(byId.ocr!), {
        status: FABRIC_AVAILABILITY_COPY.unavailable,
        venues: 'Nessuna sede: funzione non eseguibile',
        egress: 'Non applicabile',
        terminalUnavailable: true,
    });
    assert.deepEqual(describeFabricCapabilityAvailability(byId.smart_import!), {
        status: FABRIC_AVAILABILITY_COPY.proposal_only,
        venues: 'Questo Mac · Postazione principale',
        egress: 'Solo locale',
        terminalUnavailable: false,
    });
    assert.equal(
        describeFabricCapabilityAvailability(byId.icd_lookup!).status.title,
        'Disponibile nell’app',
    );
});

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

test('descrive provider dichiarati ed effettivi senza trasformare lifecycle o readiness in runtime', () => {
    const snapshot = buildFabricStatusSnapshot({
        ollama: () => ({
            status: 'available',
            record: { lifecycle: {
                schemaVersion: 'mediflow.ai.provider-lifecycle.v1',
                provider: 'ollama',
                credentialClass: 'local_model',
                status: 'available_unqualified',
            } },
        }),
        athena: () => ({ status: 'denied', reason: 'missing' }),
    });
    const [ollama, athena, openai] = snapshot.providerDisclosure.providers.map(describeProviderDisclosure);

    assert.equal(ollama.lifecycle, PROVIDER_DISCLOSURE_LIFECYCLE_LABELS.available_unqualified);
    assert.equal(ollama.runtimeObservation, 'Non osservata: serve una receipt dell’operazione corrente.');
    assert.equal(ollama.executionDisposition, 'Nessuna esecuzione corrente osservata');
    assert.equal(ollama.effectiveVenue, 'Non osservata');
    assert.equal(ollama.effectiveEgress, 'Non osservato');
    assert.equal(athena.lifecycle, 'Lifecycle assente');
    assert.equal(athena.executionDisposition, 'Negata dal contratto');
    assert.equal(openai.lifecycle, 'Non applicabile');
    assert.equal(openai.executionDisposition, 'Esecuzione disabilitata');
    assert.equal(openai.accessBoundary, 'Un abbonamento consumer non equivale all’accesso API.');
});

test('groups and orders the complete registry by capability class', () => {
    const capabilities = Object.values(FABRIC_CAPABILITY_DESCRIPTORS).map((descriptor) => ({
        id: descriptor.id,
        class: descriptor.class,
        operation: descriptor.operation,
        review: descriptor.review,
        availabilityDisposition: descriptor.availabilityDisposition,
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

test('rejects every non-canonical capability field and unexpected status key', () => {
    const observability = {
        schemaVersion: 'mediflow.ai.fabric-observability.v1',
        fallback: 'denied_by_contract',
        observations: FABRIC_VENUES.map((venue) => ({ venue, state: 'unknown', reason: 'not_probed' })),
    };
    const valid = () => structuredClone(buildFabricStatusSnapshot()) as unknown as Record<string, unknown> & {
        capabilities: Array<Record<string, unknown>>;
        providerDisclosure: { providers: Array<Record<string, unknown>> };
    };
    assert.equal(parseFabricSnapshotPair(valid(), observability).status.capabilities.length, 16);

    const mutations: Array<readonly [string, (status: ReturnType<typeof valid>) => void]> = [
        ['missing availability disposition', (status) => { delete status.capabilities[0].availabilityDisposition; }],
        ['unknown availability disposition', (status) => { status.capabilities[0].availabilityDisposition = 'ready'; }],
        ['generative disposition drift', (status) => {
            const capability = status.capabilities.find((item) => item.id === 'patient_insight')!;
            capability.availabilityDisposition = 'available';
        }],
        ['deterministic disposition drift', (status) => {
            const capability = status.capabilities.find((item) => item.id === 'icd_lookup')!;
            capability.availabilityDisposition = 'proposal_only';
        }],
        ['OCR disposition drift', (status) => {
            const capability = status.capabilities.find((item) => item.id === 'ocr')!;
            capability.availabilityDisposition = 'available';
        }],
        ['OCR venue drift', (status) => {
            const capability = status.capabilities.find((item) => item.id === 'ocr')!;
            capability.venues = ['local_process'];
        }],
        ['OCR kill switch drift', (status) => {
            const capability = status.capabilities.find((item) => item.id === 'ocr')!;
            capability.killSwitch = 'aiOcrKillSwitch';
        }],
        ['class drift', (status) => {
            const capability = status.capabilities.find((item) => item.id === 'smart_import')!;
            capability.class = 'deterministic';
        }],
        ['operation drift', (status) => {
            const capability = status.capabilities.find((item) => item.id === 'smart_import')!;
            capability.operation = 'lookup';
        }],
        ['review drift', (status) => {
            const capability = status.capabilities.find((item) => item.id === 'smart_import')!;
            capability.review = 'informational';
        }],
        ['executable venue order drift', (status) => {
            const capability = status.capabilities.find((item) => item.id === 'smart_import')!;
            capability.venues = ['home_base', 'local_process'];
        }],
        ['egress profile drift', (status) => {
            const capability = status.capabilities.find((item) => item.id === 'smart_import')!;
            capability.egressProfile = {
                id: 'cloud_authorized_redacted',
                version: 'mediflow.ai.egress-profile.v1',
                egress: 'redacted_explicit_consent',
            };
        }],
        ['kill switch drift', (status) => {
            const capability = status.capabilities.find((item) => item.id === 'smart_import')!;
            capability.killSwitch = null;
        }],
        ['contract schema drift', (status) => {
            const capability = status.capabilities.find((item) => item.id === 'smart_import')!;
            capability.contractSchema = null;
        }],
        ['provider key leak', (status) => {
            const capability = status.capabilities.find((item) => item.id === 'ocr')!;
            capability.provider = 'ollama';
        }],
        ['fallback key leak', (status) => {
            const capability = status.capabilities.find((item) => item.id === 'ocr')!;
            capability.fallback = 'none';
        }],
        ['entry point key leak', (status) => {
            const capability = status.capabilities.find((item) => item.id === 'ocr')!;
            capability.entryPoint = 'app/api/ocr/extract/route.ts';
        }],
    ];
    for (const [label, mutate] of mutations) {
        const status = valid();
        mutate(status);
        assert.throws(
            () => parseFabricSnapshotPair(status, observability),
            /Registro capability Fabric non conforme/u,
            label,
        );
    }

    for (const [label, mutate] of [
        ['contract version drift', (status: ReturnType<typeof valid>) => { status.contractVersion = 'other'; }],
        ['readiness note drift', (status: ReturnType<typeof valid>) => { status.readinessNote = 'ready'; }],
        ['unexpected root key', (status: ReturnType<typeof valid>) => { status.provider = 'ollama'; }],
    ] as const) {
        const status = valid();
        mutate(status);
        assert.throws(
            () => parseFabricSnapshotPair(status, observability),
            /Snapshot Fabric non conforme/u,
            label,
        );
    }

    for (const [label, mutate] of [
        ['provider order drift', (status: ReturnType<typeof valid>) => {
            status.providerDisclosure.providers.reverse();
        }],
        ['provider runtime overclaim', (status: ReturnType<typeof valid>) => {
            (status.providerDisclosure.providers[0].effective as Record<string, unknown>).runtimeObservation = 'observed';
        }],
        ['provider venue leak', (status: ReturnType<typeof valid>) => {
            (status.providerDisclosure.providers[0].effective as Record<string, unknown>).venue = 'local_process';
        }],
        ['cloud execution drift', (status: ReturnType<typeof valid>) => {
            (status.providerDisclosure.providers[2].effective as Record<string, unknown>).executionDisposition = 'not_observed';
        }],
        ['provider secret field', (status: ReturnType<typeof valid>) => {
            status.providerDisclosure.providers[0].endpoint = 'synthetic-local-endpoint';
        }],
    ] as const) {
        const status = valid();
        mutate(status);
        assert.throws(
            () => parseFabricSnapshotPair(status, observability),
            /Disclosure provider Fabric non conforme/u,
            label,
        );
    }
});
