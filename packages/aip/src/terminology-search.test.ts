/* @Codex */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAipOwnerBrokerV1 } from './owner-broker.ts';
import {
    AIP_TERMINOLOGY_SEARCH_CONTRACT_V1,
    AipTerminologySearchV1Error,
    createAipTerminologySearchServiceV1,
    createLocalAipTerminologySearchServiceV1,
} from './terminology-search.ts';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const BINDING = Object.freeze({
    peerRef: 'peer.local.synthetic.0001', runtimeRef: 'runtime.local.synthetic.0001',
    parentRef: 'parent.local.synthetic.0001', purposeCode: 'terminology_lookup',
    operation: 'mediflow.terminology.search.v1', capabilityId: 'mediflow.terminology.search.v1',
    scopeDigest: DIGEST, maxStage: 'read_only', budget: 4, expiresAt: 2_000,
    generation: 1, revocationGeneration: 0, selectionEpoch: 7, parentGeneration: 3,
    policyGeneration: 5, venue: 'local_intelligent_host', egressAllowed: false,
});
const CURRENT = Object.freeze({
    peerRef: BINDING.peerRef, runtimeRef: BINDING.runtimeRef, generation: BINDING.generation,
    revocationGeneration: BINDING.revocationGeneration, selectionEpoch: BINDING.selectionEpoch,
    parentGeneration: BINDING.parentGeneration, policyGeneration: BINDING.policyGeneration,
});
const CLAIM = Object.freeze({ operation: BINDING.operation, capabilityId: BINDING.capabilityId });

function createPermitPorts(hooks: Readonly<{
    onBegin?: () => void;
    onFinalize?: () => unknown;
    onDeny?: () => void;
}> = {}) {
    const permits = new WeakSet<object>();
    const executions = new WeakMap<object, 'active' | 'consumed' | 'denied'>();
    return {
        beginPermit: (permit: unknown): object => {
            if (!permit || typeof permit !== 'object' || permits.has(permit)) throw new Error('permit unavailable');
            permits.add(permit);
            hooks.onBegin?.();
            const execution = Object.freeze(Object.create(null)) as object;
            executions.set(execution, 'active');
            return execution;
        },
        finalizePermit: (execution: unknown): unknown => {
            if (!execution || typeof execution !== 'object' || executions.get(execution) !== 'active') {
                throw new Error('execution unavailable');
            }
            const result = hooks.onFinalize?.();
            executions.set(execution, 'consumed');
            return result === undefined ? true : result;
        },
        denyPermit: (execution: unknown): boolean => {
            if (!execution || typeof execution !== 'object' || !executions.has(execution)) {
                throw new Error('execution unavailable');
            }
            if (executions.get(execution) !== 'active') return false;
            executions.set(execution, 'denied');
            hooks.onDeny?.();
            return true;
        },
    };
}

function brokerPermitPorts(broker: ReturnType<typeof createAipOwnerBrokerV1>) {
    return {
        beginPermit: broker.beginPermit,
        finalizePermit: broker.finalizePermit,
        denyPermit: broker.denyPermit,
    };
}

