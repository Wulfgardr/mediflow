import { observationSchema, deny, LocalOperationError, planDigest, planSchema, receiptSchema, territorialAllows,
    type LocalOperationPlan, type LocalOperationRecord, type LocalOperationPorts, type LiveContext,
    type LocalOperationReceipt, type AdapterContext, type Observation, type ArchiveAuthority } from './contract.ts';

export type LocalCapability = Readonly<{ kind: 'local_operation' }>;
type Binding = { operationId: string; digest: string; context: string; territoryRevision: number;
    expiresAt: number; generation: number; origin: ArchiveAuthority };
type DispatchPermit = Readonly<{ marker: LocalOperationRecord; approvalExpiresAt: number }>;
type PhaseContext = (...args: [phase: 'prepare' | 'reconcile'] | [phase: 'act', permit: DispatchPermit]) => AdapterContext;
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
    const tracked = new Map<string, ArchiveAuthority>();
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
    function assertIdentity(current: LocalOperationRecord, plan: Readonly<LocalOperationPlan>) {
        if (['operationId', 'patientId', 'practiceId', 'procedureId', 'territory', 'installationId', 'archiveGeneration']
            .some(key => current[key as keyof LocalOperationRecord] !== plan[key as keyof LocalOperationPlan])) deny();
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
        for (const [operationId, origin] of tracked) {
            try { origin.assertCurrent(); } catch { tracked.delete(operationId); continue; }
            const current = record(operationId);
            if (current.state === 'confirmed') continue;
            const context = ports.currentContext();
            if (!context || context.installationId !== current.installationId || context.archiveGeneration !== current.archiveGeneration) continue;
            const enabled = territorialAllows(ports.currentTerritory(), current.territory);
            const state = current.effectPossible ? 'uncertain' : enabled ? 'suspended' : 'suspended_pack_disabled';
            save(current, { state, resumeState: current.state, reason: enabled ? 'context_changed' : 'pack_disabled' }, () => { origin.assertCurrent(); assertArchive(current); });
        }
    }
    const unsubscribe = ports.subscribeInvalidation(invalidate);
    function issue(operationId: string): LocalCapability {
        const origin = ports.captureArchive(); origin.assertCurrent();
        const current = record(operationId), plan = currentPlan(operationId), context = localContext(plan);
        assertIdentity(current, plan);
        const territory = ports.currentTerritory();
        if (current.state === 'confirmed' || current.planDigest !== planDigest(plan)
            || !territorialAllows(territory, current.territory)) deny();
        const capability = Object.freeze({ kind: 'local_operation' as const });
        capabilities.set(capability, { operationId, digest: current.planDigest, context: contextKey(context),
            territoryRevision: territory.revision!, expiresAt: Math.min(context.expiresAt, ports.now() + 300_000), generation, origin });
        tracked.set(operationId, origin);
        return capability;
    }
    function check(capability: LocalCapability) {
        const binding = capabilities.get(capability);
        if (closed || !binding || binding.generation !== generation || binding.expiresAt <= ports.now()) deny();
        try { binding.origin.assertCurrent(); } catch { revoke(); deny(); }
        const current = record(binding.operationId), plan = currentPlan(binding.operationId), context = localContext(plan);
        assertIdentity(current, plan);
        const territory = ports.currentTerritory();
        if (current.state === 'confirmed' || current.planDigest !== binding.digest || planDigest(plan) !== binding.digest
            || contextKey(context) !== binding.context || !territorialAllows(territory, current.territory)
            || territory.revision !== binding.territoryRevision) deny();
        return { binding, current, plan, context };
    }
    function observation(raw: Observation, plan: Readonly<LocalOperationPlan>, requireContent: boolean) {
        const parsed = observationSchema.safeParse(raw);
        if (!parsed.success || parsed.data.census !== 'complete') deny();
        const value = parsed.data, context = localContext(plan);
        const { census: _census, unclassifiedFields: _unknown, planDigest: _digest, humanRevision, ...identity } = value;
        if (Object.entries(identity).some(([key, value]) => plan[key as keyof LocalOperationPlan] !== value)
            || humanRevision !== context.humanRevision
            || value.unclassifiedFields.length || (requireContent && value.planDigest !== planDigest(plan))) deny();
    }
    async function run<T>(capability: LocalCapability, action: (observe: AdapterContext, phaseContext: PhaseContext) => Promise<T>): Promise<T> {
        const { binding, plan, current } = check(capability);
        if (running.size) throw new LocalOperationError('conflict');
        const controller = new AbortController(); running.set(binding.operationId, controller);
        let actDispatched = false;
        const assertCurrent = () => { if (controller.signal.aborted || running.get(binding.operationId) !== controller) deny(); check(capability); };
        function context(phase: 'observe' | 'prepare' | 'act' | 'reconcile', permit?: DispatchPermit): AdapterContext {
            const marker = permit?.marker ?? current;
            assertCurrent();
            function assertDispatch() {
                const live = check(capability).current;
                if (!permit || permit.approvalExpiresAt <= ports.now() || live.state !== 'attempt_started' || !live.effectPossible
                    || live.attempt !== marker.attempt || live.revision !== marker.revision) deny();
            }
            if (phase === 'act') assertDispatch();
            return Object.freeze({ operationId: binding.operationId, attempt: marker.attempt, revision: marker.revision,
                signal: controller.signal, assertCurrent,
                snapshot(raw) {
                    assertCurrent();
                    const live = check(capability);
                    observation(raw, live.plan, true);
                    if (permit) assertDispatch();
                    return freeze({ plan: live.plan, context: { ...live.context }, lease: {
                        generation, territoryRevision: ports.currentTerritory().revision!, expiresAt: binding.expiresAt,
                        approvalExpiresAt: permit?.approvalExpiresAt ?? null, operationId: live.current.operationId,
                        attempt: live.current.attempt, revision: live.current.revision, state: live.current.state, effectPossible: live.current.effectPossible,
                    } });
                },
                authorizeRequest(destination) {
                    assertCurrent();
                    if ((destination.purpose !== phase && destination.purpose !== 'observe')
                        || !plan.destinations.some(allowed => JSON.stringify(allowed) === JSON.stringify(destination))) deny();
                    if (destination.purpose === 'act') {
                        assertDispatch();
                        if (actDispatched) deny();
                        actDispatched = true;
                    }
                },
            });
        }
        try { return await action(context('observe'), context); }
        catch (error) {
            // An old promise owns no authority over the replacement connection, even with the same operation ID.
            let sameOrigin = true;
            try { binding.origin.assertCurrent(); } catch { sameOrigin = false; revoke(); }
            if (sameOrigin && binding.generation === generation) {
                const current = record(binding.operationId);
                if (!['confirmed', 'confirmed_pending_recording'].includes(current.state)) {
                    approvals.delete(binding.operationId);
                    const enabled = territorialAllows(ports.currentTerritory(), current.territory);
                    save(current, { state: current.effectPossible ? 'uncertain' : enabled ? 'suspended' : 'suspended_pack_disabled',
                        resumeState: current.state, reason: enabled ? 'adapter_rejected' : 'pack_disabled' },
                    () => { binding.origin.assertCurrent(); assertArchive(current); });
                }
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
            const origin = ports.captureArchive(); origin.assertCurrent();
            const plan = currentPlan(operationId); localContext(plan);
            if (!territorialAllows(ports.currentTerritory(), plan.territory)) deny();
            const value: LocalOperationRecord = { operationId, patientId: plan.patientId, practiceId: plan.practiceId,
                installationId: plan.installationId, archiveGeneration: plan.archiveGeneration, procedureId: plan.procedureId,
                territory: plan.territory, revision: 1, planDigest: planDigest(plan), state: 'prepared', resumeState: null,
                reason: null, suspensionNote: null, attempt: 0, effectPossible: false, receipt: null, updatedAt: ports.now() };
            ports.journal.create(value, () => { origin.assertCurrent(); localContext(plan); }); tracked.set(operationId, origin);
            return issue(operationId);
        },
        acquire: issue,
        inspect(operationId: string) { const current = record(operationId); assertArchive(current); return current; },
        async prepare(capability: LocalCapability) {
            const { current, plan } = check(capability);
            if (current.effectPossible) throw new LocalOperationError('reconciliation_required');
            return run(capability, async (ctx, phaseContext) => {
                observation(await ports.adapter.observe(ctx), plan, false); ctx.assertCurrent();
                await ports.adapter.prepare(phaseContext('prepare'), plan); ctx.assertCurrent();
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
            return run(capability, async (ctx, phaseContext) => {
                observation(await ports.adapter.observe(ctx), plan, true); ctx.assertCurrent();
                if (approvals.get(current.operationId) !== approval || approval.expiresAt <= ports.now()) deny();
                const marker = save(current, { state: 'attempt_started', attempt: current.attempt + 1, effectPossible: true }, () => check(capability));
                approvals.delete(current.operationId);
                const permit = Object.freeze({ marker, approvalExpiresAt: approval.expiresAt });
                const receipt = await ports.adapter.act(phaseContext('act', permit), plan);
                return acceptReceipt(capability, ctx, receipt);
            });
        },
        async reconcile(capability: LocalCapability) {
            const { current, plan } = check(capability);
            if (!current.effectPossible) throw new LocalOperationError('reconciliation_required');
            if (current.state === 'confirmed_pending_recording' && current.receipt) return registerOutcome(capability, current.receipt);
            return run(capability, async (ctx, phaseContext) => {
                observation(await ports.adapter.observe(ctx), plan, true); ctx.assertCurrent();
                return acceptReceipt(capability, ctx, await ports.adapter.reconcile(phaseContext('reconcile'), plan));
            });
        },
        suspend(capability: LocalCapability, reason: 'choice' | 'human_intervention' = 'choice', note: string | null = null) {
            const { current, binding } = check(capability);
            revoke();
            return save(record(current.operationId), { state: current.effectPossible ? 'uncertain' : 'suspended',
                reason, suspensionNote: note, resumeState: current.state }, () => { binding.origin.assertCurrent(); assertArchive(current); });
        },
        resume(operationId: string) {
            const current = record(operationId); const capability = issue(operationId);
            if (current.state === 'attempt_started' || current.state === 'authorized' || current.state === 'suspended_pack_disabled' || current.state === 'suspended') {
                save(current, { state: current.effectPossible ? 'uncertain' : 'prepared', reason: 'recovery', resumeState: null }, () => check(capability));
            }
            return capability;
        },
        revise(operationId: string) {
            const origin = ports.captureArchive(); origin.assertCurrent();
            const current = record(operationId), plan = currentPlan(operationId); localContext(plan);
            assertIdentity(current, plan);
            if (current.effectPossible || running.has(operationId) || !territorialAllows(ports.currentTerritory(), current.territory)) deny();
            revoke();
            save(current, { planDigest: planDigest(plan), state: 'prepared', reason: null, resumeState: null }, () => { origin.assertCurrent(); localContext(plan); assertIdentity(current, currentPlan(operationId)); }, 'territorial');
            return issue(operationId);
        },
        async reviewManualContent(operationId: string) {
            const origin = ports.captureArchive(); origin.assertCurrent();
            const current = record(operationId), plan = currentPlan(operationId), context = localContext(plan);
            assertIdentity(current, plan);
            if (!current.effectPossible || current.receipt || running.has(operationId)
                || (plan.finalAct !== 'manual' && ports.adapter.protectedFinalAct)
                || !territorialAllows(ports.currentTerritory(), current.territory)) deny();
            const digest = planDigest(plan), contextBinding = contextKey(context), revision = ports.currentTerritory().revision;
            if (!await ports.confirmExactPlan(plan)) deny();
            origin.assertCurrent(); assertIdentity(current, currentPlan(operationId));
            if (contextKey(localContext(plan)) !== contextBinding || planDigest(currentPlan(operationId)) !== digest
                || ports.currentTerritory().revision !== revision || !territorialAllows(ports.currentTerritory(), current.territory)
                || record(operationId).revision !== current.revision) deny();
            revoke();
            save(current, { planDigest: digest, state: 'uncertain', reason: 'recovery' }, () => { origin.assertCurrent(); localContext(plan); assertIdentity(current, currentPlan(operationId)); }, 'territorial');
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
