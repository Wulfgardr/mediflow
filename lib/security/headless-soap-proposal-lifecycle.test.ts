/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    CLINICIAN_SOAP_DRAFT_SCHEMA, CLINICIAN_SOAP_OPERATION_ID, validateClinicianSoapWriteDraft,
} from '../headless/clinician-soap-write-contract.ts';
import {
    createHeadlessSoapProposalLifecycleOwner, HeadlessSoapProposalLifecycleError,
} from './headless-soap-proposal-lifecycle.ts';

const hasCode = (code: string) => (error: unknown) => error instanceof HeadlessSoapProposalLifecycleError && error.code === code;

function h1Snapshot() {
    const draft = Object.assign(Object.create(null), {
        schema: CLINICIAN_SOAP_DRAFT_SCHEMA, operationId: CLINICIAN_SOAP_OPERATION_ID,
        subjective: 'Sintomo sintetico', objective: 'Esame sintetico', assessment: 'Valutazione sintetica', plan: 'Piano sintetico',
    });
    const result = validateClinicianSoapWriteDraft(draft);
    assert.equal(result.status, 'accepted');
    if (result.status !== 'accepted') throw new Error('synthetic H1 snapshot denied');
    return result;
}

function fixture() {
    const lease = Object.freeze(Object.create(null)); const session = Object.freeze(Object.create(null));
    const scope = Object.freeze(Object.create(null)); const leaseRegistration = Object.freeze(Object.create(null));
    const selectionRegistration = Object.freeze(Object.create(null)); let now = 10_000, leaseCurrent = true, terminationCalls = 0, sessionReads = 0; const selectionCurrent = true;
    let leaseDispose: (() => void) | null = null, selectionDispose: (() => void) | null = null;
    let leaseCheckGate: Promise<void> | null = null, releaseLeaseCheck: (() => void) | null = null;
    const tasks: Array<{ delay: number; callback: () => void; cancelled: boolean }> = [];
    const sources = {
        leaseLifecycle: {
            async withCurrentLease(candidate: unknown, operation: (value: unknown) => void) { if (!leaseCurrent || candidate !== lease) return false;
                if (leaseCheckGate) await leaseCheckGate; operation(lease); return leaseCurrent; },
            registerDependent(candidate: unknown, dispose: () => void) { if (!leaseCurrent || candidate !== lease) return null; leaseDispose = dispose; return leaseRegistration; },
            confirmDependent(candidate: unknown, registration: unknown) { return leaseCurrent && candidate === lease && registration === leaseRegistration; },
            unregisterDependent(candidate: unknown, registration: unknown) { if (candidate !== lease || registration !== leaseRegistration || !leaseDispose) return false; leaseDispose = null; return true; },
            async withCurrentDependent(candidate: unknown, registration: unknown, operation: () => void) { if (!leaseCurrent || candidate !== lease || registration !== leaseRegistration) return false; operation(); return leaseCurrent; },
            async withCurrentProposalBudget(candidate: unknown, registration: unknown, operation: () => void) { if (!leaseCurrent || candidate !== lease || registration !== leaseRegistration) return false; operation(); return leaseCurrent; },
        },
        leaseService: { terminate(candidate: unknown) { terminationCalls += 1; if (!leaseCurrent || candidate !== lease) return false; leaseCurrent = false; const dispose = leaseDispose; leaseDispose = null; dispose?.(); return true; } },
        selectionLifecycle: {
            withCurrentSelection(candidate: unknown, operation: (value: unknown) => void) { if (!selectionCurrent || candidate !== session) return false; operation(scope); return selectionCurrent; },
            registerDependent(candidate: unknown, dispose: () => void) { if (!selectionCurrent || candidate !== scope) return null; selectionDispose = dispose; return selectionRegistration; },
            confirmDependent(candidate: unknown, registration: unknown) { return selectionCurrent && candidate === scope && registration === selectionRegistration; },
            unregisterDependent(candidate: unknown, registration: unknown) { if (candidate !== scope || registration !== selectionRegistration || !selectionDispose) return false; selectionDispose = null; return true; },
            withCurrentDependent(candidate: unknown, registration: unknown, operation: () => void) { if (!selectionCurrent || candidate !== scope || registration !== selectionRegistration) return false; operation(); return selectionCurrent; },
        },
        async readCurrentSelectionSession() { sessionReads += 1; return session; },
        clock: () => now,
        scheduler: (delay: number, callback: () => void) => { const task = { delay, callback, cancelled: false }; tasks.push(task); return () => { task.cancelled = true; }; },
    };
    return { lease, sources, tasks, setNow(value: number) { now = value; }, blockLeaseCheck() { leaseCheckGate = new Promise<void>((resolve) => { releaseLeaseCheck = resolve; }); },
        releaseLeaseCheck() { const release = releaseLeaseCheck; leaseCheckGate = null; releaseLeaseCheck = null; release?.(); },
        retireLeaseAttachment() { leaseDispose?.(); }, terminationCalls() { return terminationCalls; }, sessionReads() { return sessionReads; } };
}

