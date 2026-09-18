/* @Codex — named host orchestration. Original function handlers own acquisition
 * and publication. This registry never turns a prompt/source/DTO into authority. */
import 'server-only';
import { nativeOrdinaryHostSourcesAreCurrent, readNativeOrdinaryHostSource, closeNativeOrdinaryHostSources,
    type NativeOrdinaryHostSourceCapture } from '../security/server-session-clinical-context-native-sources';
import type { PairedNativeSession } from '../security/paired-native-session';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import * as owner from '../security/ordinary-session-authority';
import { acquireOrdinarySessionResourceIdentity } from '../security/ordinary-session-authority';
import { createOrdinaryProductAttempt } from '../chatgpt-execution/ordinary-product-attempt';
import { createSharedMacProductPlatform } from '../chatgpt-execution/execution-mac-product';
import { readOrdinaryGovernance } from '../chatgpt-execution/ordinary-governance';
import { readOrdinaryCloudSettings, writeOrdinaryCloudSettings } from './ordinary-settings';
import { readOrdinaryTaskProfile, type OrdinaryTaskProfile } from '../chatgpt-execution/ordinary-task-profile';
import type { RedactionSessionInput } from '../ai-redaction-session';
import type { OrdinaryExecutionResult } from '../chatgpt-execution/execution-service';
import type { SynthesisCatalog } from '../chatgpt-execution/execution-contract';
import { ExecutionError } from '../chatgpt-execution/execution-contract';
import { ProductError } from './product-contract';
import { ORDINARY_FLOW_SCHEMA, type OrdinaryFunction, type OrdinaryFlowState, type OrdinaryRemoteReceipt, type OrdinaryRemoteProvenance } from './ordinary-wire';

