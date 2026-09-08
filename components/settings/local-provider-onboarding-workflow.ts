/* @Codex */
import { parseFunctionStatus, type FunctionStatusSnapshot } from '../../lib/function-status';
import type { LocalProviderOnboardingStatus } from '../../lib/ai-providers/fabric/local-provider-onboarding-service';

export type LocalOnboardingPhase = 'reading_configuration' | 'ready' | 'verifying'
    | 'reading_result' | 'reading_functions' | 'completed' | 'interrupted' | 'failed' | 'blocked';
export type LocalOnboardingView = Readonly<{
    phase: LocalOnboardingPhase;
    status: LocalProviderOnboardingStatus | null;
    functions: FunctionStatusSnapshot | null;
    messageCode: string;
    busy: boolean;
}>;
export const INITIAL_LOCAL_ONBOARDING_VIEW: LocalOnboardingView = Object.freeze({
    phase: 'reading_configuration', status: null, functions: null, messageCode: 'reading_configuration', busy: true,
});

// Browser waiting budgets only. These do NOT extend the canonical host's 30 s
// activation budget (or the route's 5 s body budget), and never trigger a retry.
const READ_WAIT_MS = 10_000;
const ACTIVATION_WAIT_MS = 40_000;
const endpoint = '/api/ai/local-provider/onboarding';
const functionsEndpoint = '/api/system/function-status';
const activatableStates = new Set(['missing', 'degraded', 'available_unqualified']);
const terminalStates = new Set(['revoked', 'owner_locked', 'credential_mismatch', 'corrupt']);
class WorkflowError extends Error {
    constructor(readonly code: string) { super(code); }
}

/** A display projection, never authority. Unknown/inconsistent snapshots deny actions. */
function statusProjection(value: unknown): LocalProviderOnboardingStatus {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WorkflowError('state_unavailable');
    const v = value as Partial<LocalProviderOnboardingStatus>;
    if (v.provider !== 'ollama' || v.credentialClass !== 'local_model'
        || (v.model !== null && typeof v.model !== 'string') || typeof v.state !== 'string'
        || typeof v.revision !== 'string' || !/^[a-f0-9]{64}$/.test(v.revision)
        || !Number.isSafeInteger(v.version) || v.version! < 0
        || (v.receipt !== null && (typeof v.receipt !== 'string' || !/^receipt_[a-f0-9]{32,64}$/.test(v.receipt)))
        || typeof v.canActivate !== 'boolean' || v.inference !== 'not_run' || v.qualification !== 'not_assessed')
        throw new WorkflowError('state_unavailable');
    return Object.freeze({ provider: v.provider, credentialClass: v.credentialClass, model: v.model,
        state: v.state, revision: v.revision, version: v.version!, receipt: v.receipt,
        canActivate: v.canActivate && activatableStates.has(v.state), inference: v.inference, qualification: v.qualification });
}

/**
 * Presentation-only workflow over the existing two endpoints. No job, storage,
 * polling, provider contact, credential, owner substitute or automatic POST.
 * Each async continuation belongs to one operation; cancel/dispose detaches it
 * before aborting so even a late transport cannot overwrite a resumed view.
 */