test('inspect revalidates an H1 snapshot and publishes only an opaque current-stage ref', async () => {
    const current = fixture(); const owner = createHeadlessSoapProposalLifecycleOwner(current.sources);
    const inspectRef = await owner.service.inspect(current.lease, h1Snapshot());
    assert.equal(Object.getPrototypeOf(inspectRef), null); assert.equal(Object.isFrozen(inspectRef), true); assert.deepEqual(Reflect.ownKeys(inspectRef), []);
    assert.equal(current.tasks.length, 1); assert.equal(current.tasks[0]?.delay, 120_000);
});

test('only one concurrent inspect can claim the same lease before its first await settles', async () => {
    const current = fixture(); current.blockLeaseCheck(); const service = createHeadlessSoapProposalLifecycleOwner(current.sources).service;
    const first = service.inspect(current.lease, h1Snapshot()); await Promise.resolve();
    const second = service.inspect(current.lease, h1Snapshot()); await Promise.resolve(); current.releaseLeaseCheck();
    const results = await Promise.allSettled([first, second]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const denial = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    assert.ok(denial); assert.equal(hasCode('lease_unavailable')(denial.reason), true); assert.equal(current.tasks.length, 1);
});

test('inspect reads the current selection session after lease verification and uses the synchronous selection port', async () => {
    const current = fixture(); const service = createHeadlessSoapProposalLifecycleOwner(current.sources).service;
    const inspectRef = await service.inspect(current.lease, h1Snapshot());
    assert.equal(current.sessionReads(), 1); assert.deepEqual(Reflect.ownKeys(inspectRef), []);
});

test('the final publication fence rejects a record retired by its exact lease attachment', async () => {
    const current = fixture(); const original = current.sources.leaseLifecycle.confirmDependent; let confirmations = 0;
    current.sources.leaseLifecycle.confirmDependent = (candidate: unknown, registration: unknown) => {
        confirmations += 1; if (confirmations === 2) { current.retireLeaseAttachment(); return true; }
        return original(candidate, registration);
    };
    const service = createHeadlessSoapProposalLifecycleOwner(current.sources).service;
    await assert.rejects(service.inspect(current.lease, h1Snapshot()), hasCode('lifecycle_unavailable'));
    assert.equal(current.terminationCalls(), 1); assert.equal(current.tasks[0]?.cancelled, true);
});

test('inspect rechecks its deadline after scheduling and final attachment fences', async () => {
    const current = fixture(); current.sources.scheduler = (_delay: number, _callback: () => void) => {
        current.setNow(130_000); return () => undefined;
    };
    const service = createHeadlessSoapProposalLifecycleOwner(current.sources).service;
    await assert.rejects(service.inspect(current.lease, h1Snapshot()), hasCode('proposal_expired'));
    assert.equal(current.terminationCalls(), 1);
});

test('a deadline crossed inside a transition preserves the time denial over the retired lease', async () => {
    const current = fixture(); const service = createHeadlessSoapProposalLifecycleOwner(current.sources).service;
    const inspectRef = await service.inspect(current.lease, h1Snapshot()); let samples = 0;
    current.sources.clock = () => { samples += 1; return samples === 1 ? 10_001 : 130_000; };
    await assert.rejects(service.preview(inspectRef), hasCode('proposal_expired'));
    assert.equal(current.terminationCalls(), 1); assert.equal(service.wipe(inspectRef), false);
});

test('transition contains hostile final fences and preserves the boundary that denied', async () => {
    const leaseFailure = fixture(); const leaseService = createHeadlessSoapProposalLifecycleOwner(leaseFailure.sources).service;
    const leaseInspect = await leaseService.inspect(leaseFailure.lease, h1Snapshot());
    leaseFailure.sources.leaseLifecycle.confirmDependent = () => { throw new Error('synthetic lease fence'); };
    await assert.rejects(leaseService.preview(leaseInspect), hasCode('lifecycle_unavailable'));
    assert.equal(leaseFailure.terminationCalls(), 1);

    const selectionFailure = fixture(); const selectionService = createHeadlessSoapProposalLifecycleOwner(selectionFailure.sources).service;
    const selectionInspect = await selectionService.inspect(selectionFailure.lease, h1Snapshot());
    selectionFailure.sources.selectionLifecycle.confirmDependent = () => { throw new Error('synthetic selection fence'); };
    await assert.rejects(selectionService.preview(selectionInspect), hasCode('selection_unavailable'));
    assert.equal(selectionFailure.terminationCalls(), 1);
});

test('transition final identity fence rejects retirement during its last confirmation', async () => {
    const current = fixture(); const service = createHeadlessSoapProposalLifecycleOwner(current.sources).service;
    const inspectRef = await service.inspect(current.lease, h1Snapshot());
    const confirm = current.sources.selectionLifecycle.confirmDependent; let calls = 0;
    current.sources.selectionLifecycle.confirmDependent = (candidate: unknown, registration: unknown) => {
        calls += 1; if (calls === 2) { current.retireLeaseAttachment(); return true; } return confirm(candidate, registration);
    };
    await assert.rejects(service.preview(inspectRef), hasCode('lifecycle_unavailable'));
    assert.equal(current.terminationCalls(), 1); assert.equal(service.wipe(inspectRef), false);
});

test('an invalid attach clock after lease verification terminates the lease and makes retry impossible', async () => {
    const current = fixture(); const service = createHeadlessSoapProposalLifecycleOwner(current.sources).service; current.setNow(Number.NaN);
    await assert.rejects(service.inspect(current.lease, h1Snapshot()), hasCode('lifecycle_unavailable'));
    assert.equal(current.terminationCalls(), 1); current.setNow(10_000);
    await assert.rejects(service.inspect(current.lease, h1Snapshot()), hasCode('lease_unavailable'));
    assert.equal(current.tasks.length, 0);
});

test('every post-verification denial retires the lease before a retry can enter', async () => {
    type Sources = ReturnType<typeof fixture>['sources'];
    const cases: Array<readonly [string, string, (sources: Sources) => void]> = [
        ['session read', 'selection_unavailable', (sources) => { sources.readCurrentSelectionSession = async () => null; }],
        ['selection claim', 'selection_unavailable', (sources) => { sources.selectionLifecycle.withCurrentSelection = () => false; }],
        ['selection attach', 'selection_unavailable', (sources) => { sources.selectionLifecycle.registerDependent = () => null; }],
        ['lease attach', 'lease_unavailable', (sources) => { sources.leaseLifecycle.registerDependent = () => null; }],
        ['lease dependent', 'lease_unavailable', (sources) => { sources.leaseLifecycle.withCurrentDependent = async () => false; }],
        ['selection dependent', 'selection_unavailable', (sources) => { sources.selectionLifecycle.withCurrentDependent = () => false; }],
        ['scheduler', 'lifecycle_unavailable', (sources) => { sources.scheduler = () => { throw new Error('synthetic scheduler denial'); }; }],
        ['lease final fence', 'lifecycle_unavailable', (sources) => { let calls = 0; const confirm = sources.leaseLifecycle.confirmDependent;
            sources.leaseLifecycle.confirmDependent = (candidate, registration) => { calls += 1; return calls === 2 ? false : confirm(candidate, registration); }; }],
        ['selection final fence', 'lifecycle_unavailable', (sources) => { let calls = 0; const confirm = sources.selectionLifecycle.confirmDependent;
            sources.selectionLifecycle.confirmDependent = (candidate, registration) => { calls += 1; return calls === 2 ? false : confirm(candidate, registration); }; }],
    ];
    for (const [label, code, deny] of cases) {
        const current = fixture(); deny(current.sources); const service = createHeadlessSoapProposalLifecycleOwner(current.sources).service;
        await assert.rejects(service.inspect(current.lease, h1Snapshot()), hasCode(code), label);
        assert.equal(current.terminationCalls(), 1, label);
        await assert.rejects(service.inspect(current.lease, h1Snapshot()), hasCode('lease_unavailable'), `${label} retry`);
        assert.equal(current.terminationCalls(), 1, `${label} retry termination count`);
    }
});

test('inspect preserves the exact boundary lost during its two cross-fences', async () => {
    const selectionLost = fixture(); selectionLost.sources.selectionLifecycle.confirmDependent = () => false;
    const selectionService = createHeadlessSoapProposalLifecycleOwner(selectionLost.sources).service;
    await assert.rejects(selectionService.inspect(selectionLost.lease, h1Snapshot()), hasCode('selection_unavailable'));
    assert.equal(selectionLost.terminationCalls(), 1);

    const leaseLost = fixture(); leaseLost.sources.leaseLifecycle.confirmDependent = () => false;
    const leaseService = createHeadlessSoapProposalLifecycleOwner(leaseLost.sources).service;
    await assert.rejects(leaseService.inspect(leaseLost.lease, h1Snapshot()), hasCode('lease_unavailable'));
    assert.equal(leaseLost.terminationCalls(), 1);
});

test('inspect denies a forged nested digest without executing accessors or touching upstream lifecycle ports', async () => {
    const current = fixture(); const genuine = h1Snapshot(); let reads = 0;
    const digest = Object.create(null); Object.defineProperties(digest, {
        codec: { enumerable: true, value: genuine.digest.codec },
        sha256: { enumerable: true, get() { reads += 1; throw new Error('hostile digest'); } },
    }); Object.freeze(digest);
    const forged = Object.create(null); for (const key of Reflect.ownKeys(genuine)) forged[key] = key === 'digest' ? digest : genuine[key as keyof typeof genuine]; Object.freeze(forged);
    await assert.rejects(createHeadlessSoapProposalLifecycleOwner(current.sources).service.inspect(current.lease, forged), hasCode('snapshot_unavailable'));
    assert.equal(reads, 0); assert.equal(current.tasks.length, 0);
});

test('inspect rejects digest bytes with extra own identity and normalized values that drift from their digest', async () => {
    const genuine = h1Snapshot(); const bytes = [...genuine.digest.sha256.bytes];
    Object.defineProperty(bytes, Symbol('extra'), { enumerable: true, value: 1 }); Object.freeze(bytes);
    const sha256 = Object.freeze(Object.assign(Object.create(null), { bytes, hex: genuine.digest.sha256.hex }));
    const digest = Object.freeze(Object.assign(Object.create(null), { codec: genuine.digest.codec, sha256 }));
    const extraBytes = Object.create(null); for (const key of Reflect.ownKeys(genuine)) extraBytes[key] = key === 'digest' ? digest : genuine[key as keyof typeof genuine]; Object.freeze(extraBytes);
    const first = fixture(); await assert.rejects(createHeadlessSoapProposalLifecycleOwner(first.sources).service.inspect(first.lease, extraBytes), hasCode('snapshot_unavailable'));
    assert.equal(first.terminationCalls(), 0);

    const drifted = Object.create(null); for (const key of Reflect.ownKeys(genuine)) drifted[key] = key === 'subjective' ? 'Drift sintetico' : genuine[key as keyof typeof genuine]; Object.freeze(drifted);
    const second = fixture(); await assert.rejects(createHeadlessSoapProposalLifecycleOwner(second.sources).service.inspect(second.lease, drifted), hasCode('snapshot_unavailable'));
    assert.equal(second.terminationCalls(), 0);
});

test('inspect rejects authentic digest bytes rebuilt with a foreign array prototype', async () => {
    const genuine = h1Snapshot(); const bytes = [...genuine.digest.sha256.bytes]; Object.setPrototypeOf(bytes, null); Object.freeze(bytes);
    const sha256 = Object.freeze(Object.assign(Object.create(null), { bytes, hex: genuine.digest.sha256.hex }));
    const digest = Object.freeze(Object.assign(Object.create(null), { codec: genuine.digest.codec, sha256 }));
    const forged = Object.create(null); for (const key of Reflect.ownKeys(genuine)) forged[key] = key === 'digest' ? digest : genuine[key as keyof typeof genuine]; Object.freeze(forged);
    const current = fixture(); await assert.rejects(createHeadlessSoapProposalLifecycleOwner(current.sources).service.inspect(current.lease, forged), hasCode('snapshot_unavailable'));
    assert.equal(current.terminationCalls(), 0);
});

test('moves irreversibly through distinct opaque refs while an authentic prior ref can only wipe', async () => {
    const current = fixture(); const service = createHeadlessSoapProposalLifecycleOwner(current.sources).service;
    const inspectRef = await service.inspect(current.lease, h1Snapshot()); const previewRef = await service.preview(inspectRef);
    await assert.rejects(service.preview(inspectRef), hasCode('stage_unavailable'));
    const proposalRef = await service.proposal(previewRef);
    assert.notEqual(inspectRef, previewRef); assert.notEqual(previewRef, proposalRef); assert.notEqual(inspectRef, proposalRef);
    for (const ref of [previewRef, proposalRef]) { assert.equal(Object.getPrototypeOf(ref), null); assert.equal(Object.isFrozen(ref), true); assert.deepEqual(Reflect.ownKeys(ref), []); }
    await assert.rejects(service.proposal(previewRef), hasCode('stage_unavailable'));
    assert.equal(service.wipe(inspectRef), true); assert.equal(service.wipe(proposalRef), false); assert.equal(current.tasks[0]?.cancelled, true);
});

test('budget exhaustion terminalizes a current preview but stays inert after a concurrent winner', async () => {
    const exhausted = fixture(); const exhaustedService = createHeadlessSoapProposalLifecycleOwner(exhausted.sources).service;
    const exhaustedInspect = await exhaustedService.inspect(exhausted.lease, h1Snapshot()); const exhaustedPreview = await exhaustedService.preview(exhaustedInspect);
    exhausted.sources.leaseLifecycle.withCurrentProposalBudget = async () => {
        throw Object.assign(new Error('synthetic exhausted budget'), { code: 'proposal_budget_exhausted' });
    };
    await assert.rejects(exhaustedService.proposal(exhaustedPreview), hasCode('proposal_budget_exhausted'));
    assert.equal(exhaustedService.wipe(exhaustedPreview), false); assert.equal(exhausted.terminationCalls(), 1);

    const raced = fixture(); const racedService = createHeadlessSoapProposalLifecycleOwner(raced.sources).service;
    const racedInspect = await racedService.inspect(raced.lease, h1Snapshot()); const racedPreview = await racedService.preview(racedInspect);
    let calls = 0, releaseFirst: () => void = () => undefined, publishWinner: () => void = () => undefined;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = () => resolve(); });
    const winnerPublished = new Promise<void>((resolve) => { publishWinner = () => resolve(); });
    raced.sources.leaseLifecycle.withCurrentProposalBudget = async (_candidate: unknown, _registration: unknown, operation: () => void) => {
        calls += 1;
        if (calls === 1) { await firstGate; operation(); publishWinner(); return true; }
        releaseFirst(); await winnerPublished; throw Object.assign(new Error('synthetic raced budget'), { code: 'proposal_budget_exhausted' });
    };
    const results = await Promise.allSettled([racedService.proposal(racedPreview), racedService.proposal(racedPreview)]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const loser = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    assert.ok(loser); assert.equal(hasCode('stage_unavailable')(loser.reason), true);
    const winner = results.find((result) => result.status === 'fulfilled');
    if (!winner || winner.status !== 'fulfilled') assert.fail('expected one proposal winner');
    assert.equal(racedService.wipe(winner.value), true);
});

