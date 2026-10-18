/** Host admission and the existing patient profile application service. */
import { and, eq } from 'drizzle-orm';
import { dbServer } from './db-server';
import { patients, patientsToAmbulatories } from './schema';
import { activePatients } from './patient-lifecycle';
import { normalizePatientUpdateInput } from './patient-write-normalization';
import type { PatientUpdateOperationResult } from './patient-update-operation';
import { createPatientProfileUpdateExecution, dispatchPatientProfileUpdate } from './patient-profile-update-dispatch';
import { NextResponse } from 'next/server';
import { requireSession, unauthorizedResponse, forbiddenResponse } from '@/lib/security/server-auth';
import { requireLocalApiToken } from '@/lib/security/local-api-auth';
import { requireAccountSession } from '@/lib/security/paired-native-session';
import { authenticateNetworkPairedClient } from '@/lib/network-home-base-server';
import { getNetworkModeGateResponse, resolveNetworkScope, requireNetworkCapabilityContext } from '@/lib/network-write-context';
import { NETWORK_FSE_VALIDATE_CAPABILITY } from './network-contract';
import { PATIENT_PROFILE_READ_OPERATION, type PatientProfileActor, type PatientProfileQuery, type PatientProfileView } from './patient-profile-query';
import type { NetworkPatientCommitGuard } from './network-patient-commit-authority';
import type { RequiredAuditContext } from './security/audit';
import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { ambulatories, settings, users } from './schema';
import { apiFailure, archiveReplacementResponse } from './api-error-response';
import { parseProfileQuery, ProfileQueryError, PROFILE_FIELD_NAMES, PROFILE_QUERY_RESULT_SCHEMA,
    PROFILE_QUERY_OPERATION_ID, assertProfileResultBudget, type ProfileFields, type ProfileProjection,
    type ProfileQuery, type ProfileResult } from './patient-profile-scoped-contract';
import { acquireAuthenticatedWebSessionProjectionOwnerContext } from './security/server-auth';
import { serverSessionProjectionOwnerProductionOwner } from './security/server-session-projection-owner-production-internal';
import { nativeProfileSelectionOwner } from './security/native-profile-selection-owner';
import * as webProfileLifetime from './security/web-auth-lifecycle-owner-adapter';
import * as nativeProfileLifetime from './security/native-profile-lifecycle';
import type { ServerSession } from './security/server-session';
import { ServerSessionProjectionOwnerError,
    type ServerSessionProfileSelectionOwner, type ServerSessionSelectionScopeV1, type ServerSessionSelectionDependentRegistrationV1 } from './security/server-session-projection-owner';
import { isTrustedWebMutationRequest } from './security/request-transport';
import { bindNetworkRequestScope } from './network-request-scope';
import { NETWORK_MODE_KEY, normalizeNetworkOperatingMode } from './network-contract';
import { NETWORK_PAIRING_STATE_KEY, parseNetworkPairingState } from './network-pairing-model';
import type { StoredNetworkPairedClient } from './network-pairing-model';
import { currentArchiveGeneration } from './security/archive-session-generation';
import type { PatientProfileQueryHostPort } from './security/patient-profile-query-host-port';

type PatientRecord = typeof patients.$inferSelect;
export type PatientProfileReadInput = Readonly<{ request: Request } & (
    | { projection: 'web' | 'api-v1' | 'network'; patientId: () => Promise<string | null> }
    | { projection: 'network-fse'; patientId: () => string | null }
)>;
export type PatientProfileReadResult =
    | { ok: false; response: NextResponse }
    | { ok: true; profile: Omit<PatientProfileView, 'deletedAt' | 'deletionReason'> & Partial<Pick<PatientProfileView, 'deletedAt' | 'deletionReason'>> | null; scopeAmbulatoryId: string | null };

type Admission =
    | { ok: false; response: NextResponse }
    | { ok: true; actor: PatientProfileActor; purpose: PatientProfileQuery['purpose']; scope: PatientProfileQuery['scope'] };

