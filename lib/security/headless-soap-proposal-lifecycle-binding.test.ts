/* @Codex */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    CLINICIAN_SOAP_DRAFT_SCHEMA, CLINICIAN_SOAP_OPERATION_ID, validateClinicianSoapWriteDraft,
} from '../headless/clinician-soap-write-contract.ts';
import {
    createHeadlessSoapProposalLifecycleOwner, type HeadlessSoapProposalBindingV1,
} from './headless-soap-proposal-lifecycle.ts';

const opaque = () => Object.freeze(Object.create(null)) as Readonly<Record<never, never>>;

function acceptedSnapshot() {
    const result = validateClinicianSoapWriteDraft(Object.assign(Object.create(null), {
        schema: CLINICIAN_SOAP_DRAFT_SCHEMA,
        operationId: CLINICIAN_SOAP_OPERATION_ID,
        subjective: 'Sintomo sintetico',
        objective: 'Esame sintetico',
        assessment: 'Valutazione sintetica',
        plan: 'Piano sintetico',
    }));
    assert.equal(result.status, 'accepted');
    if (result.status !== 'accepted') throw new Error('synthetic H1 snapshot denied');
    return result;
}

function fixture() {
    const lease = opaque(), session = opaque(), scope = opaque(), leaseRegistration = opaque(), selectionRegistration = opaque();
    const activeRole = Object.freeze(Object.assign(Object.create(null), {
        grantIdentity: opaque(), principalRef: 'synthetic-user', authenticationGeneration: opaque(), actorRef: 'synthetic-user',
        attestationRef: `hsar_${'a'.repeat(32)}`, attestationVersion: 1, revocationGeneration: 0,
        policyVersion: 'clinician_confirmed_single_use.v1',
    })) as HeadlessSoapProposalBindingV1['activeRole'];
    const childLease = Object.freeze(Object.assign(Object.create(null), {
        parent: Object.freeze(Object.assign(Object.create(null), {
            identity: opaque(), contractVersion: 1, generation: 1, revocationGeneration: 0,
        })),
        child: Object.freeze(Object.assign(Object.create(null), {
            identity: opaque(), contractVersion: 1, generation: 1, revocationGeneration: 0,
            proposalBudget: 0, expiresAt: 310_000,
        })),
        lease: Object.freeze(Object.assign(Object.create(null), {
            identity: lease, contractVersion: 1, generation: 1, revocationGeneration: 0,
        })),
    })) as HeadlessSoapProposalBindingV1['childLease'];
    const selection = Object.freeze(Object.assign(Object.create(null), {
        scopeIdentity: scope, sessionRef: `ssr_${'b'.repeat(32)}`, patientRef: `ptr_${'c'.repeat(32)}`,
        ambulatoryRef: `abr_${'d'.repeat(32)}`, leaseRef: `lsr_${'e'.repeat(32)}`,
        selectionEpoch: 4, expiresAt: 310_000,
    })) as HeadlessSoapProposalBindingV1['selection'];
    let leaseDispose: (() => void) | null = null, selectionDispose: (() => void) | null = null;
    let loseLeaseFenceAfterBinding = false;
    const sources = {
        leaseLifecycle: {
            async withCurrentLease(candidate: unknown, operation: (value: unknown) => void) { if (candidate !== lease) return false; operation(lease); return true; },
            registerDependent(candidate: unknown, dispose: () => void) { if (candidate !== lease) return null; leaseDispose = dispose; return leaseRegistration; },
            confirmDependent(candidate: unknown, registration: unknown) { return candidate === lease && registration === leaseRegistration && leaseDispose !== null; },
            unregisterDependent(candidate: unknown, registration: unknown) { if (candidate !== lease || registration !== leaseRegistration || !leaseDispose) return false; leaseDispose = null; return true; },
            async withCurrentDependent(candidate: unknown, registration: unknown, operation: () => void) { if (candidate !== lease || registration !== leaseRegistration || !leaseDispose) return false; operation(); return true; },
            async withCurrentProposalBudget(candidate: unknown, registration: unknown, operation: () => void) { if (candidate !== lease || registration !== leaseRegistration || !leaseDispose) return false; operation(); return true; },
        },
        leaseBinding: {
            async withCurrentDependentBinding(candidate: unknown, registration: unknown,
                operation: (child: HeadlessSoapProposalBindingV1['childLease'],
                    role: HeadlessSoapProposalBindingV1['activeRole']) => void) {
                if (candidate !== lease || registration !== leaseRegistration || !leaseDispose) return false;
                operation(childLease, activeRole);
                if (loseLeaseFenceAfterBinding) leaseDispose = null;
                return true;
            },
        },
        leaseService: { terminate(candidate: unknown) { if (candidate !== lease) return false; leaseDispose?.(); leaseDispose = null; return true; } },
        selectionLifecycle: {
            withCurrentSelection(candidate: unknown, operation: (value: unknown) => void) { if (candidate !== session) return false; operation(scope); return true; },
            registerDependent(candidate: unknown, dispose: () => void) { if (candidate !== scope) return null; selectionDispose = dispose; return selectionRegistration; },
            confirmDependent(candidate: unknown, registration: unknown) { return candidate === scope && registration === selectionRegistration && selectionDispose !== null; },
            unregisterDependent(candidate: unknown, registration: unknown) { if (candidate !== scope || registration !== selectionRegistration || !selectionDispose) return false; selectionDispose = null; return true; },
            withCurrentDependent(candidate: unknown, registration: unknown, operation: () => void) { if (candidate !== scope || registration !== selectionRegistration || !selectionDispose) return false; operation(); return true; },
        },
        selectionBinding: {
            withCurrentDependentBinding(candidate: unknown, registration: unknown,
                operation: (binding: Readonly<{
                    selection: HeadlessSoapProposalBindingV1['selection'];
                    patientVersion: HeadlessSoapProposalBindingV1['patientVersion'];
                }>) => void) {
                if (candidate !== scope || registration !== selectionRegistration || !selectionDispose) return false;
                operation(Object.freeze(Object.assign(Object.create(null), { selection, patientVersion: 7 }))); return true;
            },
        },
        async readCurrentSelectionSession() { return session; },
        clock: () => 10_000,
        scheduler: () => () => undefined,
    };
    return {
        activeRole, childLease, lease, selection, sources,
        loseLeaseFence: () => { loseLeaseFenceAfterBinding = true; },
    };
}