test('pubblica i 13 campi e cerca il catalogo LOINC locale con receipt PHI-safe', async () => {
    assert.deepEqual(Reflect.ownKeys(AIP_TERMINOLOGY_SEARCH_CONTRACT_V1), [
        'operationId', 'capabilityId', 'applicationServiceRef', 'inputSchema', 'outputSchema',
        'maximumStage', 'authorityPolicy', 'sessionPolicy', 'casPolicy', 'idempotencyPolicy',
        'limitPolicy', 'receiptPolicy', 'fabricDependency',
    ]);
    assert.equal(Object.isFrozen(AIP_TERMINOLOGY_SEARCH_CONTRACT_V1), true);
    assert.equal(Object.getPrototypeOf(AIP_TERMINOLOGY_SEARCH_CONTRACT_V1), null);

    const audit: Array<Record<string, unknown>> = [];
    const refs = ['agent.synthetic.0001', 'lease.synthetic.0001'];
    const broker = createAipOwnerBrokerV1({
        now: () => 1_000, nextRef: () => refs.shift(), hashRef: () => DIGEST,
        writeAudit: async (record: unknown) => { audit.push(record as Record<string, unknown>); },
    });
    const permit = await broker.authorize(broker.issueLease(broker.issueOwner(BINDING)), CURRENT, CLAIM);
    const service = createLocalAipTerminologySearchServiceV1({
        now: () => 1_001, nextReceiptRef: () => 'receipt.synthetic.0001', current: () => CURRENT,
        ...brokerPermitPorts(broker),
        writeAudit: async (record: unknown) => { audit.push(record as Record<string, unknown>); },
    });

    const output = await service.execute(permit, {
        schemaVersion: 'mediflow.terminology.search.input.v1',
        operationId: 'mediflow.terminology.search.v1', system: 'LOINC', query: 'emoglobina', limit: 2,
    });

    assert.equal(output.outcome, 'read');
    assert.deepEqual(Array.from(output.items, (item) => ({ ...item })), [{
        system: 'LOINC', code: '718-7', display: 'Hemoglobin [Mass/volume] in Blood',
        displayIt: 'Emoglobina (Hb)', defaultUnit: 'g/dL', version: '2.78',
    }]);
    assert.deepEqual({ ...output.receipt }, {
        schemaVersion: 'mediflow.terminology.search.receipt.v1',
        receiptRef: 'receipt.synthetic.0001', operationId: BINDING.operation,
        capabilityId: BINDING.capabilityId, outcome: 'read', system: 'LOINC', resultCount: 1,
        catalogSource: 'local-pilot-catalog', egress: 'none', writesPerformed: 0,
        fabricDependency: 'none', timestamp: 1_001,
    });
    assert.equal(JSON.stringify(output.receipt).includes('emoglobina'), false);
    assert.equal('query' in output.receipt, false);
    assert.deepEqual(audit.map((record) => record.eventType), ['authorization', 'terminology_search']);
    assert.equal(JSON.stringify(audit).includes('emoglobina'), false);
});

test('la cancellazione host sincrona nega prima di consumare il permit o pubblicare output', async () => {
    let began = 0;
    let finalized = 0;
    let denied = 0;
    let audited = 0;
    const service: ReturnType<typeof createAipTerminologySearchServiceV1> = createAipTerminologySearchServiceV1({
        now: () => 1_000, nextReceiptRef: () => 'receipt.synthetic.cancel', current: () => CURRENT,
        ...createPermitPorts({ onBegin: () => { began += 1; }, onFinalize: () => { finalized += 1; },
            onDeny: () => { denied += 1; } }),
        searchCatalog: () => { service.cancel(); return []; },
        writeAudit: async () => { audited += 1; },
    });

    await assert.rejects(service.execute(Object.freeze(Object.create(null)), {
        schemaVersion: 'mediflow.terminology.search.input.v1', operationId: BINDING.operation,
        system: 'UCUM', query: 'mg/dL', limit: 2,
    }), (error: unknown) => error instanceof AipTerminologySearchV1Error && error.code === 'cancelled');
    assert.equal(began, 1);
    assert.equal(finalized, 0);
    assert.equal(denied, 1);
    assert.equal(audited, 1);
});