async function admitProfileRead(input: PatientProfileReadInput, consume: (admitted: Extract<Admission, { ok: true }>, patientId: string | null) => PatientProfileReadResult): Promise<PatientProfileReadResult> {
    const operation = PATIENT_PROFILE_READ_OPERATION;
    if (input.projection === 'api-v1') {
        const denial = requireLocalApiToken(input.request);
        if (denial) return { ok: false, response: denial };
        const patientId = await input.patientId();
        return consume({ ok: true, actor: { kind: 'local-service', ref: 'local-api', role: null, channel: 'local-token' },
            purpose: operation.purpose, scope: { kind: 'local' } }, patientId);
    }
    if (input.projection === 'web') {
        const session = await requireSession();
        if (!session) return { ok: false, response: unauthorizedResponse() };
        const patientId = await input.patientId();
        return consume({ ok: true, actor: { kind: 'operator', ref: session.userId, role: session.role, channel: 'web' },
            purpose: operation.purpose, scope: { kind: 'local' } }, patientId);
    }
    if (input.projection === 'network-fse') {
        const resolved = await requireNetworkCapabilityContext(input.request, NETWORK_FSE_VALIDATE_CAPABILITY);
        if (!resolved.ok) return resolved;
        const { session, scopeAmbulatoryId } = resolved.context;
        return consume({ ok: true, actor: { kind: 'operator', ref: session.userId, role: session.role,
            channel: session.authChannel === 'native' ? 'native' : 'web' },
        purpose: operation.fsePurpose, scope: { kind: 'ambulatory', ambulatoryId: scopeAmbulatoryId } }, input.patientId());
    }
    if (input.projection !== 'network') return { ok: false, response: unauthorizedResponse() };
    const client = await authenticateNetworkPairedClient(input.request);
    if (!client) return { ok: false, response: unauthorizedResponse() };
    const modeDenial = await getNetworkModeGateResponse();
    if (modeDenial) return { ok: false, response: modeDenial };
    if (!client.grantedCapabilities.includes('network.replica.readonly-patients')) return { ok: false, response: forbiddenResponse() };
    const session = await requireAccountSession(input.request);
    if (!session) return { ok: false, response: unauthorizedResponse() };
    const patientId = await input.patientId();
    const scopeAmbulatoryId = await resolveNetworkScope(session, input.request);
    if (!scopeAmbulatoryId) return { ok: false, response: NextResponse.json({ error: 'Network scope unavailable' }, { status: 403 }) };
    return consume({ ok: true, actor: { kind: 'operator', ref: session.userId, role: session.role,
        channel: session.authChannel === 'native' ? 'native' : 'web' },
    purpose: operation.purpose, scope: { kind: 'ambulatory', ambulatoryId: scopeAmbulatoryId } }, patientId);
}

function toIsoString(value: unknown): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function projectDetail(patient: PatientRecord): PatientProfileView {
    return {
        id: patient.id,
        firstName: patient.firstName,
        lastName: patient.lastName,
        birthDate: toIsoString(patient.birthDate),
        taxCode: patient.taxCode,
        address: patient.address ?? null,
        phone: patient.phone ?? null,
        caregiver: patient.caregiver ?? null,
        exemptions: patient.exemptions ?? null,
        diagnoses: patient.diagnoses ?? null,
        monitoringProfile: patient.monitoringProfile ?? null,
        statusReason: patient.statusReason ?? null,
        archiveReason: patient.archiveReason ?? null,
        archiveNote: patient.archiveNote ?? null,
        notes: patient.notes ?? null,
        aiSummary: patient.aiSummary ?? null,
        aiSummaryGeneratedAt: toIsoString(patient.aiSummaryGeneratedAt),
        aiSummaryContextHash: patient.aiSummaryContextHash ?? null,
        documentInsights: patient.documentInsights ?? null,
        isAdi: patient.isAdi ?? null,
        isArchived: patient.isArchived ?? null,
        deletedAt: toIsoString(patient.deletedAt), deletionReason: patient.deletionReason ?? null,
        version: patient.version,
        ambulatoryId: patient.ambulatoryId ?? null,
        createdAt: toIsoString(patient.createdAt),
        updatedAt: toIsoString(patient.updatedAt),
    };
}

