/* @Codex — host-only orchestration, fixed corpus and actual binding. */
import 'server-only';
import { randomUUID } from 'node:crypto';
import type { WebSessionProjection } from '../security/web-auth-lifecycle-owner-adapter';
import { bindChatGptSyntheticSynthesis } from '../ai-providers/fabric/chatgpt-synthetic-synthesis-binding';
import type { QualifiedExecutionHost } from '../chatgpt-execution/execution-host';
import type { ProductExecutionPlatform } from '../chatgpt-execution/execution-platform';
import { createExecutionLogin, readExecutionLimits } from '../chatgpt-execution/execution-login';
import { ExecutionError, type SynthesisCatalog, type SynthesisRequest, type SynthesisResult, type ExecutionTransport } from '../chatgpt-execution/execution-contract';
import { createProductConsent } from './product-consent';
import { emptyReceipt, parseProductRequest, ProductError, type ConsentRequest, type ProductCode, type ProductOperation,
    type ProductRequest, type ProductResponse, type ProductSnapshot, type ProductState, type ProductReceipt, type ProductLimits } from './product-contract';

const errorCode = (error: unknown): ProductCode => error instanceof ProductError || error instanceof ExecutionError ? error.code : 'upstream_error';
async function bounded<T>(work: () => Promise<T>, milliseconds: number): Promise<T | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([Promise.resolve().then(work), new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), milliseconds); })]); }
    catch { return undefined; }
    finally { clearTimeout(timer); }
}