test('nega input hostile, Unicode non ben formato e campi fuori limite senza side effect', async () => {
    let reads = 0;
    let searches = 0;
    let consumed = 0;
    const service = createAipTerminologySearchServiceV1({
        now: () => 1_000, nextReceiptRef: () => 'receipt.synthetic.invalid', current: () => CURRENT,
        ...createPermitPorts({ onBegin: () => { consumed += 1; } }),
        searchCatalog: () => { searches += 1; return []; }, writeAudit: async () => undefined,
    });
    const valid = {
        schemaVersion: 'mediflow.terminology.search.input.v1', operationId: BINDING.operation,
        system: 'LOINC', query: 'emoglobina', limit: 2,
    };
    const accessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperties(accessor, {
        ...Object.getOwnPropertyDescriptors(valid),
        query: { enumerable: true, get: () => { reads += 1; return 'emoglobina'; } },
    });
    const thenable = Object.create(null) as Record<string, unknown>;
    Object.defineProperties(thenable, {
        ...Object.getOwnPropertyDescriptors(valid),
        then: { enumerable: true, get: () => { reads += 1; return undefined; } },
    });
    const proxy = new Proxy(valid, { get() { reads += 1; throw new Error('must not read'); } });
    const invalid = [
        { ...valid, extra: true }, { ...valid, system: 'loinc' }, { ...valid, query: '' },
        { ...valid, query: '\uD800' }, { ...valid, query: 'é'.repeat(49) }, { ...valid, limit: 11 },
        accessor, thenable, proxy, Promise.resolve(valid), Object.assign(Object.create({}), valid),
    ];
    for (const value of invalid) {
        await assert.rejects(service.execute(Object.freeze(Object.create(null)), value),
            (error: unknown) => error instanceof AipTerminologySearchV1Error && error.code === 'input_invalid');
    }
    assert.equal(reads, 0);
    assert.equal(searches, 0);
    assert.equal(consumed, 0);
});

test('un permit avviato resta monouso anche se il catalogo restituisce un output hostile', async () => {
    let reads = 0;
    let searches = 0;
    const hostile = Object.create(null) as object;
    Object.defineProperty(hostile, 'then', { enumerable: true, get: () => { reads += 1; return undefined; } });
    const service = createAipTerminologySearchServiceV1({
        now: () => 1_000, nextReceiptRef: () => 'receipt.synthetic.hostile', current: () => CURRENT,
        ...createPermitPorts(),
        searchCatalog: () => { searches += 1; return searches === 1 ? hostile : []; },
        writeAudit: async () => undefined,
    });
    const permit = Object.freeze(Object.create(null));
    const input = {
        schemaVersion: 'mediflow.terminology.search.input.v1', operationId: BINDING.operation,
        system: 'UCUM', query: 'mg/dL', limit: 2,
    };

    await assert.rejects(service.execute(permit, input),
        (error: unknown) => error instanceof AipTerminologySearchV1Error && error.code === 'catalog_invalid');
    await assert.rejects(service.execute(permit, input),
        (error: unknown) => error instanceof AipTerminologySearchV1Error && error.code === 'authorization_denied');
    assert.equal(reads, 0);
    assert.equal(searches, 1);
});

test('riserva il permit nel broker prima del catalogo e nega il replay tra servizi', async () => {
    const refs = ['agent.synthetic.cross-service', 'lease.synthetic.cross-service'];
    const broker = createAipOwnerBrokerV1({
        now: () => 1_000, nextRef: () => refs.shift(), hashRef: () => DIGEST, writeAudit: async () => undefined,
    });
    const permit = await broker.authorize(broker.issueLease(broker.issueOwner(BINDING)), CURRENT, CLAIM);
    let secondSearches = 0;
    const first = createAipTerminologySearchServiceV1({
        now: () => 1_001, nextReceiptRef: () => 'receipt.synthetic.cross1', current: () => CURRENT,
        ...brokerPermitPorts(broker), searchCatalog: () => { throw new Error('synthetic catalog failure'); },
        writeAudit: async () => undefined,
    });
    const second = createAipTerminologySearchServiceV1({
        now: () => 1_002, nextReceiptRef: () => 'receipt.synthetic.cross2', current: () => CURRENT,
        ...brokerPermitPorts(broker), searchCatalog: () => { secondSearches += 1; return []; },
        writeAudit: async () => undefined,
    });
    const input = {
        schemaVersion: 'mediflow.terminology.search.input.v1', operationId: BINDING.operation,
        system: 'UCUM', query: 'mg/dL', limit: 2,
    };

    await assert.rejects(first.execute(permit, input),
        (error: unknown) => error instanceof AipTerminologySearchV1Error && error.code === 'catalog_invalid');
    await assert.rejects(second.execute(permit, input),
        (error: unknown) => error instanceof AipTerminologySearchV1Error && error.code === 'authorization_denied');
    assert.equal(secondSearches, 0);
});