function queryPatientProfile(query: PatientProfileQuery): PatientProfileView | null {
    if (query.operation !== PATIENT_PROFILE_READ_OPERATION.id) throw new Error('Unsupported patient profile query');
    const condition = and(eq(patients.id, query.patientId), activePatients());
    const patient = query.scope.kind === 'ambulatory'
        ? dbServer.select({ patient: patients }).from(patients)
            .innerJoin(patientsToAmbulatories, eq(patients.id, patientsToAmbulatories.patientId))
            .where(and(condition, eq(patientsToAmbulatories.ambulatoryId, query.scope.ambulatoryId))).get()?.patient
        : dbServer.select().from(patients).where(condition).get();
    return patient ? projectDetail(patient) : null;
}

export async function readPatientProfile(input: PatientProfileReadInput): Promise<PatientProfileReadResult> {
    return admitProfileRead(input, (admitted, patientId) => {
        const query: PatientProfileQuery | null = patientId ? {
            operation: PATIENT_PROFILE_READ_OPERATION.id, actor: admitted.actor, purpose: admitted.purpose,
            patientId, scope: admitted.scope,
        } : null;
        const snapshot = query ? queryPatientProfile(query) : null;
        const scopeAmbulatoryId = admitted.scope.kind === 'ambulatory' ? admitted.scope.ambulatoryId : null;
        if (input.projection === 'api-v1' && snapshot) {
            const profile = { ...snapshot };
            Reflect.deleteProperty(profile, 'deletedAt');
            Reflect.deleteProperty(profile, 'deletionReason');
            return { ok: true, profile, scopeAmbulatoryId };
        }
        return { ok: true, profile: snapshot, scopeAmbulatoryId };
    });
}

type ScopedOwnerProcess = Pick<typeof serverSessionProjectionOwnerProductionOwner,
    'selectionLifecycleController' | 'selectionBindingController' | 'selectionCommitBindingController'>;
type ScopedContext = Readonly<{
    session: ServerSession; owner: ServerSessionProfileSelectionOwner; process: ScopedOwnerProcess;
    purpose: PatientProfileQuery['purpose']; lane: 'web' | 'network' | symbol; maximumProjection: ProfileProjection;
    currentScope(): string; pairedClient?: StoredNetworkPairedClient; resultDeadline?: number;
}>;
type ScopedReferences = {
    active: boolean; epoch: number; scope: ServerSessionSelectionScopeV1;
    registration: ServerSessionSelectionDependentRegistrationV1;
    handles: Map<string, Readonly<{ lane: ScopedContext['lane']; maximumProjection: ProfileProjection;
        purpose: string; patientId: string; ambulatoryId: string; revision: number; expiresAt: number }>>;
};
const scopedReferences = new WeakMap<ServerSessionProfileSelectionOwner, ScopedReferences>();
const scopedHostPorts = new WeakMap<PatientProfileQueryHostPort, Readonly<{
    context: ScopedContext; state: ScopedReferences; active(): boolean;
}>>();

function scopedFail(code: ConstructorParameters<typeof ProfileQueryError>[0]): never { throw new ProfileQueryError(code); }

function currentProfileScope(request: Request, cookie: string | null): string {
    const active = cookie ? dbServer.select({ id: ambulatories.id }).from(ambulatories).where(eq(ambulatories.id, cookie)).get() : undefined;
    const ambulatory = active ?? dbServer.select({ id: ambulatories.id }).from(ambulatories).where(eq(ambulatories.isDefault, true)).get();
    const scope = bindNetworkRequestScope(request, ambulatory?.id ?? null);
    return scope ?? scopedFail('scope_denied');
}

