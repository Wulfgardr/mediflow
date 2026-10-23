import { deny, LocalOperationError, planDigest, planSchema, receiptSchema, territorialAllows,
    type LocalOperationPlan, type LocalOperationRecord, type LocalOperationPorts, type LiveContext,
    type LocalOperationReceipt, type AdapterContext, type Observation } from './contract.ts';

export type LocalCapability = Readonly<{ kind: 'local_operation' }>;
type Binding = { operationId: string; digest: string; context: string; territoryRevision: number;
    expiresAt: number; generation: number };
const contextKey = (context: LiveContext) => JSON.stringify(context);
function freeze<T>(value: T): Readonly<T> {
    if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
    return value;
}

/** Only the trusted host receives this object. MCP receives the narrower remote port, never this service. */
export function createLocalOperationService(ports: LocalOperationPorts) {
    let generation = 0, closed = false;
    const capabilities = new Map<LocalCapability, Binding>();
    const approvals = new Map<string, { binding: Binding; expiresAt: number; revision: number }>();
    const running = new Map<string, AbortController>();
    const tracked = new Set<string>();
    const record = (operationId: string) => {
        const current = ports.journal.read(operationId);
        if (!current) throw new LocalOperationError('missing');
        return current;
    };
    function save(current: LocalOperationRecord, changes: Partial<LocalOperationRecord>, guard: () => void, lane: 'core' | 'territorial' = 'core') {
        return ports.journal.save({ ...current, ...changes, revision: current.revision + 1, updatedAt: ports.now() }, current.revision, guard, lane);
    }
    function currentPlan(operationId: string): Readonly<LocalOperationPlan> {
        const plan = planSchema.parse(ports.resolvePlan(operationId));
        if (plan.operationId !== operationId || plan.adapterVersion !== ports.adapter.version) deny();
        planDigest(plan);
        return freeze(plan);
    }
    function localContext(plan: Readonly<LocalOperationPlan>) {
        const context = ports.currentContext();
        if (closed || !context || context.expiresAt <= ports.now() || context.role !== 'physician'
            || ['installationId', 'archiveGeneration', 'patientId', 'practiceId', 'operatorId', 'portalAccountId']
                .some(key => context[key as keyof LiveContext] !== plan[key as keyof LocalOperationPlan])) deny();
        return context;
    }
    function assertArchive(current: LocalOperationRecord) {
        const context = ports.currentContext();
        if (!context || context.installationId !== current.installationId || context.archiveGeneration !== current.archiveGeneration) deny();
    }
    function revoke() {
        generation++;
        capabilities.clear(); approvals.clear();
        for (const controller of running.values()) controller.abort();
        ports.adapter.stop();
    }
    function invalidate() {
        revoke();
        for (const operationId of tracked) {
            const current = record(operationId);
            if (current.state === 'confirmed') continue;
            const context = ports.currentContext();
            if (!context || context.installationId !== current.installationId || context.archiveGeneration !== current.archiveGeneration) continue;
            const enabled = territorialAllows(ports.currentTerritory(), current.territory);
            const state = current.effectPossible ? 'uncertain' : enabled ? 'suspended' : 'suspended_pack_disabled';
            save(current, { state, resumeState: current.state, reason: enabled ? 'context_changed' : 'pack_disabled' }, () => assertArchive(current));
        }
    }
    const unsubscribe = ports.subscribeInvalidation(invalidate);
    function issue(operationId: string): LocalCapability {
        const current = record(operationId), plan = currentPlan(operationId), context = localContext(plan);
        const territory = ports.currentTerritory();
        if (current.state === 'confirmed' || current.planDigest !== planDigest(plan)
            || !territorialAllows(territory, current.territory)) deny();
        const capability = Object.freeze({ kind: 'local_operation' as const });
        capabilities.set(capability, { operationId, digest: current.planDigest, context: contextKey(context),
            territoryRevision: territory.revision!, expiresAt: Math.min(context.expiresAt, ports.now() + 300_000), generation });
        tracked.add(operationId);
        return capability;
    }
    function check(capability: LocalCapability) {
        const binding = capabilities.get(capability);
        if (closed || !binding || binding.generation !== generation || binding.expiresAt <= ports.now()) deny();
        const current = record(binding.operationId), plan = currentPlan(binding.operationId), context = localContext(plan);
        const territory = ports.currentTerritory();
        if (current.state === 'confirmed' || current.planDigest !== binding.digest || planDigest(plan) !== binding.digest
            || contextKey(context) !== binding.context || !territorialAllows(territory, current.territory)
            || territory.revision !== binding.territoryRevision) deny();
        return { binding, current, plan, context };
    }
    function observation(value: Observation, plan: Readonly<LocalOperationPlan>, requireContent: boolean) {
        const context = localContext(plan);
        if (value.patientId !== plan.patientId || value.practiceId !== plan.practiceId || value.portalAccountId !== plan.portalAccountId
            || value.uiVersion !== plan.uiVersion || value.humanRevision !== context.humanRevision
            || value.unclassifiedFields.length || (requireContent && value.planDigest !== planDigest(plan))) deny();
    }
    async function run<T>(capability: LocalCapability, phase: 'prepare' | 'act' | 'reconcile', action: (ctx: AdapterContext) => Promise<T>): Promise<T> {
        const { binding, plan } = check(capability);
        if (running.size) throw new LocalOperationError('conflict');
        const controller = new AbortController(); running.set(binding.operationId, controller);
        let actDispatched = false;
        const assertCurrent = () => { if (controller.signal.aborted || running.get(binding.operationId) !== controller) deny(); check(capability); };
        const ctx: AdapterContext = Object.freeze({ operationId: binding.operationId, attempt: record(binding.operationId).attempt,
            signal: controller.signal, assertCurrent,
            authorizeRequest(destination) {
                assertCurrent();
                if ((destination.purpose !== phase && destination.purpose !== 'observe')
                    || !plan.destinations.some(allowed => JSON.stringify(allowed) === JSON.stringify(destination))) deny();
                if (destination.purpose === 'act') {
                    if (actDispatched) deny();
                    actDispatched = true;
                }
            },
        });
        try { return await action(ctx); }
        catch (error) {
            const current = record(binding.operationId);
            if (!['confirmed', 'confirmed_pending_recording'].includes(current.state) && binding.generation === generation) {
                approvals.delete(binding.operationId);
                const enabled = territorialAllows(ports.currentTerritory(), current.territory);
                save(current, { state: current.effectPossible ? 'uncertain' : enabled ? 'suspended' : 'suspended_pack_disabled',
                    resumeState: current.state, reason: enabled ? 'adapter_rejected' : 'pack_disabled' }, () => assertArchive(current));
            }
            if (error instanceof LocalOperationError) throw error;
            throw new LocalOperationError('denied');
        } finally { controller.abort(); running.delete(binding.operationId); }
    }
    function correlate(receipt: LocalOperationReceipt, current: LocalOperationRecord, plan: Readonly<LocalOperationPlan>) {
        return receipt.operationId === current.operationId && receipt.patientId === current.patientId
            && receipt.practiceId === current.practiceId && receipt.planDigest === current.planDigest
            && plan.destinations.some(destination => JSON.stringify(destination) === JSON.stringify(receipt.destination))
            && new Set(receipt.parts.map(part => part.id)).size === receipt.parts.length
            && receipt.parts.length === plan.parts.length && plan.parts.every(id => receipt.parts.some(part => part.id === id));
    }
    function registerOutcome(capability: LocalCapability, receipt: LocalOperationReceipt) {
        const { current, plan } = check(capability);
        if (!correlate(receipt, current, plan)) deny();
        if (receipt.parts.some(part => part.state !== 'confirmed')) {
            return save(current, { state: 'uncertain', effectPossible: true, receipt }, () => check(capability), 'territorial');
        }
        const pending = current.state === 'confirmed_pending_recording' ? current
            : save(current, { state: 'confirmed_pending_recording', effectPossible: true, receipt }, () => check(capability), 'territorial');
        const confirmed = save(pending, { state: 'confirmed', reason: null, resumeState: null }, () => check(capability), 'territorial');
        for (const [handle, binding] of capabilities) if (binding.operationId === current.operationId) capabilities.delete(handle);
        approvals.delete(current.operationId);
        return confirmed;
    }
    async function acceptReceipt(capability: LocalCapability, ctx: AdapterContext, raw: unknown) {
        ctx.assertCurrent();
        const parsed = receiptSchema.safeParse(raw);
        if (!parsed.success) deny();
        const { current, plan } = check(capability);
        if (!correlate(parsed.data, current, plan) || !await ports.adapter.verifyReceipt(ctx, parsed.data)) deny();
        ctx.assertCurrent();
        return registerOutcome(capability, parsed.data);
    }
    return Object.freeze({
        create(operationId: string) {
            const plan = currentPlan(operationId); localContext(plan);
            if (!territorialAllows(ports.currentTerritory(), plan.territory)) deny();
            const value: LocalOperationRecord = { operationId, patientId: plan.patientId, practiceId: plan.practiceId,
                installationId: plan.installationId, archiveGeneration: plan.archiveGeneration, procedureId: plan.procedureId,
                territory: plan.territory, revision: 1, planDigest: planDigest(plan), state: 'prepared', resumeState: null,
                reason: null, suspensionNote: null, attempt: 0, effectPossible: false, receipt: null, updatedAt: ports.now() };
            ports.journal.create(value, () => localContext(plan)); tracked.add(operationId);
            return issue(operationId);
        },
        acquire: issue,
        inspect(operationId: string) { const current = record(operationId); assertArchive(current); return current; },
        async prepare(capability: LocalCapability) {
            const { current, plan } = check(capability);
            if (current.effectPossible) throw new LocalOperationError('reconciliation_required');
            return run(capability, 'prepare', async ctx => {
                observation(await ports.adapter.observe(ctx), plan, false); ctx.assertCurrent();
                await ports.adapter.prepare(ctx, plan); ctx.assertCurrent();
                observation(await ports.adapter.observe(ctx), plan, true); ctx.assertCurrent();
                const saved = save(record(current.operationId), { state: 'saved', resumeState: null, reason: null }, () => check(capability));
                approvals.delete(current.operationId);
                if (plan.finalAct === 'manual' || !ports.adapter.protectedFinalAct) {
                    ports.adapter.stop();
                    return save(saved, { state: 'awaiting_manual_act', effectPossible: true }, () => check(capability));
                }
                return saved;
            });
        },
        async approve(capability: LocalCapability) {
            const { current, plan, binding } = check(capability);
            if (current.state !== 'saved' || current.effectPossible || running.has(current.operationId)) deny();
            const accepted = await ports.confirmExactPlan(plan);
            check(capability);
            if (!accepted || record(current.operationId).revision !== current.revision) deny();
            const approved = save(current, { state: 'authorized' }, () => check(capability));
            approvals.set(current.operationId, { binding, revision: approved.revision, expiresAt: Math.min(binding.expiresAt, ports.now() + 120_000) });
            return approved;
        },
        async execute(capability: LocalCapability) {
            const { current, plan, binding } = check(capability);
            const approval = approvals.get(current.operationId);
            if (current.state !== 'authorized' || current.effectPossible || !approval || approval.binding !== binding
                || approval.revision !== current.revision || approval.expiresAt <= ports.now() || plan.finalAct !== 'protected' || !ports.adapter.protectedFinalAct) deny();
            return run(capability, 'act', async ctx => {
                observation(await ports.adapter.observe(ctx), plan, true); ctx.assertCurrent();
                if (approvals.get(current.operationId) !== approval || approval.expiresAt <= ports.now()) deny();
                save(current, { state: 'attempt_started', attempt: current.attempt + 1, effectPossible: true }, () => check(capability));
                approvals.delete(current.operationId);
                const receipt = await ports.adapter.act({ ...ctx, attempt: current.attempt + 1 }, plan);
                return acceptReceipt(capability, ctx, receipt);
            });
        },
        async reconcile(capability: LocalCapability) {
            const { current, plan } = check(capability);
            if (!current.effectPossible) throw new LocalOperationError('reconciliation_required');
            if (current.state === 'confirmed_pending_recording' && current.receipt) return registerOutcome(capability, current.receipt);
            return run(capability, 'reconcile', async ctx => {
                observation(await ports.adapter.observe(ctx), plan, true); ctx.assertCurrent();
                return acceptReceipt(capability, ctx, await ports.adapter.reconcile(ctx, plan));
            });
        },
        suspend(capability: LocalCapability, reason: 'choice' | 'human_intervention' = 'choice', note: string | null = null) {
            const { current } = check(capability);
            revoke();
            return save(record(current.operationId), { state: current.effectPossible ? 'uncertain' : 'suspended',
                reason, suspensionNote: note, resumeState: current.state }, () => assertArchive(current));
        },
        resume(operationId: string) {
            const current = record(operationId); const capability = issue(operationId);
            if (current.state === 'attempt_started' || current.state === 'authorized' || current.state === 'suspended_pack_disabled' || current.state === 'suspended') {
                save(current, { state: current.effectPossible ? 'uncertain' : 'prepared', reason: 'recovery', resumeState: null }, () => check(capability));
            }
            return capability;
        },
        revise(operationId: string) {
            const current = record(operationId), plan = currentPlan(operationId); localContext(plan);
            if (current.effectPossible || running.has(operationId) || !territorialAllows(ports.currentTerritory(), current.territory)) deny();
            revoke();
            save(current, { planDigest: planDigest(plan), state: 'prepared', reason: null, resumeState: null }, () => localContext(plan), 'territorial');
            return issue(operationId);
        },
        async reviewManualContent(operationId: string) {
            const current = record(operationId), plan = currentPlan(operationId), context = localContext(plan);
            if (!current.effectPossible || current.receipt || running.has(operationId)
                || (plan.finalAct !== 'manual' && ports.adapter.protectedFinalAct)
                || !territorialAllows(ports.currentTerritory(), current.territory)) deny();
            const digest = planDigest(plan), contextBinding = contextKey(context), revision = ports.currentTerritory().revision;
            if (!await ports.confirmExactPlan(plan)) deny();
            if (contextKey(localContext(plan)) !== contextBinding || planDigest(currentPlan(operationId)) !== digest
                || ports.currentTerritory().revision !== revision || !territorialAllows(ports.currentTerritory(), current.territory)
                || record(operationId).revision !== current.revision) deny();
            revoke();
            save(current, { planDigest: digest, state: 'uncertain', reason: 'recovery' }, () => localContext(plan), 'territorial');
            return issue(operationId);
        },
        revoke: invalidate,
        close() { if (!closed) { revoke(); closed = true; unsubscribe(); } },
        publicStatus(capability: LocalCapability) {
            const { current } = check(capability);
            return running.has(current.operationId) ? 'local_processing' as const : 'local_result_available' as const;
        },
    });
}