test('audita il denial dopo input e permit ammissibili anche se il begin broker nega', async () => {
    const audits: Array<Record<string, unknown>> = [];
    const service = createAipTerminologySearchServiceV1({
        now: () => 1_000, nextReceiptRef: () => 'receipt.synthetic.begin-denial', current: () => CURRENT,
        ...createPermitPorts(), beginPermit: () => { throw new Error('synthetic revoked permit'); },
        searchCatalog: () => { throw new Error('must not search'); },
        writeAudit: async (record: unknown) => { audits.push(record as Record<string, unknown>); },
    });
    await assert.rejects(service.execute(Object.freeze(Object.create(null)), {
        schemaVersion: 'mediflow.terminology.search.input.v1', operationId: BINDING.operation,
        system: 'LOINC', query: 'sodio', limit: 2,
    }), (error: unknown) => error instanceof AipTerminologySearchV1Error
        && error.code === 'authorization_denied' && !error.message.includes('synthetic'));
    assert.deepEqual(audits.map((record) => [record.outcome, record.denialCode]),
        [['denied', 'authorization_denied']]);
    assert.doesNotMatch(JSON.stringify(audits[0]), /sodio|items|query/ui);
});

test('nega una receipt reference host duplicata senza pubblicare un secondo audit allowed', async () => {
    const audit: Array<Record<string, unknown>> = [];
    const service = createAipTerminologySearchServiceV1({
        now: () => 1_000, nextReceiptRef: () => 'receipt.synthetic.duplicate', current: () => CURRENT,
        ...createPermitPorts(), searchCatalog: () => [],
        writeAudit: async (record: unknown) => { audit.push(record as Record<string, unknown>); },
    });
    const input = {
        schemaVersion: 'mediflow.terminology.search.input.v1', operationId: BINDING.operation,
        system: 'UCUM', query: 'mg/dL', limit: 2,
    };
    await service.execute(Object.freeze(Object.create(null)), input);
    await assert.rejects(service.execute(Object.freeze(Object.create(null)), input),
        (error: unknown) => error instanceof AipTerminologySearchV1Error && error.code === 'reference_invalid');
    assert.deepEqual(audit.map((record) => [record.outcome, record.denialCode]),
        [['allowed', null], ['denied', 'reference_invalid']]);
});

test('un rejection del catalogo non puo scegliere la denial taxonomy pubblica', async () => {
    const service = createAipTerminologySearchServiceV1({
        now: () => 1_000, nextReceiptRef: () => 'receipt.synthetic.rejection', current: () => CURRENT,
        ...createPermitPorts(),
        searchCatalog: () => Promise.reject(new AipTerminologySearchV1Error('timeout')),
        writeAudit: async () => undefined,
    });
    await assert.rejects(service.execute(Object.freeze(Object.create(null)), {
        schemaVersion: 'mediflow.terminology.search.input.v1', operationId: BINDING.operation,
        system: 'LOINC', query: 'sodio', limit: 2,
    }), (error: unknown) => error instanceof AipTerminologySearchV1Error && error.code === 'catalog_invalid');
});

