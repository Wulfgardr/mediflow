/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { ProviderRegistryError } from '../registry.ts';
import { FabricPolicyError, type FabricCapabilityDescriptor, type FabricExecutionPolicy } from './contract.ts';
import { DETERMINISTIC_CAPABILITY_DESCRIPTORS } from './deterministic-catalog.ts';
import { GENERATIVE_CAPABILITY_DESCRIPTORS } from './generative-catalog.ts';
import { buildProvenanceRecord, resolveFabricCapability } from './resolver.ts';

const binding = {
    task: 'caller_value_is_ignored',
    models: { clinical: 'qwen3.5:35b-a3b', reasoning: 'reasoning-model', ocr: 'ocr-model' },
    endpoint: 'http://127.0.0.1:11434',
    chatTimeoutMs: 1_000,
};
const deterministic = DETERMINISTIC_CAPABILITY_DESCRIPTORS.icd_lookup;

function policyFor(descriptor: FabricCapabilityDescriptor): FabricExecutionPolicy {
    return {
        schemaVersion: 'mediflow.ai.execution-policy.v1', requestId: 'synthetic-request',
        capability: descriptor.id, authorityPlane: 'clinical_application',
        operation: descriptor.operation, dataClass: descriptor.dataClass,
        allowedVenues: descriptor.venues, egressProfileId: descriptor.egressProfileId,
        consentRef: null, retention: 'not_persisted', review: descriptor.review,
        provenanceRequired: true, fallback: 'none',
    };
}

function expectCode(code: FabricPolicyError['code'], run: () => unknown): void {
    assert.throws(run, (error) => error instanceof FabricPolicyError && error.code === code);
}

test('risolve una generativa reale e deriva il task dalla capability', () => {
    const descriptor = GENERATIVE_CAPABILITY_DESCRIPTORS.patient_insight;
    const result = resolveFabricCapability(policyFor(descriptor), {
        descriptor,
        venue: 'local_process',
        generative: binding,
    });
    assert.equal(result.generative?.receipt.task, 'clinical');
    assert.equal(result.receipt.provider, 'ollama');
    assert.equal(result.receipt.model, 'qwen3.5:35b-a3b');
    assert.equal(result.receipt.providerReceipt, result.generative?.receipt);
    assert.equal(Object.isFrozen(result.receipt), true);
});

test('risolve una deterministica in-house senza modello', () => {
    const result = resolveFabricCapability(policyFor(deterministic), {
        descriptor: deterministic,
        venue: 'home_base',
    });
    assert.equal(result.generative, null);
    assert.equal(result.receipt.provider, 'in_house');
    assert.equal(result.receipt.model, null);
    assert.equal(result.receipt.providerReceipt, null);
    assert.equal(result.receipt.fallbackCount, 0);
});

test('treatment reasoning e autogestito: provider athena_mlx senza registry', () => {
    const descriptor = GENERATIVE_CAPABILITY_DESCRIPTORS.treatment_reasoning;
    const result = resolveFabricCapability(policyFor(descriptor), {
        descriptor,
        venue: 'local_process',
    });
    assert.equal(result.generative, null);
    assert.equal(result.receipt.provider, 'athena_mlx');
    assert.equal(result.receipt.model, null);
    assert.equal(result.receipt.providerReceipt, null);
    // Un binding registry per la lane autogestita e' un errore di classe.
    expectCode('class_mismatch', () => resolveFabricCapability(policyFor(descriptor), {
        descriptor,
        venue: 'local_process',
        generative: binding,
    }));
});