export function createProductService(options: {
    session: WebSessionProjection; platform: ProductExecutionPlatform; isCurrent(): boolean;
}) {
    const { session, platform, isCurrent } = options;
    const consent = createProductConsent(session, isCurrent);
    let qualification = platform.snapshot();
    let context: string = randomUUID();
    let epoch = 0;
    let disposed = false;
    let state: ProductState = qualification.state === 'qualified' ? 'needs_consent' : 'held';
    let notice: ProductCode | null = null;
    let host: QualifiedExecutionHost | undefined;
    let login: ReturnType<typeof createExecutionLogin> | undefined;
    let binding: ReturnType<typeof bindChatGptSyntheticSynthesis> | undefined;
    let catalog: SynthesisCatalog | null = null;
    let result: SynthesisResult | null = null;
    let plan: 'plus' | 'pro' | null = null;
    let limits: ProductLimits | null = null;
    let receipt = emptyReceipt();
    let controller = new AbortController();
    let busy = false;
    let pendingCreation = 0;
    let attemptDeadline = 0, attemptExpiresAt = 0;
    let disclosureBound = false;
    let draining = 0;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    let watcher: ReturnType<typeof setInterval> | undefined;
    let unsubscribe = () => {};
    const publications = new WeakMap<ProductResponse, number>();
    const preparedPublications = new WeakSet<ProductResponse>();
    if (!platform.prepare && qualification.state === 'qualified') {
        consent.bind(context, qualification.revision, session.expiresAt - Date.now()); disclosureBound = true;
    }
    const attemptRemaining = () => Math.max(0, Math.min(attemptDeadline - performance.now(), attemptExpiresAt - Date.now(), session.expiresAt - Date.now()));
    function prepareGuard(expectedEpoch?: number) {
        current();
        if (controller.signal.aborted || expectedEpoch !== undefined && epoch !== expectedEpoch) throw new ProductError('revoked');
        if (attemptRemaining() <= 0) throw new ProductError('consent_stale');
    }
    async function closePlatform(ownedContext: string) {
        if (!platform.close || platform.preparation?.().state === 'not_prepared') return;
        draining++;
        updateReceipt({ egressWithdrawalRequested: true, cleanup: 'unconfirmed' }, ownedContext);
        try {
            await platform.close();
            const closed = platform.preparation?.().state === 'closed';
            updateReceipt({ cleanup: closed ? 'confirmed' : 'unconfirmed',
                ...(closed ? { leaderExit: 'confirmed', ownedGroupCessation: 'confirmed' } as const : {}) }, ownedContext);
        } catch { updateReceipt({ cleanup: 'unconfirmed' }, ownedContext); }
        finally { draining--; }
    }
    function localQualified() {
        const current = platform.snapshot();
        return current.state === 'qualified' && current.revision === qualification.revision && current.platform === qualification.platform;
    }
    function current() {
        if (disposed || Date.now() >= session.expiresAt || !isCurrent()) throw new ProductError('session_expired');
    }
    function guard(expectedEpoch?: number) {
        current();
        if (expectedEpoch !== undefined && epoch !== expectedEpoch) throw new ProductError('revoked');
        if (!localQualified()) throw new ProductError('unqualified_boundary');
        consent.assert(context, qualification.revision);
        if (controller.signal.aborted) throw new ProductError('revoked');
    }
    function updateReceipt(patch: Partial<ProductReceipt>, ownedContext = context) {
        if (ownedContext === context) receipt = Object.freeze({ ...receipt, ...patch });
    }
    function observe(owned: QualifiedExecutionHost, ownedContext = context) {
        const observation = owned.transport.drainObservation?.();
        updateReceipt({
            ...(observation ? { egressWithdrawalRequested: receipt.egressWithdrawalRequested || observation.closing,
                leaderExit: observation.leaderExited ? 'confirmed' : observation.closing ? 'unconfirmed' : 'not_observed',
                ownedGroupCessation: observation.ownedGroupCeased === true ? 'confirmed' : observation.ownedGroupCeased === false ? 'unconfirmed' : 'not_observed' } as const : {}),
            cleanup: owned.cleanupComplete() ? 'confirmed' : receipt.egressWithdrawalRequested ? 'unconfirmed' : 'not_observed',
        }, ownedContext);
    }
    async function closeOwned(owned: QualifiedExecutionHost, ownedContext: string) {
        draining++;
        updateReceipt({ egressWithdrawalRequested: true }, ownedContext);
        try {
            await bounded(() => owned.close(), 2000);
            observe(owned, ownedContext);
            if (!owned.cleanupComplete()) updateReceipt({ cleanup: 'unconfirmed' }, ownedContext);
        } finally { draining--; }
    }
    /** Invalidation is synchronous. Cleanup promises never grant authority back. */
    function withdraw(code: ProductCode, next: ProductState = 'error', deferCleanup = false): () => void {
        epoch++; state = next; notice = code; busy = false;
        clearTimeout(expiry); clearInterval(watcher); expiry = undefined; watcher = undefined;
        catalog = null; result = null; limits = null; plan = null;
        updateReceipt({ localAuthorityWithdrawn: true });
        // Abort active generation while the owner is still current. The binding
        // independently decides whether an interrupt RPC remains authorized.
        controller.abort();
        consent.reset(); disclosureBound = false; login?.dispose(); login = undefined;
        unsubscribe(); unsubscribe = () => {};
        const oldBinding = binding; binding = undefined;
        const owned = host; host = undefined;
        const ownedContext = context;
        let started = false;
        const cleanup = () => {
            if (started) return; started = true;
            if (oldBinding) { void oldBinding.cancel().catch(() => {}); oldBinding.dispose(); }
            if (owned) void closeOwned(owned, ownedContext);
            if (platform.close) void closePlatform(ownedContext);
        };
        if (!deferCleanup) cleanup();
        return cleanup;
    }
    function enforceLocalState() {
        current();
        if (platform.prepare && !controller.signal.aborted && attemptDeadline) {
            try { prepareGuard(); if (state !== 'preparing' && !localQualified()) throw new ProductError('unqualified_boundary'); }
            catch (error) { withdraw(errorCode(error)); }
        }
        if (!consent.expiresAt()) return;
        try { guard(); }
        catch (error) { withdraw(errorCode(error)); }
    }
    function snapshot(): ProductResponse {
        enforceLocalState();
        if (host) observe(host);
        // Legacy server-only adapters still bind their disclosure before grant.
        if (!platform.prepare && !disclosureBound && !pendingCreation && !draining && !host && receipt.cleanup !== 'unconfirmed') {
            qualification = platform.snapshot();
            if (qualification.state === 'qualified') { consent.bind(context, qualification.revision, session.expiresAt - Date.now()); disclosureBound = true; }
        }
        const value: ProductSnapshot = Object.freeze({ schema: 'mediflow.chatgpt-product.v1', state, notice,
            preparation: platform.preparation?.() ?? Object.freeze({ state: 'not_prepared', expiresAt: null }),
            contextRevision: context, qualification: platform.snapshot(), disclosure: consent.disclosure(),
            authenticatedProcess: plan ? 'dedicated_execution' : 'none', accountControlAdmitsExecution: false, plan,
            consentExpiresAt: consent.expiresAt(), loginExpiresAt: ['starting', 'awaiting_login', 'verifying'].includes(state) ? consent.expiresAt() : null,
            catalog, limits, result, receipt, clinicalAdmission: 'held', manualGenerationOnly: true });
        const response = Object.freeze({ snapshot: value }); publications.set(response, epoch); return response;
    }
    function wrap(owned: QualifiedExecutionHost, ownedContext: string): QualifiedExecutionHost {
        const transport = Object.freeze<ExecutionTransport>({
            initialized: () => owned.transport.initialized(),
            ...(owned.transport.takeInitializationObservation ? { takeInitializationObservation: () => owned.transport.takeInitializationObservation!() } : {}),
            subscribe: (notify, fail) => owned.transport.subscribe(notify, fail),
            close: () => owned.transport.close(),
            ...(owned.transport.drainObservation ? { drainObservation: () => owned.transport.drainObservation!() } : {}),
            async request(method, params) {
            if (method === 'turn/interrupt') updateReceipt({ interruption: 'attempted' }, ownedContext);
            const value = await owned.transport.request(method, params);
            if (method === 'turn/interrupt') updateReceipt({ interruption: 'acknowledged' }, ownedContext);
            return value;
        } });
        // No owner re-entry here: service.isCurrent invokes this within an owner
        // binding. Owner/current consent checks surround each product operation.
        return Object.freeze({ ...owned, transport, boundaryQualified: () => !disposed && !controller.signal.aborted
            && context === ownedContext && consent.remainingMs() > 0 && localQualified() && owned.boundaryQualified() });
    }
    function watchHost(owned: QualifiedExecutionHost) {
        unsubscribe = owned.transport.subscribe((method, raw) => {
            if (controller.signal.aborted || disposed) return;
            // Login notifications do not prove account identity. After handoff ANY
            // account change withdraws product admission rather than switching it.
            if (method === 'account/updated' && plan !== null) { withdraw('revoked'); return; }
            if (method === 'account/rateLimits/updated' && plan !== null) {
                try {
                    const data = raw as { rateLimits?: { limitId?: unknown; primary?: { usedPercent?: unknown }; secondary?: { usedPercent?: unknown }; rateLimitReachedType?: unknown; spendControlReached?: unknown } };
                    const changed = data?.rateLimits;
                    if (!changed) throw new ExecutionError('limits_unavailable');
                    if (changed.limitId != null && changed.limitId !== 'codex') return;
                    if (changed.rateLimitReachedType != null || changed.spendControlReached === true) throw new ExecutionError('quota_exhausted');
                    for (const window of [changed.primary, changed.secondary]) {
                        if (window == null) continue;
                        if (typeof window.usedPercent !== 'number' || !Number.isFinite(window.usedPercent) || window.usedPercent < 0) throw new ExecutionError('limits_unavailable');
                        if (window.usedPercent >= 100) throw new ExecutionError('quota_exhausted');
                    }
                } catch (error) { withdraw(errorCode(error)); }
            }
        }, code => withdraw(code));
    }
    async function createOwned(expectedEpoch: number) {
        const ownedContext = context;
        pendingCreation++;
        let owned: QualifiedExecutionHost | undefined;
        try {
            owned = await platform.create(controller.signal);
            guard(expectedEpoch);
            if (!owned.boundaryQualified()) throw new ProductError('unqualified_boundary');
            host = wrap(owned, ownedContext); watchHost(host); return host;
        } catch (error) {
            // A late-created host is drained by its original closure, never by a
            // new request or a mutable global pointer to another child.
            if (owned) await closeOwned(owned, ownedContext);
            throw error;
        } finally { pendingCreation--; }
    }
    async function stop(operation: 'cancel' | 'login/cancel' | 'logout'): Promise<ProductResponse> {
        current();
        const owned = host, ownedContext = context;
        // Narrow cleanup RPCs are initiated under the *current* owner before
        // withdrawing. No late startup/login continuation may publish afterward.
        let remote: Promise<boolean> | undefined;
        if (owned && !controller.signal.aborted && localQualified()) {
            if (operation === 'logout' && state !== 'completed') {
                remote = (async () => {
                    if (!isCurrent()) return false;
                    await owned.transport.request('account/logout');
                    if (!isCurrent()) return false;
                    const read = await owned.transport.request('account/read', { refreshToken: false });
                    if (!isCurrent()) return false;
                    return !!read && typeof read === 'object' && (read as { account?: unknown }).account === null;
                })();
                void remote.catch(() => {});
            } else if (operation === 'login/cancel' && login) {
                const pending = login.cancel(); void pending.catch(() => {});
            }
        }
        // Product authority is withdrawn synchronously; idle logout/readback
        // gets at most 500ms before local drain. An active turn can close the
        // transport sooner, in which case remote logout remains unconfirmed.
        // Keep a drain reservation so no concurrent consent starts another host.
        draining++;
        const cleanup = withdraw('canceled', 'canceled', true);
        try {
            if (remote) updateReceipt({ remoteLogout: await bounded(() => remote!, 500) === true ? 'confirmed' : 'unconfirmed' }, ownedContext);
        } finally { cleanup(); draining--; }
        if (owned) { await bounded(() => owned.close(), 2000); observe(owned, ownedContext); }
        if (receipt.remoteLogout === 'unconfirmed') notice = 'logout_unconfirmed';
        current(); return snapshot();
    }
    async function prepare(signal?: AbortSignal): Promise<ProductResponse> {
        if (!platform.prepare || !['held', 'canceled', 'error'].includes(state) || host || receipt.cleanup === 'unconfirmed') throw new ProductError('invalid_state');
        context = randomUUID(); controller = new AbortController(); receipt = emptyReceipt();
        consent.reset(); disclosureBound = false;
        const expectedEpoch = ++epoch, local = controller;
        const preparationDeadline = performance.now() + 120_000, preparationExpiresAt = Date.now() + 120_000;
        attemptDeadline = performance.now() + 300_000;
        attemptExpiresAt = Math.min(Date.now() + 300_000, session.expiresAt);
        state = 'preparing'; notice = null; busy = true;
        const abort = () => { if (epoch === expectedEpoch) withdraw('canceled', 'canceled'); };
        signal?.addEventListener('abort', abort, { once: true });
        let reject!: (error: ProductError) => void;
        const interrupted = new Promise<never>((_, failure) => { reject = failure; });
        void interrupted.catch(() => {});
        const stopWaiting = () => reject(new ProductError(notice ?? 'revoked'));
        local.signal.addEventListener('abort', stopWaiting, { once: true });
        const timeout = setTimeout(() => { if (epoch === expectedEpoch) withdraw('timeout'); }, 120_000);
        expiry = setTimeout(() => withdraw('consent_stale'), attemptRemaining()); expiry.unref?.();
        watcher = setInterval(() => {
            if (disposed || local.signal.aborted) return;
            try { prepareGuard(); if (state !== 'preparing' && !localQualified()) throw new ProductError('unqualified_boundary'); }
            catch (error) { withdraw(errorCode(error)); }
        }, 50); watcher.unref?.();
        try {
            if (signal?.aborted) abort();
            prepareGuard(expectedEpoch);
            // The original promise stays observed after timeout/cancel. The
            // platform owns and drains a late handle; no continuation can publish.
            const work = (async () => {
                await platform.prepare!(local.signal, attemptRemaining());
                prepareGuard(expectedEpoch);
                // A blocked event loop can delay the timeout callback. Completion
                // itself must check both clocks before granting a ready state.
                if (performance.now() >= preparationDeadline || Date.now() >= preparationExpiresAt) throw new ProductError('timeout');
                qualification = platform.snapshot();
                if (qualification.state !== 'qualified') throw new ProductError('unqualified_boundary');
                consent.bind(context, qualification.revision, attemptRemaining()); disclosureBound = true;
                state = 'needs_consent';
                const response = snapshot(); preparedPublications.add(response); return response;
            })();
            return await Promise.race([work, interrupted]);
        } catch (error) {
            if (epoch === expectedEpoch) withdraw(errorCode(error));
            throw error;
        } finally {
            clearTimeout(timeout); signal?.removeEventListener('abort', abort);
            local.signal.removeEventListener('abort', stopWaiting);
            if (epoch === expectedEpoch) busy = false;
        }
    }
    async function execute(operation: ProductOperation, raw: ProductRequest, signal?: AbortSignal): Promise<ProductResponse> {
        current();
        const request = parseProductRequest(operation, raw);
        if (operation === 'status') return snapshot();
        if (operation === 'cancel' || operation === 'login/cancel' || operation === 'logout') return stop(operation);
        if (busy || pendingCreation || draining) throw new ProductError('busy');
        if (operation === 'prepare') return prepare(signal);
        if (operation === 'consent') {
            if (!['held', 'needs_consent', 'canceled', 'error'].includes(state) || host || receipt.cleanup === 'unconfirmed') throw new ProductError('invalid_state');
            qualification = platform.snapshot();
            if (qualification.state !== 'qualified') throw new ProductError('unqualified_boundary');
            // Do not rotate the disclosure until its exact revision was checked.
            if (platform.prepare) { prepareGuard(); if (state !== 'needs_consent') throw new ProductError('invalid_state'); }
            else { controller = new AbortController(); receipt = emptyReceipt(); }
            consent.grant(request as ConsentRequest, context, qualification.revision);
            epoch++; state = 'consented'; notice = null;
            clearTimeout(expiry); clearInterval(watcher);
            expiry = setTimeout(() => withdraw('consent_stale'), consent.remainingMs()); expiry.unref?.();
            watcher = setInterval(() => {
                if (disposed || controller.signal.aborted) return;
                try { guard(); } catch (error) { withdraw(errorCode(error)); }
            }, 50); watcher.unref?.();
            return snapshot();
        }
        guard();
        if (operation === 'login/start' && state !== 'consented') throw new ProductError('invalid_state');
        if (operation === 'login/complete' && !['awaiting_login', 'verifying'].includes(state)) throw new ProductError('invalid_state');
        if (['read', 'models'].includes(operation) && !['connected', 'ready'].includes(state)) throw new ProductError('invalid_state');
        if (operation === 'generate' && state !== 'ready') throw new ProductError('invalid_state');
        busy = true; const expectedEpoch = ++epoch;
        const localSignal = controller.signal;
        const abort = () => { if (epoch === expectedEpoch) withdraw('canceled', 'canceled'); };
        signal?.addEventListener('abort', abort, { once: true });
        let reject!: (error: ProductError) => void;
        const interrupted = new Promise<never>((_, failure) => { reject = failure; });
        void interrupted.catch(() => {});
        const stopWaiting = () => reject(new ProductError(notice ?? 'revoked'));
        localSignal.addEventListener('abort', stopWaiting, { once: true });
        const deadline = setTimeout(() => { if (epoch === expectedEpoch) withdraw('timeout'); }, 120_000);
        try {
            if (signal?.aborted) abort();
            guard(expectedEpoch);
            const work = (async (): Promise<ProductResponse> => {
                if (operation === 'login/start') {
                    state = 'starting';
                    const owned = await createOwned(expectedEpoch); guard(expectedEpoch);
                    login = createExecutionLogin(owned.transport, () => guard(), next => { state = next; }, error => withdraw(errorCode(error)), owned.cwd);
                    const challenge = await login.start(); guard(expectedEpoch);
                    if (state === 'starting') state = 'awaiting_login';
                    const response = Object.freeze({ ...snapshot(), login: challenge }); publications.set(response, epoch); return response;
                }
                if (operation === 'login/complete') {
                    // Login guard must be owner/consent-bound, not the epoch of a
                    // previous HTTP request. See the stable guard passed below.
                    plan = await login!.complete(); guard(expectedEpoch);
                    binding = bindChatGptSyntheticSynthesis(session, host!);
                    state = 'connected'; return snapshot();
                }
                if (operation === 'read') {
                    catalog = null; result = null; limits = null;
                    plan = await login!.read(); guard(expectedEpoch);
                    limits = readExecutionLimits(await host!.transport.request('account/rateLimits/read')); guard(expectedEpoch);
                    state = 'connected'; return snapshot();
                }
                if (operation === 'models') {
                    catalog = null; result = null; limits = null;
                    plan = await login!.read(); guard(expectedEpoch);
                    limits = readExecutionLimits(await host!.transport.request('account/rateLimits/read')); guard(expectedEpoch);
                    let observed: SynthesisCatalog | undefined;
                    await binding!.catalog(value => { observed = value; return new Response(null); }); guard(expectedEpoch);
                    if (!observed) throw new ExecutionError('protocol_error');
                    catalog = observed; state = 'ready'; return snapshot();
                }
                if (operation === 'generate') {
                    state = 'generating'; result = null;
                    plan = await login!.read(); guard(expectedEpoch);
                    let observed: SynthesisResult | undefined;
                    await binding!.generate(request as SynthesisRequest, value => { observed = value; return new Response(null); }, localSignal);
                    guard(expectedEpoch);
                    if (!observed) throw new ExecutionError('invalid_output');
                    result = observed; catalog = null; state = 'completed'; observe(host!); return snapshot();
                }
                throw new ProductError('invalid_request');
            })();
            const response = await Promise.race([work, interrupted]); guard(expectedEpoch); return response;
        } catch (error) {
            const code = errorCode(error);
            if (code !== 'login_pending' && epoch === expectedEpoch) withdraw(code);
            throw new ProductError(code);
        } finally {
            clearTimeout(deadline); signal?.removeEventListener('abort', abort); localSignal.removeEventListener('abort', stopWaiting);
            if (epoch === expectedEpoch) busy = false;
        }
    }
    return Object.freeze({ execute, snapshot,
        /** Negative-only publication rollback, invoked outside the owner binding. */
        abandon(response: ProductResponse) {
            if (preparedPublications.has(response) && publications.get(response) === epoch
                && response.snapshot.contextRevision === context) withdraw('revoked');
        },
        // This runs *inside* withCurrentResourceBinding; never call owner here.
        isCurrent(response: ProductResponse) {
            return !disposed && Date.now() < session.expiresAt && publications.get(response) === epoch
                && response.snapshot.contextRevision === context
                && response.snapshot.qualification.revision === platform.snapshot().revision
                && response.snapshot.qualification.state === platform.snapshot().state
                && (!platform.prepare || controller.signal.aborted || !attemptDeadline || attemptRemaining() > 0)
                && (consent.expiresAt() === null || consent.remainingMs() > 0);
        },
        dispose() { if (!disposed) { disposed = true; withdraw('session_expired'); } },
    });
}
export type ProductService = ReturnType<typeof createProductService>;