test('timeout e dispose cancellano il lavoro pendente e non consentono riuso', async () => {
    let timeoutAborted = false;
    const timeoutService = createAipTerminologySearchServiceV1({
        now: () => 1_000, nextReceiptRef: () => 'receipt.synthetic.timeout', current: () => CURRENT,
        ...createPermitPorts(),
        searchCatalog: (_request: unknown, signal: AbortSignal) => new Promise<never>(() => {
            signal.addEventListener('abort', () => { timeoutAborted = true; }, { once: true });
        }),
        writeAudit: async () => undefined,
    });
    const input = {
        schemaVersion: 'mediflow.terminology.search.input.v1', operationId: BINDING.operation,
        system: 'LOINC', query: 'sodio', limit: 2,
    };
    const timeoutPermit = Object.freeze(Object.create(null));
    await assert.rejects(timeoutService.execute(timeoutPermit, input),
        (error: unknown) => error instanceof AipTerminologySearchV1Error && error.code === 'timeout');
    assert.equal(timeoutAborted, true);
    await assert.rejects(timeoutService.execute(timeoutPermit, input),
        (error: unknown) => error instanceof AipTerminologySearchV1Error && error.code === 'authorization_denied');

    let release!: (value: unknown[]) => void;
    const pending = new Promise<unknown[]>((resolve) => { release = resolve; });
    const disposedService = createAipTerminologySearchServiceV1({
        now: () => 1_000, nextReceiptRef: () => 'receipt.synthetic.dispose', current: () => CURRENT,
        ...createPermitPorts(), searchCatalog: () => pending, writeAudit: async () => undefined,
    });
    const executing = disposedService.execute(Object.freeze(Object.create(null)), input);
    disposedService.dispose();
    release([]);
    await assert.rejects(executing,
        (error: unknown) => error instanceof AipTerminologySearchV1Error && error.code === 'disposed');
    await assert.rejects(disposedService.execute(Object.freeze(Object.create(null)), input),
        (error: unknown) => error instanceof AipTerminologySearchV1Error && error.code === 'disposed');
});

test('nega la pubblicazione dopo una callback sincrona oltre il budget senza claim di preemption', async () => {
    const audits: Array<Record<string, unknown>> = [];
    const service = createAipTerminologySearchServiceV1({
        now: () => 1_000, nextReceiptRef: () => 'receipt.synthetic.sync-timeout', current: () => CURRENT,
        ...createPermitPorts(),
        searchCatalog: () => {
            const startedAt = performance.now();
            while (performance.now() - startedAt < 320) { /* bounded synthetic stall */ }
            return [];
        },
        writeAudit: async (record: unknown) => { audits.push(record as Record<string, unknown>); },
    });

    await assert.rejects(service.execute(Object.freeze(Object.create(null)), {
        schemaVersion: 'mediflow.terminology.search.input.v1', operationId: BINDING.operation,
        system: 'LOINC', query: 'sodio', limit: 2,
    }), (error: unknown) => error instanceof AipTerminologySearchV1Error && error.code === 'timeout');
    assert.deepEqual(audits.map((record) => [record.outcome, record.denialCode]), [['denied', 'timeout']]);
    assert.equal(AIP_TERMINOLOGY_SEARCH_CONTRACT_V1.limitPolicy.timeoutMode,
        'cooperative_pending_promise_and_post_callback_fence');
});

test('una revoca broker durante la lettura nega la pubblicazione del risultato', async () => {
    const refs = ['agent.synthetic.revoke', 'lease.synthetic.revoke'];
    const broker = createAipOwnerBrokerV1({
        now: () => 1_000, nextRef: () => refs.shift(), hashRef: () => DIGEST, writeAudit: async () => undefined,
    });
    const owner = broker.issueOwner(BINDING);
    const permit = await broker.authorize(broker.issueLease(owner), CURRENT, CLAIM);
    let release!: (value: unknown[]) => void;
    const pending = new Promise<unknown[]>((resolve) => { release = resolve; });
    let serviceAudits = 0;
    const service = createAipTerminologySearchServiceV1({
        now: () => 1_001, nextReceiptRef: () => 'receipt.synthetic.revoke', current: () => CURRENT,
        ...brokerPermitPorts(broker), searchCatalog: () => pending,
        writeAudit: async () => { serviceAudits += 1; },
    });
    const executing = service.execute(permit, {
        schemaVersion: 'mediflow.terminology.search.input.v1', operationId: BINDING.operation,
        system: 'UCUM', query: 'mg/dL', limit: 2,
    });
    broker.revokeOwner(owner);
    release([{
        system: 'UCUM', code: 'mg/dL', display: 'milligram per deciliter', displayIt: 'mg/dL',
        defaultUnit: undefined, version: '2.1', source: 'local-pilot-catalog',
    }]);
    await assert.rejects(executing,
        (error: unknown) => error instanceof AipTerminologySearchV1Error && error.code === 'authorization_denied');
    assert.equal(serviceAudits, 2);
});