type Attempt = Awaited<ReturnType<typeof createOrdinaryProductAttempt>>;
type Entry = {
    generation: owner.AuthenticationGeneration; session: owner.OrdinarySession; port: owner.ResourcePort;
    id: string; functionId: OrdinaryFunction; controller: AbortController; active: boolean; busy: boolean; claimed: boolean;
    publishing: boolean; delivered: boolean; expiresAt: number; deadline: number; attempt?: Attempt; catalog?: SynthesisCatalog;
    nativeSources?: NativeOrdinaryHostSourceCapture;
    applicationCurrent?: () => boolean; knownIdentifiers?: RedactionSessionInput['knownIdentifiers'];
    sourceCurrent?: () => boolean; sourceTimer?: ReturnType<typeof setInterval>; timer?: ReturnType<typeof setTimeout>;
    initial: Deferred<Response>; output: Deferred<OrdinaryExecutionResult>; original?: Promise<Response>;
    result?: OrdinaryExecutionResult; cleanup?: Promise<Readonly<{ cleanupConfirmed: boolean }>>;
};
function deferred<T>() {
    let resolve!: (v: T) => void, reject!: (error: unknown) => void;
    const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
    void promise.catch(() => {}); return { promise, resolve, reject };
}
type Deferred<T> = ReturnType<typeof deferred<T>>;
const scopeKey = Symbol.for('mediflow.chatgpt.ordinary-scope.v1');
const scopeRoots = globalThis as typeof globalThis & { [scopeKey]?: AsyncLocalStorage<Entry> };
const scope = scopeRoots[scopeKey] ??= new AsyncLocalStorage<Entry>();
const registryKey = Symbol.for('mediflow.chatgpt.ordinary-registry.v1');
const shared = globalThis as typeof globalThis & { [registryKey]?: Map<owner.AuthenticationGeneration, Entry> };
const entries = shared[registryKey] ??= new Map();
const key = 'x-mediflow-function-model';
function local(entry: Entry): boolean {
    return entry.active && !entry.controller.signal.aborted && !entry.delivered && Date.now() < entry.expiresAt && performance.now() < entry.deadline;
}
function guard(entry: Entry, withSource = true) {
    if (!local(entry)) throw new ProductError('revoked');
    const use = owner.beginResourceUse(entry.port); if (!use) throw new ProductError('session_expired');
    owner.abortResourceUse(use);
    if (withSource && entry.nativeSources && !nativeOrdinaryHostSourcesAreCurrent(entry.nativeSources)) throw new ProductError('revoked');
    if (withSource && entry.applicationCurrent && !entry.applicationCurrent()) throw new ProductError('revoked');
    if (withSource && entry.sourceCurrent && !entry.sourceCurrent()) throw new ProductError('revoked');
}
async function close(entry: Entry): Promise<Readonly<{ cleanupConfirmed: boolean }>> {
    if (entry.cleanup) return entry.cleanup;
    entry.active = false; entry.controller.abort();
    if (entry.nativeSources) closeNativeOrdinaryHostSources(entry.nativeSources); clearTimeout(entry.timer); clearInterval(entry.sourceTimer);
    entry.output.reject(new ProductError('revoked')); entry.initial.reject(new ProductError('revoked'));
    entry.cleanup = Promise.resolve().then(async () => {
        let cleanupConfirmed = true;
        try { if (entry.attempt) cleanupConfirmed = (await entry.attempt.dispose()).cleanupConfirmed; }
        catch { cleanupConfirmed = false; }
        owner.releaseResourcePort(entry.port);
        // A failed cleanup retains the reservation and the registry tombstone.
        if (cleanupConfirmed && entries.get(entry.generation) === entry) entries.delete(entry.generation);
        return Object.freeze({ cleanupConfirmed });
    });
    void entry.cleanup.catch(() => {}); return entry.cleanup;
}
function snapshot(entry: Entry): OrdinaryFlowState {
    guard(entry);
    const state = entry.attempt?.snapshot();
    return Object.freeze({ schema: ORDINARY_FLOW_SCHEMA, attemptId: entry.id, functionId: entry.functionId,
        phase: entry.publishing ? 'generating' : state?.state === 'completed' ? 'generating' : ((state?.state === 'empty' ? 'preparing' : state?.state) ?? 'preparing') as OrdinaryFlowState['phase'],
        expiresAt: Math.floor(Math.min(entry.expiresAt, state?.expiresAt ?? Infinity)) });
}
function reply(value: unknown, status = 200) { return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } }); }
export function ordinaryFailure(error: unknown): Response {
    const code = error instanceof ProductError || error instanceof ExecutionError ? error.code : 'upstream_error';
    return reply({ error: 'OpenAI non disponibile per questa operazione. Nessun provider alternativo e stato usato.', code },
        code === 'session_expired' ? 401 : ['invalid_request'].includes(code) ? 400 : ['busy', 'catalog_stale', 'model_unavailable', 'revoked'].includes(code) ? 409 : 503);
}
/** Binds only a genuine, opaque host capture; never a callback or client source. */
export function bindNativeOrdinaryHostSources(capture: NativeOrdinaryHostSourceCapture): void {
    const entry = scope.getStore();
    if (!entry || entry.session.authChannel !== 'native' || entry.claimed || entry.nativeSources) throw new ProductError('invalid_request');
    readNativeOrdinaryHostSource(capture, entry.session as PairedNativeSession, entry.functionId);
    entry.nativeSources = capture; guard(entry);
}
/** Reads only the fact that this exact host handler is in the fixed remote scope. */
export function isOrdinaryFunctionSelected(functionId: OrdinaryFunction): boolean {
    const entry = scope.getStore();
    if (!entry) return false;
    if (entry.functionId !== functionId) throw new ProductError('invalid_request');
    guard(entry, false); return true;
}
/** Called solely after the original function owner has acquired its projection.
 * The verifier removes authority; it cannot create an entry or select a profile. */