test('an early scheduler callback reschedules only the residual and a deadline callback wipes without renewal', async () => {
    const current = fixture(); const service = createHeadlessSoapProposalLifecycleOwner(current.sources).service;
    const inspectRef = await service.inspect(current.lease, h1Snapshot());
    current.setNow(50_000); current.tasks[0]?.callback();
    assert.equal(current.tasks.length, 2); assert.equal(current.tasks[1]?.delay, 80_000);
    const previewRef = await service.preview(inspectRef); const proposalRef = await service.proposal(previewRef);
    assert.equal(current.tasks.length, 2);
    current.setNow(130_000); current.tasks[1]?.callback();
    assert.equal(service.wipe(proposalRef), false);
});

test('keeps the 120000ms deadline half-open and terminalizes a clock rollback', async () => {
    const boundary = fixture(); const boundaryService = createHeadlessSoapProposalLifecycleOwner(boundary.sources).service;
    const inspectRef = await boundaryService.inspect(boundary.lease, h1Snapshot()); boundary.setNow(129_999);
    const previewRef = await boundaryService.preview(inspectRef); boundary.setNow(130_000);
    await assert.rejects(boundaryService.proposal(previewRef), hasCode('proposal_expired'));
    assert.equal(boundaryService.wipe(previewRef), false);

    const rollback = fixture(); const rollbackService = createHeadlessSoapProposalLifecycleOwner(rollback.sources).service;
    const rollbackInspect = await rollbackService.inspect(rollback.lease, h1Snapshot()); rollback.setNow(10_001);
    const rollbackPreview = await rollbackService.preview(rollbackInspect); rollback.setNow(10_000);
    await assert.rejects(rollbackService.proposal(rollbackPreview), hasCode('lifecycle_unavailable'));
    assert.equal(rollbackService.wipe(rollbackPreview), false);
});