test('rivalida la revoca dopo audit sospeso e registra un denial terminale PHI-safe', async () => {
    const refs = ['agent.synthetic.audit-revoke', 'lease.synthetic.audit-revoke'];
    const broker = createAipOwnerBrokerV1({
        now: () => 1_000, nextRef: () => refs.shift(), hashRef: () => DIGEST, writeAudit: async () => undefined,
    });
    const owner = broker.issueOwner(BINDING);
    const permit = await broker.authorize(broker.issueLease(owner), CURRENT, CLAIM);
    const audits: Array<Record<string, unknown>> = [];
    let auditStarted!: () => void;
    let releaseAudit!: () => void;
    const started = new Promise<void>((resolve) => { auditStarted = resolve; });
    const blocked = new Promise<void>((resolve) => { releaseAudit = resolve; });
    const service = createAipTerminologySearchServiceV1({
        now: () => 1_001, nextReceiptRef: () => 'receipt.synthetic.audit-revoke', current: () => CURRENT,
        ...brokerPermitPorts(broker), searchCatalog: () => [],
        writeAudit: (record: unknown) => {
            const typed = record as Record<string, unknown>;
            audits.push(typed);
            if (typed.outcome === 'allowed') { auditStarted(); return blocked; }
            return Promise.resolve();
        },
    });
    const executing = service.execute(permit, {
        schemaVersion: 'mediflow.terminology.search.input.v1', operationId: BINDING.operation,
        system: 'LOINC', query: 'sodio', limit: 2,
    });
    await started;
    broker.revokeOwner(owner);
    releaseAudit();

    await assert.rejects(executing,
        (error: unknown) => error instanceof AipTerminologySearchV1Error && error.code === 'authorization_denied');
    assert.deepEqual(audits.map((record) => [record.outcome, record.denialCode]),
        [['allowed', null], ['denied', 'authorization_denied']]);
    assert.doesNotMatch(JSON.stringify(audits[1]), /sodio|items|query/ui);
});

test('una cancellazione sincrona nella porta audit nega la pubblicazione e chiude con denial', async () => {
    const audits: Array<Record<string, unknown>> = [];
    const ports = createPermitPorts();
    const service = createAipTerminologySearchServiceV1({
        now: () => 1_000, nextReceiptRef: () => 'receipt.synthetic.audit-cancel', current: () => CURRENT,
        ...ports, searchCatalog: () => [],
        writeAudit: (record: unknown) => {
            const typed = record as Record<string, unknown>;
            audits.push(typed);
            if (typed.outcome === 'allowed') service.cancel();
        },
    });

    await assert.rejects(service.execute(Object.freeze(Object.create(null)), {
        schemaVersion: 'mediflow.terminology.search.input.v1', operationId: BINDING.operation,
        system: 'UCUM', query: 'mg/dL', limit: 2,
    }), (error: unknown) => error instanceof AipTerminologySearchV1Error && error.code === 'cancelled');
    assert.deepEqual(audits.map((record) => [record.outcome, record.denialCode]),
        [['allowed', null], ['denied', 'cancelled']]);
    assert.doesNotMatch(JSON.stringify(audits[1]), /mg\/dL|items|query/ui);
});