export async function executeOwnedOrdinaryProfile(functionId: OrdinaryFunction, profile: OrdinaryTaskProfile,
    current: () => boolean, knownIdentifiers?: RedactionSessionInput['knownIdentifiers']): Promise<OrdinaryExecutionResult> {
    const entry = scope.getStore();
    if (!entry || entry.functionId !== functionId || entry.claimed || !entry.applicationCurrent || readOrdinaryTaskProfile(profile).functionId !== functionId) throw new ProductError('invalid_request');
    if (entry.session.authChannel === 'native' && functionId !== 'document_synthesis' && !entry.nativeSources) throw new ProductError('revoked');
    guard(entry); if (!current()) throw new ProductError('revoked');
    entry.claimed = true; entry.sourceCurrent = current;
    entry.sourceTimer = setInterval(() => { try { guard(entry); } catch { void close(entry); } }, 50); entry.sourceTimer.unref?.();
    try {
        const governed = await readOrdinaryGovernance(functionId); guard(entry);
        const attempt = await createOrdinaryProductAttempt(entry.session, createSharedMacProductPlatform(), () => {
            try { guard(entry); return true; } catch { return false; }
        });
        entry.attempt = attempt;
        try { guard(entry); } catch (error) { await attempt.dispose(); throw error; }
        const disclosure = await attempt.prepare(profile, randomUUID(), governed.configuration, entry.controller.signal, entry.knownIdentifiers ?? knownIdentifiers);
        guard(entry);
        entry.initial.resolve(reply({ ...snapshot(entry), disclosure }, 202));
        const result = await entry.output.promise;
        if (result !== entry.result || result.functionId !== functionId || !entry.attempt.isCurrent(result)) throw new ProductError('revoked');
        // The final source commit is performed by the original caller, not here.
        return result;
    } catch (error) { entry.initial.reject(error); throw error; }
}
export function ordinaryResultMetadata(result: OrdinaryExecutionResult): Readonly<{ receipt: OrdinaryRemoteReceipt; provenance: OrdinaryRemoteProvenance }> {
    const entry = scope.getStore();
    if (!entry || entry.result !== result || !local(entry) || !entry.attempt?.isCurrent(result)) throw new ProductError('revoked');
    const receipt: OrdinaryRemoteReceipt = Object.freeze({ schemaVersion: 'mediflow.ai.chatgpt-receipt.v1', capability: result.functionId,
        venue: 'cloud', provider: 'chatgpt_subscription', model: result.provenance.model, effort: result.provenance.effort,
        egress: 'redacted_explicit_consent', retention: 'chatgpt_service_terms_apply', fallback: 'none',
        sourceSha256: result.provenance.sourceSha256, payloadSha256: result.provenance.payloadSha256, outputSha256: result.provenance.outputSha256 });
    return Object.freeze({ receipt, provenance: Object.freeze({ schemaVersion: 'mediflow.ai.chatgpt-provenance.v1', capability: result.functionId,
        venue: 'cloud', provider: 'chatgpt_subscription', model: receipt.model,
        preprocessing: Object.freeze(['context_minimization', 'layer1_redaction', 'layer2_redaction', 'envelope_validation'] as const), receipt }) });
}
/** The route passes the authenticated projection; identity is minted BEFORE lookup. */
export async function beginOrdinaryFunction(request: Request, functionId: OrdinaryFunction, session: owner.OrdinarySession,
    originalHandler: (request: Request) => Promise<Response>): Promise<Response> {
    const identity = acquireOrdinarySessionResourceIdentity(session);
    if (!identity) throw new ProductError('session_expired');
    const previous = entries.get(identity.generation);
    if (previous || entries.size >= 16) { owner.releaseResourcePort(identity.port); throw new ProductError('busy'); }
    const authorityExpiry = owner.readResourceExpiresAt(identity.port, session.expiresAt);
    if (authorityExpiry === null || authorityExpiry <= Date.now()) { owner.releaseResourcePort(identity.port); throw new ProductError('session_expired'); }
    const entry: Entry = { ...identity, session, id: randomUUID(), functionId, controller: new AbortController(), active: true,
        busy: false, claimed: false, publishing: false, delivered: false, expiresAt: Math.min(authorityExpiry, Date.now() + 300000),
        deadline: performance.now() + Math.min(300000, authorityExpiry - Date.now()), initial: deferred<Response>(), output: deferred<OrdinaryExecutionResult>() };
    const retire = () => { void close(entry); };
    // Registration and synchronous ownership precede every asynchronous start.
    entry.timer = setTimeout(retire, Math.max(0, entry.expiresAt - Date.now())); entry.timer.unref?.();
    const registration = owner.registerPrivateResource(entry.port, retire);
    if (!registration || !entry.active) { await close(entry); throw new ProductError('session_expired'); }
    entries.set(entry.generation, entry);
    request.signal.addEventListener('abort', retire, { once: true });
    try {
        const settings = await readOrdinaryCloudSettings(); guard(entry);
        if (!settings.enabled) throw new ProductError('unqualified_boundary');
        const headers = new Headers(request.headers); headers.delete(key);
        const ownedRequest = new Request(request, { headers, signal: entry.controller.signal });
        const original: Promise<Response> = scope.run(entry, async () => {
            try {
                const response = await originalHandler(ownedRequest);
                if (!entry.claimed) entry.initial.resolve(response);
                return response;
            } catch (error) { entry.initial.reject(error); throw error; }
        });
        entry.original = original;
        void original.catch(() => {});
        const response = await entry.initial.promise; guard(entry);
        if (!entry.claimed) { await close(entry); return response; }
        const use = owner.beginResourceUse(entry.port); if (!use) throw new ProductError('session_expired');
        try {
            let bound = false;
            if (!owner.withCurrentResourceBinding(use, () => { bound = local(entry); }) || !bound || !owner.commitResourceUse(use)) throw new ProductError('session_expired');
        } finally { owner.abortResourceUse(use); }
        return response;
    } catch (error) { await close(entry); throw error; }
    finally { request.signal.removeEventListener('abort', retire); }
}
/** Every command authenticates afresh, then uses the ORIGINAL persistent port.
 * The function result is never returned by status or a cached GET. */