function profileClientCurrent(client: StoredNetworkPairedClient): boolean {
    const setting = (key: string) => dbServer.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).get()?.value;
    if (normalizeNetworkOperatingMode(setting(NETWORK_MODE_KEY)) !== 'network-home-base') return false;
    const raw = setting(NETWORK_PAIRING_STATE_KEY);
    try {
        if (!raw || JSON.parse(raw).archiveGeneration !== currentArchiveGeneration()) return false;
        const current = parseNetworkPairingState(raw).clients.find(value => value.clientId === client.clientId);
        return !!current && current.tokenHash === client.tokenHash && current.clientPlatform === client.clientPlatform
            && current.grantedCapabilities.includes('network.replica.readonly-patients');
    } catch { return false; }
}

function withCurrentProfileSession<T>(context: ScopedContext, operation: () => T): T {
    const revoked = () => {
        const state = scopedReferences.get(context.owner);
        if (state) {
            state.active = false; state.handles.clear(); scopedReferences.delete(context.owner);
            context.process.selectionLifecycleController.unregisterDependent(state.scope, state.registration);
        }
        try { context.owner.dispose(); } catch { /* References are already terminal. */ }
    };
    const lifetime = context.session.authChannel === 'native' ? nativeProfileLifetime : webProfileLifetime;
    const port = lifetime.mintResourcePort(context.session);
    if (!port) { revoked(); return scopedFail('session_unavailable'); }
    const use = lifetime.beginResourceUse(port);
    try {
        if (!use) { revoked(); return scopedFail('session_unavailable'); }
        const validate = () => {
            const user = dbServer.select({ username: users.username, role: users.role }).from(users)
                .where(eq(users.id, context.session.userId)).get();
            if (!user || user.username !== context.session.username || (user.role ?? 'user') !== context.session.role) {
                revoked();
                scopedFail('session_unavailable');
            }
            if (context.pairedClient && !profileClientCurrent(context.pairedClient)) { revoked(); scopedFail('scope_denied'); }
        };
        validate();
        const result = operation();
        validate();
        if (!lifetime.commitResourceUse(use)) { revoked(); return scopedFail('session_unavailable'); }
        return result;
    } finally { if (use) lifetime.abortResourceUse(use); lifetime.releaseResourcePort(port); }
}

function references(context: ScopedContext): ScopedReferences {
    const epoch = context.owner.snapshotSelectionEpoch(context.session);
    const previous = scopedReferences.get(context.owner);
    if (previous?.active && previous.epoch === epoch) return previous;
    let state: ScopedReferences | undefined;
    const { selectionLifecycleController: lifecycle } = context.process;
    const accepted = lifecycle.withCurrentSelection(context.session, scope => {
        const registration = lifecycle.registerDependent(scope, () => {
            if (state) { state.active = false; state.handles.clear(); }
        });
        if (!registration) return;
        state = { active: true, epoch, scope, registration, handles: new Map() };
    });
    if (!accepted || !state) return scopedFail('selection_conflict');
    scopedReferences.set(context.owner, state);
    return state;
}

function scopedProjection(snapshot: PatientProfileView, projection: ProfileProjection): ProfileFields | Readonly<{ notes: string | null }> {
    if (projection === 'notes') return Object.freeze({ notes: snapshot.notes });
    const profile = Object.fromEntries(PROFILE_FIELD_NAMES.map(key => [key, snapshot[key]])) as ProfileFields;
    return Object.freeze(profile);
}

