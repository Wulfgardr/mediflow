/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { localProviderRegistry, ProviderRegistryError } from '../registry.ts';
import {
    DETERMINISTIC_CAPABILITY_IDS, FABRIC_PREPROCESSING_LABELS,
    FABRIC_PREPROCESSING_LABEL_PATTERN, FABRIC_VENUES, GENERATIVE_CAPABILITY_IDS,
    FabricPolicyError, type FabricCapabilityDescriptor, type FabricExecutionPolicy,
} from './contract.ts';
import { DETERMINISTIC_CAPABILITY_DESCRIPTORS } from './deterministic-catalog.ts';
import { GENERATIVE_CAPABILITY_DESCRIPTORS } from './generative-catalog.ts';
import {
    buildProvenanceRecord,
    resolveFabricCapability,
    resolveFabricCapabilityWithHostResolution,
} from './resolver.ts';

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

test('riusa la resolution host validata senza ricostruire adapter o binding', () => {
    const descriptor = GENERATIVE_CAPABILITY_DESCRIPTORS.smart_import;
    const hostResolution = localProviderRegistry.resolve({ ...binding, task: 'clinical' });

    const result = resolveFabricCapabilityWithHostResolution(policyFor(descriptor), {
        descriptor,
        venue: 'local_process',
        generative: hostResolution,
    });

    assert.equal(result.generative, hostResolution);
    assert.equal(result.generative?.adapter, hostResolution.adapter);
    assert.equal(result.receipt.providerReceipt, hostResolution.receipt);
    assert.equal(result.receipt.model, hostResolution.receipt.model);
});

test('rifiuta una resolution host legata al task di un altro descriptor', () => {
    const descriptor = GENERATIVE_CAPABILITY_DESCRIPTORS.smart_import;
    const wrongTask = localProviderRegistry.resolve({ ...binding, task: 'reasoning' });

    assert.throws(() => resolveFabricCapabilityWithHostResolution(policyFor(descriptor), {
        descriptor,
        venue: 'local_process',
        generative: wrongTask,
    }), (error) => error instanceof ProviderRegistryError && error.code === 'invalid_task');
});

test('rifiuta un descriptor host non canonico prima di emettere receipt', () => {
    const descriptor = GENERATIVE_CAPABILITY_DESCRIPTORS.smart_import;
    const hostResolution = localProviderRegistry.resolve({ ...binding, task: 'clinical' });
    const forged = { ...descriptor } as FabricCapabilityDescriptor;

    expectCode('capability_unknown', () => resolveFabricCapabilityWithHostResolution(
        policyFor(descriptor),
        { descriptor: forged, venue: 'local_process', generative: hostResolution },
    ));
});

test('applica al binding host la stessa policy e le stesse venue fail-closed', () => {
    const descriptor = GENERATIVE_CAPABILITY_DESCRIPTORS.smart_import;
    const hostResolution = localProviderRegistry.resolve({ ...binding, task: 'clinical' });
    const run = (policy: FabricExecutionPolicy, venue: FabricExecutionPolicy['allowedVenues'][number]) => (
        resolveFabricCapabilityWithHostResolution(policy, { descriptor, venue, generative: hostResolution })
    );

    expectCode('policy_invalid', () => run({
        ...policyFor(descriptor),
        fallback: 'alternate',
    } as unknown as FabricExecutionPolicy, 'local_process'));
    expectCode('policy_invalid', () => run({
        ...policyFor(descriptor),
        operation: 'lookup',
    }, 'local_process'));
    expectCode('venue_not_allowed', () => run({
        ...policyFor(descriptor),
        allowedVenues: ['local_process'],
    }, 'home_base'));
    expectCode('cloud_not_authorized', () => run(policyFor(descriptor), 'cloud'));
});