export async function ordinaryFunctionCommand(session: owner.OrdinarySession, operation: string, body: Record<string, unknown>, signal: AbortSignal): Promise<Response> {
    const identity = acquireOrdinarySessionResourceIdentity(session); if (!identity) throw new ProductError('session_expired');
    const entry = entries.get(identity.generation); owner.releaseResourcePort(identity.port);
    if (operation === 'status' && !entry) return reply({ schema: ORDINARY_FLOW_SCHEMA, phase: 'closed', attemptId: null, cleanupConfirmed: true });
    if (!entry || (operation !== 'status' && body.attemptId !== entry.id)) throw new ProductError('invalid_state');
    if (operation === 'cancel') return reply({ schema: ORDINARY_FLOW_SCHEMA, phase: 'closed', ...(await close(entry)) });
    if (operation === 'status' && !entry.active) return reply({ schema: ORDINARY_FLOW_SCHEMA, phase: 'closed',
        attemptId: entry.id, functionId: entry.functionId, cleanupConfirmed: false });
    guard(entry); if (signal.aborted) { await close(entry); throw new ProductError('revoked'); }
    if (operation === 'status') {
        const response = reply(snapshot(entry));
        const use = owner.beginResourceUse(entry.port); if (!use) throw new ProductError('session_expired');
        try { let valid = false;
            if (!owner.withCurrentResourceBinding(use, () => { valid = local(entry) && !signal.aborted; }) || !valid || !owner.commitResourceUse(use)) throw new ProductError('session_expired');
            return response;
        } finally { owner.abortResourceUse(use); }
    }
    if (entry.busy) throw new ProductError('busy'); entry.busy = true;
    const use = owner.beginResourceUse(entry.port); if (!use) { await close(entry); throw new ProductError('session_expired'); }
    const abort = () => { void close(entry); }; signal.addEventListener('abort', abort, { once: true });
    try {
        const attempt = entry.attempt; if (!attempt) throw new ProductError('invalid_state');
        let response: Response;
        if (operation === 'consent') { await attempt.consent({ operation: entry.functionId, expectedDisclosureRevision: body.expectedDisclosureRevision }); response = reply(snapshot(entry)); }
        else if (operation === 'login/start') { const challenge = await attempt.loginStart(); response = reply({ ...snapshot(entry), challenge }); }
        else if (operation === 'login/complete') { await attempt.loginComplete(); response = reply(snapshot(entry)); }
        else if (operation === 'models') { entry.catalog = await attempt.models(); response = reply({ ...snapshot(entry), catalog: entry.catalog }); }
        else if (operation === 'generate') {
            if (typeof body.modelOptionId !== 'string' || typeof body.expectedCatalogRevision !== 'string') throw new ProductError('invalid_request');
            const result = await attempt.generate({ modelOptionId: body.modelOptionId, expectedCatalogRevision: body.expectedCatalogRevision });
            guard(entry);
            await readOrdinaryGovernance(entry.functionId); guard(entry);
            // Stop only the source watcher once the original lease is about to
            // commit. Session/consent/deadline and final owner commit remain.
            entry.publishing = true; clearInterval(entry.sourceTimer); entry.result = result; entry.output.resolve(result);
            response = await entry.original!;
            guard(entry);
            if (!response.ok || !attempt.isCurrent(result)) throw new ProductError('revoked');
            if (session.authChannel === 'native') {
                // Read the original owner's proposal BEFORE disposal, and seal the
                // fixed envelope with the final binding below; never transform it later.
                const resultBody: unknown = await response.json(); guard(entry);
                response = reply({ schema: 'mediflow.native-ordinary.v1', phase: 'completed',
                    attemptId: entry.id, functionId: entry.functionId, cleanupConfirmed: true, result: resultBody });
            }
        } else if (operation === 'preference') {
            if (session.authChannel !== 'web') throw new ProductError('forbidden');
            const option = entry.catalog?.choices.find((option: import('../chatgpt-execution/execution-contract').SynthesisChoice) => option.optionId === body.modelOptionId);
            if (!option || entry.catalog?.revision !== body.expectedCatalogRevision || typeof body.expectedRevision !== 'string') throw new ProductError('catalog_stale');
            await writeOrdinaryCloudSettings(session, body.expectedRevision, { preference: { functionId: entry.functionId, value: { use: 'chatgpt_subscription', model: option.model, effort: option.effort } } }, signal);
            response = reply({ ...snapshot(entry), settings: await readOrdinaryCloudSettings() });
        } else throw new ProductError('invalid_request');
        const finalSealed = !entry.result || attempt.isCurrent(entry.result);
        if (operation === 'generate') {
            // Native seal and original function commit precede cleanup. Keep the
            // original owner port alive to fence retirement DURING cleanup.
            if (!finalSealed || !(await attempt.dispose()).cleanupConfirmed) throw new ProductError('unqualified_boundary');
            guard(entry);
        }
        guard(entry);
        let permitted = false;
        if (!owner.withCurrentResourceBinding(use, () => {
            permitted = local(entry) && (!entry.result || finalSealed);
        }) || !permitted || signal.aborted || !owner.commitResourceUse(use)) throw new ProductError('session_expired');
        if (operation === 'generate') {
            entry.delivered = true;
            // No further await after response commit; disposal is idempotent and
            // its resources have already been confirmed above.
            void close(entry);
        }
        return response;
    } catch (error) {
        if (!(error instanceof ProductError && error.code === 'login_pending')) await close(entry);
        throw error;
    } finally { owner.abortResourceUse(use); entry.busy = false; signal.removeEventListener('abort', abort); }
}