function executeScopedProfile(context: ScopedContext, query: ProfileQuery, expectedPatientId: string | null, select: boolean,
    signal?: AbortSignal): ProfileResult {
    if (signal?.aborted) return scopedFail('cancelled');
    if (context.maximumProjection === 'notes' && query.projection !== 'notes') return scopedFail('scope_denied');
    return withCurrentProfileSession(context, () => {
        const ambulatoryId = context.currentScope();
        if (query.kind === 'open' && select) {
            if (!expectedPatientId) return scopedFail('input_invalid');
            context.owner.issueSelection({ expectedEpoch: query.expectedSelectionEpoch, patientId: expectedPatientId, ambulatoryId });
        } else if (query.kind === 'open' && context.owner.snapshotSelectionEpoch(context.session) !== query.expectedSelectionEpoch) {
            return scopedFail('selection_conflict');
        }
        const state = references(context);
        const handle = query.kind === 'read' ? query.handle : `pph_${randomBytes(32).toString('hex')}`;
        const reference = query.kind === 'read' ? state.handles.get(handle) : null;
        if (query.kind === 'read') {
            if (!reference || reference.lane !== context.lane || reference.purpose !== context.purpose) return scopedFail('handle_unavailable');
            if (Date.now() >= reference.expiresAt) return scopedFail('handle_expired');
            if (reference.ambulatoryId !== ambulatoryId || (expectedPatientId && reference.patientId !== expectedPatientId)
                || (reference.maximumProjection === 'notes' && query.projection !== 'notes')) return scopedFail('scope_denied');
            if (reference.revision !== query.expectedRevision) return scopedFail('revision_conflict');
        }
        let result: ProfileResult | undefined;
        let failure: unknown;
        const accepted = context.process.selectionBindingController.withCurrentDependentBinding(state.scope, state.registration, binding => {
            if (binding.selection.selectionEpoch !== state.epoch) return;
            try { result = context.owner.withLeaseCriticalSection(context.session, selected => {
                if (selected.ambulatoryId !== ambulatoryId || (expectedPatientId && selected.patientId !== expectedPatientId)
                    || (reference && selected.patientId !== reference.patientId)) return scopedFail('scope_denied');
                const snapshot = queryPatientProfile({ operation: PROFILE_QUERY_OPERATION_ID,
                    actor: { kind: 'operator', ref: context.session.userId, role: context.session.role,
                        channel: context.session.authChannel === 'native' ? 'native' : 'web' },
                    purpose: context.purpose, patientId: selected.patientId,
                    scope: { kind: 'ambulatory', ambulatoryId } });
                if (!snapshot) return scopedFail('query_unavailable');
                if (snapshot.version !== binding.patientVersion || (reference && snapshot.version !== reference.revision)) return scopedFail('revision_conflict');
                const observedAt = Date.now();
                const expiresAt = Math.min(binding.selection.expiresAt, context.resultDeadline ?? Infinity, reference?.expiresAt ?? observedAt + 15 * 60_000);
                if (observedAt >= expiresAt) return scopedFail('handle_expired');
                const output = Object.freeze({ schemaVersion: PROFILE_QUERY_RESULT_SCHEMA, operationId: PROFILE_QUERY_OPERATION_ID,
                    contractVersion: 1 as const, handle, projection: query.projection,
                    currentness: Object.freeze({ revision: snapshot.version, selectionEpoch: state.epoch, observedAt, expiresAt }),
                    profile: scopedProjection(snapshot, query.projection) }) as ProfileResult;
                assertProfileResultBudget(output);
                if (signal?.aborted) return scopedFail('cancelled');
                if (context.currentScope() !== ambulatoryId) return scopedFail('scope_denied');
                if (query.kind === 'open') {
                    if (state.handles.size >= 32) return scopedFail('query_unavailable');
                    state.handles.set(handle, Object.freeze({ lane: context.lane, purpose: context.purpose,
                        maximumProjection: query.projection, patientId: selected.patientId, ambulatoryId,
                        revision: snapshot.version, expiresAt }));
                }
                return output;
            }); } catch (error) { failure = error; }
        });
        if (failure !== undefined) throw failure;
        if (!accepted || !state.active || !result) return scopedFail('selection_conflict');
        return result;
    });
}