export function createLocalProviderOnboardingWorkflow(
    changed: (view: LocalOnboardingView) => void,
    transport: typeof fetch = (...args) => fetch(...args),
) {
    let view = INITIAL_LOCAL_ONBOARDING_VIEW;
    let disposed = false;
    type Operation = Readonly<{ controller: AbortController }>;
    let active: Operation | null = null;
    const current = (operation: Operation) => !disposed && active === operation && !operation.controller.signal.aborted;
    function assertCurrent(operation: Operation) {
        if (!current(operation)) throw new WorkflowError('request_cancelled');
    }
    function publish(next: LocalOnboardingView) {
        if (disposed) return;
        view = Object.freeze(next); changed(view);
    }
    function fail(code: string) {
        publish({ phase: code === 'request_cancelled' || code === 'verification_interrupted' || code === 'request_timed_out'
            ? 'interrupted' : terminalStates.has(code) ? 'blocked' : 'failed',
        status: null, functions: null, messageCode: code, busy: false });
    }
    async function json(operation: Operation, url: string, init?: RequestInit): Promise<unknown> {
        assertCurrent(operation);
        const { signal } = operation.controller;
        let stop!: () => void;
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; operation.controller.abort(); },
            init?.method === 'POST' ? ACTIVATION_WAIT_MS : READ_WAIT_MS);
        const interrupted = new Promise<never>((_, reject) => {
            stop = () => reject(new WorkflowError(timedOut ? 'request_timed_out' : 'request_cancelled'));
            signal.addEventListener('abort', stop, { once: true });
            if (signal.aborted) stop();
        });
        try {
            return await Promise.race([interrupted, Promise.resolve().then(async () => {
                assertCurrent(operation);
                const response = await transport(url, { ...init, cache: 'no-store', signal });
                assertCurrent(operation);
                if (response.status === 401 || response.status === 403) throw new WorkflowError('owner_locked');
                const body: unknown = await response.json();
                assertCurrent(operation);
                if (!response.ok) {
                    const error = body && typeof body === 'object' && 'error' in body ? body.error : null;
                    throw new WorkflowError(typeof error === 'string' ? error : 'state_unavailable');
                }
                return body;
            })]);
        } finally { clearTimeout(timer); signal.removeEventListener('abort', stop); }
    }
    async function read(operation: Operation) {
        const result = statusProjection(await json(operation, endpoint));
        assertCurrent(operation);
        return result;
    }
    function assertUnchanged(result: LocalProviderOnboardingStatus, acknowledged: LocalProviderOnboardingStatus) {
        if (result.state === 'revoked') throw new WorkflowError('revoked');
        if (result.revision !== acknowledged.revision || result.state !== 'available_unqualified')
            throw new WorkflowError('configuration_changed');
    }
    async function run(activate: boolean) {
        if (disposed || active) return;
        const previous = view.status;
        if (activate && (!previous?.canActivate || !['ready', 'completed'].includes(view.phase))) return;
        const operation: Operation = { controller: new AbortController() };
        active = operation;
        publish({ phase: activate ? 'verifying' : 'reading_configuration', status: activate ? previous : null,
            functions: null, messageCode: activate ? 'verifying' : 'reading_configuration', busy: true });
        try {
            if (!activate) {
                const status = await read(operation);
                publish({ phase: terminalStates.has(status.state) ? 'blocked' : 'ready', status, functions: null,
                    messageCode: status.state, busy: false });
                return;
            }
            const acknowledged = statusProjection(await json(operation, endpoint, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ intent: 'verify_and_activate', expectedRevision: previous!.revision }),
            }));
            assertCurrent(operation);
            if (acknowledged.state !== 'available_unqualified')
                throw new WorkflowError(acknowledged.state === 'revoked' ? 'revoked' : 'state_unavailable');
            publish({ phase: 'reading_result', status: null, functions: null, messageCode: 'reading_result', busy: true });
            const result = await read(operation);
            assertUnchanged(result, acknowledged);
            publish({ phase: 'reading_functions', status: result, functions: null, messageCode: 'reading_functions', busy: true });
            let functions: FunctionStatusSnapshot | null = null;
            try {
                functions = parseFunctionStatus(await json(operation, functionsEndpoint));
            } catch (error) {
                // Availability/shape failure is not a reason to repeat activation.
                // A lost owner or interrupted operation must instead clear every projection.
                if (error instanceof WorkflowError && (terminalStates.has(error.code)
                    || ['request_cancelled', 'request_timed_out', 'verification_interrupted', 'configuration_changed'].includes(error.code))) throw error;
                assertCurrent(operation);
            }
            // Reconcile after the auxiliary read too: it must not hide a concurrent
            // configuration change, provider revocation or owner retirement.
            publish({ phase: 'reading_result', status: null, functions: null, messageCode: 'reading_result', busy: true });
            const finalStatus = await read(operation);
            assertUnchanged(finalStatus, acknowledged);
            publish({ phase: 'completed', status: finalStatus, functions,
                messageCode: functions ? finalStatus.state : 'functions_unavailable', busy: false });
        } catch (error) {
            // A detached operation has no UI authority, including in finally.
            if (!disposed && active === operation)
                fail(error instanceof WorkflowError ? error.code : 'state_unavailable');
        } finally {
            if (active === operation) active = null;
            operation.controller.abort();
        }
    }
    return Object.freeze({
        getView: () => view,
        refresh: () => run(false),
        activate: () => run(true),
        cancel() {
            if (!active || disposed) return;
            const operation = active; active = null;
            operation.controller.abort();
            // An abort is not a rollback acknowledgment. A command may already
            // have committed; only an explicit refresh can make actions available.
            fail('request_cancelled');
        },
        dispose() {
            disposed = true;
            const operation = active; active = null;
            operation?.controller.abort();
        },
    });
}