test('nega Proxy e accessor dal catalogo senza invocare trap o consumare output parziale', async () => {
    let reads = 0;
    const item = {
        system: 'UCUM', code: 'mg/dL', display: 'milligram per deciliter', displayIt: 'mg/dL',
        defaultUnit: undefined, version: '2.1', source: 'local-pilot-catalog',
    };
    const accessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperties(accessor, {
        ...Object.getOwnPropertyDescriptors(item),
        display: { enumerable: true, get: () => { reads += 1; return item.display; } },
    });
    const proxyItem = new Proxy(item, {
        get() { reads += 1; throw new Error('must not read'); },
        ownKeys() { reads += 1; throw new Error('must not enumerate'); },
    });
    const proxyArray = new Proxy([item], {
        get() { reads += 1; throw new Error('must not read'); },
        ownKeys() { reads += 1; throw new Error('must not enumerate'); },
    });
    for (const output of [[accessor], [proxyItem], proxyArray, [item, item, item]]) {
        const service = createAipTerminologySearchServiceV1({
            now: () => 1_000, nextReceiptRef: () => 'receipt.synthetic.output', current: () => CURRENT,
            ...createPermitPorts(), searchCatalog: () => output, writeAudit: async () => undefined,
        });
        await assert.rejects(service.execute(Object.freeze(Object.create(null)), {
            schemaVersion: 'mediflow.terminology.search.input.v1', operationId: BINDING.operation,
            system: 'UCUM', query: 'mg/dL', limit: 2,
        }), (error: unknown) => error instanceof AipTerminologySearchV1Error && error.code === 'catalog_invalid');
    }
    assert.equal(reads, 0);
});

test('normalizza deterministicamente la query e pubblica un output profondamente immutabile', async () => {
    const receiptRefs = ['receipt.synthetic.deterministic1', 'receipt.synthetic.deterministic2'];
    const service = createLocalAipTerminologySearchServiceV1({
        now: () => 1_000, nextReceiptRef: () => receiptRefs.shift(), current: () => CURRENT,
        ...createPermitPorts(), writeAudit: async () => undefined,
    });
    const search = (query: string) => service.execute(Object.freeze(Object.create(null)), {
        schemaVersion: 'mediflow.terminology.search.input.v1', operationId: BINDING.operation,
        system: 'LOINC', query, limit: 3,
    });
    const first = await search('  pressione   arteriosa  ');
    const second = await search('pressione arteriosa');
    assert.equal(JSON.stringify(first.items), JSON.stringify(second.items));
    assert.deepEqual(Array.from(first.items, (entry) => entry.code), ['8480-6', '8462-4']);
    for (const value of [AIP_TERMINOLOGY_SEARCH_CONTRACT_V1.limitPolicy, first, first.items,
        first.items[0], first.receipt]) {
        assert.equal(Object.isFrozen(value), true);
        assert.equal(Object.getPrototypeOf(value), null);
    }
});

test('audit hostile o fallito nega senza leggere thenable e senza receipt osservabile', async () => {
    let reads = 0;
    for (const writeAudit of [
        () => Object.defineProperty({}, 'then', { get: () => { reads += 1; return undefined; } }),
        () => Promise.reject(new Error('sensitive audit detail')),
    ]) {
        const service = createAipTerminologySearchServiceV1({
            now: () => 1_000, nextReceiptRef: () => 'receipt.synthetic.audit', current: () => CURRENT,
            ...createPermitPorts(), searchCatalog: () => [], writeAudit,
        });
        await assert.rejects(service.execute(Object.freeze(Object.create(null)), {
            schemaVersion: 'mediflow.terminology.search.input.v1', operationId: BINDING.operation,
            system: 'LOINC', query: 'sodio', limit: 2,
        }), (error: unknown) => error instanceof AipTerminologySearchV1Error
            && error.code === 'audit_failed' && !error.message.includes('sensitive'));
    }
    assert.equal(reads, 0);
});