async function admitScopedProfileRequest(request: Request, surface: 'web' | 'network'): Promise<ScopedContext | NextResponse> {
    let client: StoredNetworkPairedClient | undefined;
    if (surface === 'network') {
        const admitted = await authenticateNetworkPairedClient(request);
        if (!admitted) return unauthorizedResponse();
        const denial = await getNetworkModeGateResponse(); if (denial) return denial;
        if (!admitted.grantedCapabilities.includes('network.replica.readonly-patients')) return forbiddenResponse();
        client = admitted;
    }
    const session = surface === 'network' ? await requireAccountSession(request) : await requireSession();
    if (!session) return unauthorizedResponse();
    const cookie = (await cookies()).get('ambulatory_id')?.value ?? null;
    const process = session.authChannel === 'native' ? nativeProfileSelectionOwner : serverSessionProjectionOwnerProductionOwner;
    return { session, owner: process.registry.acquire(session), process, purpose: 'patient-profile-read', lane: surface,
        maximumProjection: 'profile', currentScope: () => currentProfileScope(request, cookie), pairedClient: client };
}

export function profileQueryFailureResponse(error: unknown): NextResponse {
    const replacement = archiveReplacementResponse(error); if (replacement) return replacement;
    const code = error instanceof ProfileQueryError ? error.code : error instanceof ServerSessionProjectionOwnerError
        ? error.code === 'epoch_conflict' ? 'selection_conflict'
            : error.code === 'session_ineligible' || error.code === 'session_unavailable' || error.code === 'owner_disposed'
                ? 'session_unavailable' : 'selection_conflict'
        : 'query_unavailable';
    const status = code === 'input_invalid' ? 400 : code === 'session_unavailable' ? 401 : code === 'scope_denied' ? 403
        : code === 'output_too_large' ? 413 : code === 'handle_expired' ? 410 : code === 'query_unavailable' ? 503 : 409;
    return apiFailure(code, code === 'output_too_large'
        ? 'Il profilo supera il limite della vista limitata. Nessun dato è stato restituito o troncato.'
        : 'Lettura del profilo non disponibile. Rileggi il contesto corrente.', status);
}

export async function readScopedPatientProfileHttp(request: Request, surface: 'web' | 'network', patientId: () => Promise<string>): Promise<NextResponse> {
    try {
        const context = await admitScopedProfileRequest(request, surface); if (context instanceof NextResponse) return context;
        if (surface === 'web' && !isTrustedWebMutationRequest(request)) return forbiddenResponse();
        let value: unknown;
        try { value = await request.json(); } catch { return scopedFail('input_invalid'); }
        const input = parseProfileQuery(value); if (!input) return scopedFail('input_invalid');
        const id = await patientId();
        if (typeof id !== 'string' || !id || id.length > 160) return scopedFail('input_invalid');
        const result = executeScopedProfile(context, input, id, true, request.signal);
        const response = NextResponse.json(result); response.headers.set('Cache-Control', 'no-store'); return response;
    } catch (error) { return profileQueryFailureResponse(error); }
}

export async function readPatientProfileSelectionEpochHttp(request: Request, surface: 'web' | 'network'): Promise<NextResponse> {
    try {
        const context = await admitScopedProfileRequest(request, surface); if (context instanceof NextResponse) return context;
        const selectionEpoch = withCurrentProfileSession(context, () => {
            context.currentScope();
            try { return context.owner.snapshotSelectionEpoch(context.session); }
            catch (error) {
                if (!(error instanceof ServerSessionProjectionOwnerError) || error.code !== 'stale_selection') throw error;
                context.currentScope();
                return context.owner.snapshotSelectionEpoch(context.session);
            }
        });
        const response = NextResponse.json({ contractVersion: 1, selectionEpoch });
        response.headers.set('Cache-Control', 'no-store'); return response;
    } catch (error) { return profileQueryFailureResponse(error); }
}