/** The application owner, not a browser patient ID, acquires the context. A
 * fresh projection must prove the same opaque authentication generation. */
export async function bindOrdinaryApplicationContext(functionId: OrdinaryFunction, applicationOwner: unknown, applicationSession: unknown): Promise<void> {
    const entry = scope.getStore(); if (!entry || entry.functionId !== functionId || entry.claimed) throw new ProductError('invalid_request');
    const [{ isServerSessionProjectionOwner }, schema, { dbServer }, orm, { activePatients }] = await Promise.all([
        import('../security/server-session-projection-owner'), import('../schema'), import('../db-server'), import('drizzle-orm'), import('../patient-lifecycle'),
    ]);
    guard(entry);
    const identity = acquireOrdinarySessionResourceIdentity(applicationSession as owner.OrdinarySession);
    if (!identity) throw new ProductError('session_expired');
    try { if (identity.generation !== entry.generation || !isServerSessionProjectionOwner(applicationOwner)) throw new ProductError('session_expired'); }
    finally { owner.releaseResourcePort(identity.port); }
    if (!isServerSessionProjectionOwner(applicationOwner)) throw new ProductError('revoked');
    const session = applicationSession as owner.ServerSession;
    const pair = applicationOwner.withLeaseCriticalSection(session, selected => ({ ...selected }));
    const selectionEpoch = applicationOwner.snapshotSelectionEpoch(session), reviewEpoch = applicationOwner.snapshotReviewContextEpoch(session);
    const read = () => dbServer.select({ version: schema.patients.version, firstName: schema.patients.firstName,
        lastName: schema.patients.lastName, birthDate: schema.patients.birthDate }).from(schema.patients)
        .innerJoin(schema.patientsToAmbulatories, orm.eq(schema.patients.id, schema.patientsToAmbulatories.patientId))
        .where(orm.and(orm.eq(schema.patients.id, pair.patientId), orm.eq(schema.patientsToAmbulatories.ambulatoryId, pair.ambulatoryId), activePatients())).get();
    const patient = read(); if (!patient || !Number.isSafeInteger(patient.version)) throw new ProductError('revoked');
    const names = [patient.firstName, patient.lastName, [patient.firstName, patient.lastName].filter(Boolean).join(' ')].filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
    const birth = patient.birthDate;
    const dates = birth instanceof Date && Number.isFinite(birth.getTime()) ? [birth.toISOString().slice(0,10), `${String(birth.getUTCDate()).padStart(2,'0')}/${String(birth.getUTCMonth()+1).padStart(2,'0')}/${birth.getUTCFullYear()}`] : typeof birth === 'string' && birth ? [birth] : [];
    entry.knownIdentifiers = Object.freeze({ names: Object.freeze([...new Set(names)]), birthDates: Object.freeze(dates) });
    entry.applicationCurrent = () => {
        try {
            const selected = applicationOwner.withLeaseCriticalSection(session, current => ({ ...current }));
            return selected.patientId === pair.patientId && selected.ambulatoryId === pair.ambulatoryId
                && applicationOwner.snapshotSelectionEpoch(session) === selectionEpoch && applicationOwner.snapshotReviewContextEpoch(session) === reviewEpoch
                && read()?.version === patient.version;
        } catch { return false; }
    };
    guard(entry); if (!entry.applicationCurrent()) throw new ProductError('revoked');
}
export function ordinaryApplicationIsCurrent(functionId: OrdinaryFunction): boolean {
    const entry = scope.getStore();
    if (!entry || entry.functionId !== functionId || !entry.applicationCurrent) return false;
    try { guard(entry, false); return entry.applicationCurrent(); } catch { return false; }
}

/** Fixed administrative disable only; absence of a call never grants egress. */
export function cancelOrdinaryGeneration(): void {
    for (const entry of entries.values()) void close(entry);
}