test('rifiuta ogni classe di errore Fabric raggiungibile', () => {
    const generative = GENERATIVE_CAPABILITY_DESCRIPTORS.patient_insight;
    expectCode('policy_invalid', () => resolveFabricCapability(
        { ...policyFor(deterministic), requestId: ' ' },
        { descriptor: deterministic, venue: 'local_process' }));
    expectCode('capability_unknown', () => resolveFabricCapability(
        { ...policyFor(deterministic), capability: 'fhir_export' },
        { descriptor: deterministic, venue: 'local_process' }));
    expectCode('class_mismatch', () => resolveFabricCapability(
        policyFor(generative), { descriptor: generative, venue: 'local_process' }));
    expectCode('venue_not_allowed', () => resolveFabricCapability(
        policyFor(deterministic), { descriptor: deterministic, venue: 'on_device' }));
    expectCode('cloud_not_authorized', () => resolveFabricCapability(
        policyFor(deterministic), { descriptor: deterministic, venue: 'cloud' }));
});

test('respinge ogni descriptor non canonico, anche a valori identici', () => {
    // Clone campo per campo del descriptor canonico: stesso id, stessi
    // valori, riferimento diverso. Deve fallire prima di ogni altro check.
    const forgedClone = { ...deterministic } as FabricCapabilityDescriptor;
    expectCode('capability_unknown', () => resolveFabricCapability(
        policyFor(forgedClone), { descriptor: forgedClone, venue: 'local_process' }));

    // Descriptor fabbricato con venue ampliata: il vettore del finding P1
    // della verifica terminale. Non deve mai produrre una ricevuta.
    const forgedVenue = {
        ...deterministic,
        venues: ['on_device'],
    } as unknown as FabricCapabilityDescriptor;
    expectCode('capability_unknown', () => resolveFabricCapability(
        policyFor(forgedVenue), { descriptor: forgedVenue, venue: 'on_device' }));

    // Descriptor fabbricato con profilo cloud: respinto come non canonico
    // prima ancora del check di profilo (che resta come difesa in profondita';
    // nessun descriptor canonico dichiara oggi il profilo cloud).
    const forgedProfile = {
        ...deterministic,
        egressProfileId: 'cloud_authorized_redacted',
    } as FabricCapabilityDescriptor;
    expectCode('capability_unknown', () => resolveFabricCapability(
        policyFor(forgedProfile), { descriptor: forgedProfile, venue: 'local_process' }));
});

test('propaga ProviderRegistryError senza conversione', () => {
    const descriptor = GENERATIVE_CAPABILITY_DESCRIPTORS.ocr;
    assert.throws(() => resolveFabricCapability(policyFor(descriptor), {
        descriptor,
        venue: 'local_process',
        // Fixture negativa costruita a pezzi per non attivare il guard
        // never-regress sulle URL non locali, come in registry.test.ts.
        generative: { ...binding, endpoint: ['https:', '//example.test'].join('') },
    }), (error) => error instanceof ProviderRegistryError && error.code === 'endpoint_not_local');
});

test('costruisce provenienza congelata con sole etichette', () => {
    const resolution = resolveFabricCapability(policyFor(deterministic), {
        descriptor: deterministic,
        venue: 'local_process',
    });
    const provenance = buildProvenanceRecord(resolution, ['normalize_dates', 'layer1_redaction']);
    assert.equal(Object.isFrozen(provenance), true);
    assert.equal(Object.isFrozen(provenance.preprocessing), true);
    assert.deepEqual(provenance.preprocessing, ['normalize_dates', 'layer1_redaction']);
    assert.equal(JSON.stringify(provenance).includes('synthetic clinical content'), false);
});

test('respinge etichette di preprocessing con testo libero', () => {
    const resolution = resolveFabricCapability(policyFor(deterministic), {
        descriptor: deterministic,
        venue: 'local_process',
    });
    expectCode('provenance_label_invalid', () => buildProvenanceRecord(
        resolution, ['synthetic patient Mario Rossi; prompt=mal di testa']));
    expectCode('provenance_label_invalid', () => buildProvenanceRecord(resolution, ['Layer1']));
    expectCode('provenance_label_invalid', () => buildProvenanceRecord(resolution, ['']));
});