export async function acquireScopedPatientProfileHostPort(projection: ProfileProjection, expiresAt: number): Promise<PatientProfileQueryHostPort | null> {
    if ((projection !== 'profile' && projection !== 'notes') || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) return null;
    const authenticated = await acquireAuthenticatedWebSessionProjectionOwnerContext();
    if (!authenticated || expiresAt <= Date.now()) return null;
    let active = true;
    try {
        const { session, owner } = authenticated;
        const selected = owner.withLeaseCriticalSection(session, value => value);
        const context: ScopedContext = { session, owner, process: serverSessionProjectionOwnerProductionOwner,
            purpose: 'care_coordination', lane: Symbol('patient-profile-host-query'), maximumProjection: projection, resultDeadline: expiresAt,
            currentScope: () => selected.ambulatoryId };
        const state = withCurrentProfileSession(context, () => references(context));
        const port: PatientProfileQueryHostPort = Object.freeze({
            async executeProfileQuery(value: ProfileQuery, signal?: AbortSignal): Promise<ProfileResult> {
                if (!active || !state.active) return scopedFail('handle_unavailable');
                if (Date.now() >= expiresAt) return scopedFail('handle_expired');
                const input = parseProfileQuery(value); if (!input) return scopedFail('input_invalid');
                return executeScopedProfile(context, input, selected.patientId, false, signal);
            },
            dispose(): boolean {
                if (!active) return false; active = false;
                for (const [handle, reference] of state.handles) if (reference.lane === context.lane) state.handles.delete(handle);
                return true;
            },
        });
        scopedHostPorts.set(port, { context, state, active: () => active });
        return port;
    } catch { active = false; return null; }
}

export function isCurrentScopedPatientProfileResult(port: PatientProfileQueryHostPort, result: ProfileResult): boolean {
    const record = scopedHostPorts.get(port);
    if (!record || !record.active() || !record.state.active) return false;
    const reference = record.state.handles.get(result.handle);
    if (!reference || reference.lane !== record.context.lane || reference.revision !== result.currentness.revision
        || Date.now() >= reference.expiresAt || record.state.epoch !== result.currentness.selectionEpoch) return false;
    try {
        return withCurrentProfileSession(record.context, () => record.context.owner.withLeaseCriticalSection(record.context.session,
            selected => record.active() && record.state.active && selected.patientId === reference.patientId
                && selected.ambulatoryId === reference.ambulatoryId && record.context.currentScope() === reference.ambulatoryId));
    } catch { return false; }
}

export type PatientProfileUpdateContext = {
    patientId: string;
    expectedVersion: number;
    // These callbacks come from the admitted host adapter, never a decoded body.
    audit: () => RequiredAuditContext;
} & (
    | { scopeAmbulatoryId?: undefined; prepareCommitGuard?: undefined }
    | { scopeAmbulatoryId: string; prepareCommitGuard: () => Promise<NetworkPatientCommitGuard> }
);

export async function updatePatientProfile(
    context: PatientProfileUpdateContext,
    body: Record<string, unknown>,
): Promise<PatientUpdateOperationResult | { status: 400; value: { error: string } }> {
    // Web/v1 retain their existing 404-before-field-validation precedence.
    // Paired input is normalized before its final asynchronous scope admission.
    if (context.scopeAmbulatoryId === undefined) {
        const existing = await dbServer.select({ id: patients.id }).from(patients)
            .where(and(eq(patients.id, context.patientId), activePatients())).get();
        if (!existing) return { status: 404, value: { error: 'Not found' } };
    }
    const normalized = normalizePatientUpdateInput(body, { expectedVersion: context.expectedVersion });
    if (!normalized.ok) return { status: 400, value: { error: normalized.error } };
    const authorizeCommit = context.prepareCommitGuard ? await context.prepareCommitGuard() : undefined;
    const execution = createPatientProfileUpdateExecution({
        patientId: context.patientId,
        expectedVersion: context.expectedVersion,
        values: normalized.values,
        setPrimaryAmbulatory: Object.prototype.hasOwnProperty.call(body, 'ambulatoryId'),
        scopeAmbulatoryId: context.scopeAmbulatoryId,
        authorizeCommit,
        audit: context.audit(),
    });
    const outcome = await dispatchPatientProfileUpdate(execution, execution.command);
    if (outcome.kind === 'uncertain') throw outcome.error;
    return outcome.result;
}