test('foreign and restarted refs stay inert without damaging the authentic owner', async () => {
    const current = fixture(); const first = createHeadlessSoapProposalLifecycleOwner(current.sources).service;
    const inspectRef = await first.inspect(current.lease, h1Snapshot()); const foreign = Object.freeze(Object.create(null));
    await assert.rejects(first.preview(foreign), hasCode('stage_unavailable')); assert.equal(first.wipe(foreign), false);
    const restarted = createHeadlessSoapProposalLifecycleOwner(current.sources).service;
    await assert.rejects(restarted.preview(inspectRef), hasCode('stage_unavailable')); assert.equal(restarted.wipe(inspectRef), false);
    const previewRef = await first.preview(inspectRef); assert.equal(first.wipe(previewRef), true);
});

test('core remains memory-only and uses only injected clock and scheduler boundaries', () => {
    const source = readFileSync(new URL('./headless-soap-proposal-lifecycle.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /(?:node:fs|localStorage|sessionStorage|setTimeout|setInterval|Date\.now|JSON\.(?:parse|stringify)|(?:from|import)\s+['"][^'"]*(?:db|database))/u);
    assert.doesNotMatch(source, /export\s+(?:const|function)\s+(?:serialize|persist|readSnapshot|snapshot)\b/iu);
});