test('nega mismatch host provider, modello, localita, endpoint e fallback senza invocare provider', () => {
    const descriptor = GENERATIVE_CAPABILITY_DESCRIPTORS.smart_import;
    const base = localProviderRegistry.resolve({ ...binding, task: 'clinical' });
    let providerCalls = 0;
    const adapter = (overrides: Record<string, unknown> = {}) => ({
        id: 'ollama',
        kind: 'local',
        capabilities: base.adapter.capabilities,
        getBaseUrl: () => base.adapter.getBaseUrl(),
        getModel: () => base.adapter.getModel(),
        chat: async () => { providerCalls += 1; throw new Error('not-called'); },
        listModels: async () => { providerCalls += 1; throw new Error('not-called'); },
        ...overrides,
    });
    const cases = [
        [{ ...base, receipt: { ...base.receipt, provider: 'other' } }, 'provider_not_registered'],
        [{ ...base, manifest: { ...base.manifest, provider: 'other' } }, 'provider_not_registered'],
        [{ ...base, adapter: adapter({ id: 'other' }) }, 'provider_not_registered'],
        [{ ...base, adapter: adapter({ getModel: () => 'other-model' }) }, 'invalid_model'],
        [{ ...base, adapter: adapter({ kind: 'cloud' }) }, 'provider_not_local'],
        [{ ...base, adapter: adapter({ getBaseUrl: () => 'http://localhost:11434' }) }, 'endpoint_not_local'],
        [{ ...base, fallback: { strategy: 'none', candidates: ['other'] } }, 'provider_not_local'],
    ] as const;

    for (const [generative, code] of cases) {
        assert.throws(() => resolveFabricCapabilityWithHostResolution(policyFor(descriptor), {
            descriptor,
            venue: 'local_process',
            generative: generative as never,
        }), (error) => error instanceof ProviderRegistryError && error.code === code);
    }
    assert.equal(providerCalls, 0);
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
    // I tipi non sono enforcement: valori runtime fuori contratto devono
    // fallire anche quando TypeScript li vieterebbe staticamente.
    expectCode('policy_invalid', () => resolveFabricCapability(
        { ...policyFor(deterministic), retention: 'remote_forever' } as unknown as FabricExecutionPolicy,
        { descriptor: deterministic, venue: 'local_process' }));
    expectCode('policy_invalid', () => resolveFabricCapability(
        { ...policyFor(deterministic), consentRef: { synthetic: true } } as unknown as FabricExecutionPolicy,
        { descriptor: deterministic, venue: 'local_process' }));
    expectCode('policy_invalid', () => resolveFabricCapability(
        { ...policyFor(deterministic), allowedVenues: 'local_process' } as unknown as FabricExecutionPolicy,
        { descriptor: deterministic, venue: 'local_process' }));
    expectCode('policy_invalid', () => resolveFabricCapability(
        { ...policyFor(deterministic), allowedVenues: ['local_process', 'everywhere'] } as unknown as FabricExecutionPolicy,
        { descriptor: deterministic, venue: 'local_process' }));
    // Array sparso: every() salta i buchi, la validazione deve normalizzarli.
    const sparseVenues = new Array(2);
    sparseVenues[1] = 'local_process';
    expectCode('policy_invalid', () => resolveFabricCapability(
        { ...policyFor(deterministic), allowedVenues: sparseVenues } as unknown as FabricExecutionPolicy,
        { descriptor: deterministic, venue: 'local_process' }));
    // TOCTOU: un includes ridefinito dal chiamante non deve ampliare le
    // venue oltre quelle dichiarate (la membership usa lo snapshot interno).
    const lyingVenues = ['local_process'] as string[] & { includes: (v: string) => boolean };
    lyingVenues.includes = () => true;
    expectCode('venue_not_allowed', () => resolveFabricCapability(
        { ...policyFor(deterministic), allowedVenues: lyingVenues } as unknown as FabricExecutionPolicy,
        { descriptor: deterministic, venue: 'home_base' }));
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

test('nega OCR terminale prima di consultare il provider registry', () => {
    const descriptor = GENERATIVE_CAPABILITY_DESCRIPTORS.ocr;
    const policy = Object.freeze({
        ...policyFor(descriptor),
        allowedVenues: Object.freeze(['local_process'] as const),
    });
    let bindingReads = 0;
    const hostileRequest = {
        descriptor,
        venue: 'local_process' as const,
        get generative(): never {
            bindingReads += 1;
            throw new Error('provider binding materialized');
        },
    };

    expectCode('venue_not_allowed', () => resolveFabricCapability(policy, hostileRequest));
    assert.equal(bindingReads, 0);
});

test('nega OCR terminale prima di materializzare una resolution host', () => {
    const descriptor = GENERATIVE_CAPABILITY_DESCRIPTORS.ocr;
    const policy = Object.freeze({
        ...policyFor(descriptor),
        allowedVenues: Object.freeze(['local_process'] as const),
    });
    let resolutionReads = 0;
    const hostileRequest = {
        descriptor,
        venue: 'local_process' as const,
        get generative(): never {
            resolutionReads += 1;
            throw new Error('host resolution materialized');
        },
    };

    expectCode('venue_not_allowed', () => resolveFabricCapabilityWithHostResolution(policy, hostileRequest));
    assert.equal(resolutionReads, 0);
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
    // Coerenza del contratto: ogni voce del vocabolario chiuso rispetta il
    // vincolo di forma dichiarato.
    for (const label of FABRIC_PREPROCESSING_LABELS) {
        assert.equal(FABRIC_PREPROCESSING_LABEL_PATTERN.test(label), true, label);
    }
});

test('le costanti array del contratto sono congelate a runtime', () => {
    // 'as const' vincola solo il tipo: senza Object.freeze una mutazione
    // prima del load del resolver avvelenerebbe i Set derivati.
    assert.equal(Object.isFrozen(FABRIC_PREPROCESSING_LABELS), true);
    assert.equal(Object.isFrozen(FABRIC_VENUES), true);
    assert.equal(Object.isFrozen(GENERATIVE_CAPABILITY_IDS), true);
    assert.equal(Object.isFrozen(DETERMINISTIC_CAPABILITY_IDS), true);
    assert.throws(() => {
        (FABRIC_PREPROCESSING_LABELS as unknown as string[]).push('diagnosi_diabete_tipo_2');
    }, TypeError);
});

test('respinge etichette di preprocessing fuori dal vocabolario chiuso', () => {
    const resolution = resolveFabricCapability(policyFor(deterministic), {
        descriptor: deterministic,
        venue: 'local_process',
    });
    expectCode('provenance_label_invalid', () => buildProvenanceRecord(
        resolution, ['synthetic patient Mario Rossi; prompt=mal di testa']));
    expectCode('provenance_label_invalid', () => buildProvenanceRecord(resolution, ['Layer1']));
    expectCode('provenance_label_invalid', () => buildProvenanceRecord(resolution, ['']));
    // Snake_case sintatticamente valido ma con semantica clinica: il pattern
    // da solo non basta, il vocabolario chiuso deve respingerlo.
    expectCode('provenance_label_invalid', () => buildProvenanceRecord(
        resolution, ['diagnosi_diabete_tipo_2']));
    // TOCTOU: un iteratore stateful che cambia valori tra la validazione e
    // la materializzazione non deve inserire label vietate nel record: la
    // stessa copia validata e' quella congelata.
    let iterations = 0;
    const statefulLabels = ['normalize_dates'];
    Object.defineProperty(statefulLabels, Symbol.iterator, {
        value: function* () {
            iterations += 1;
            yield iterations === 1 ? 'normalize_dates' : 'diagnosi_diabete_tipo_2';
        },
    });
    const record = buildProvenanceRecord(resolution, statefulLabels);
    assert.deepEqual([...record.preprocessing], ['normalize_dates']);
});