async function prepared() {
    const current = fixture(), owner = createHeadlessSoapProposalLifecycleOwner(current.sources);
    const inspectRef = await owner.service.inspect(current.lease, acceptedSnapshot());
    const previewRef = await owner.service.preview(inspectRef), proposalRef = await owner.service.proposal(previewRef);
    let registration: unknown = null;
    assert.equal(await owner.lifecycleController.withCurrentProposal(proposalRef, () => {
        registration = owner.lifecycleController.registerDependent(proposalRef, () => undefined);
    }), true); assert.ok(registration);
    return { current, owner, proposalRef, registration };
}

test('emits the exact H3 binding capsule from nested H2b and selection currentness', async () => {
    const { current, owner, proposalRef, registration } = await prepared();
    let observed: unknown = null;
    assert.equal(await owner.bindingController.withCurrentDependentBinding(
        proposalRef, registration, (binding) => { observed = binding; }), true);
    const binding = observed as Record<string, unknown>;
    assert.equal(Object.getPrototypeOf(binding), null); assert.equal(Object.isFrozen(binding), true);
    assert.deepEqual(Reflect.ownKeys(binding), ['activeRole', 'childLease', 'selection', 'patientVersion', 'proposal']);
    assert.equal(binding.activeRole, current.activeRole); assert.equal(binding.childLease, current.childLease);
    assert.equal(binding.selection, current.selection); assert.equal(binding.patientVersion, 7);
    const proposal = binding.proposal as Record<string, unknown>;
    assert.equal(Object.getPrototypeOf(proposal), null); assert.equal(Object.isFrozen(proposal), true);
    assert.deepEqual(Reflect.ownKeys(proposal), ['proposalIdentity', 'revision', 'expiresAt']);
    assert.equal(proposal.proposalIdentity, proposalRef); assert.equal(proposal.revision, 1); assert.equal(proposal.expiresAt, 130_000);
});

test('burns H3 after a binding callback loses its final H2b attachment fence', async () => {
    const { current, owner, proposalRef, registration } = await prepared(); let calls = 0;
    current.loseLeaseFence();
    assert.equal(await owner.bindingController.withCurrentDependentBinding(
        proposalRef, registration, () => { calls += 1; }), false);
    assert.equal(calls, 1); assert.equal(owner.service.wipe(proposalRef), false);
    assert.equal(await owner.bindingController.withCurrentDependentBinding(
        proposalRef, registration, () => { calls += 100; }), false);
    assert.equal(calls, 1);
});

test('rejects declared async binding callbacks without invoking or retaining H3', async () => {
    const { owner, proposalRef, registration } = await prepared(); let calls = 0;
    assert.equal(await owner.bindingController.withCurrentDependentBinding(
        proposalRef, registration, async () => { calls += 1; }), false);
    assert.equal(calls, 0); assert.equal(owner.service.wipe(proposalRef), false);
});
