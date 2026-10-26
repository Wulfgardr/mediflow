import 'server-only';
import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { dbServer } from '../db-server';
import { ambulatories, ambulatoryDestructiveCommands, auditEvents, users } from '../schema';
import { assertArchiveGeneration, readSqliteArchiveGeneration } from '../archive-generation';
import { assertArchiveRequestInTransaction } from './archive-request-context';
import { revalidatePairedCommitAuthority } from '../network-patient-commit-authority';
import { bindNetworkRequestScope } from '../network-request-scope';
import { NETWORK_AMBULATORY_WRITE_CAPABILITY } from '../network-ambulatory-write';
import { clearAmbulatoryInTransaction, deleteAmbulatoryInTransaction } from '../ambulatory-write';
import { inspectAmbulatoryDestructivePlan, type AmbulatoryPlanBinding } from '../ambulatory-destructive-command-plan';
import { AMBULATORY_COMMAND_PROTOCOL, AMBULATORY_MARKER_FIELDS, commandObject, commandOpaqueId, commandOperation, commandVersion,
    parseAmbulatoryCommandMarker, type AmbulatoryCommandMarker } from '../ambulatory-destructive-command-contract';
import { publicAmbulatoryReceipt, validateAmbulatoryCommandRows, type AmbulatoryCommandRow } from '../ambulatory-destructive-command-backup';
import { snapshotBackupAudit } from '../backup-audit';
import { archiveGenerationForSession } from './archive-session-generation';
import { isCurrentServerSession, type PairedNativeBinding } from './current-session-authority';
import type { ServerSession } from './server-session';
import { resolve, type WebSessionProjection } from './web-auth-lifecycle-owner-adapter';
import { bootstrapWebAuthControl, webAuthControlIdFromRequest, webAuthSessionIdFromRequest } from './web-auth-control-transport';
import { completeExactWebP3Logout } from './web-auth-logout-server';

export const AMBULATORY_COMMAND_REFERENCE_HEADER = 'x-mediflow-ambulatory-command-reference';
export const AMBULATORY_COMMAND_PREPARATION_MS = 300_000;
export const AMBULATORY_COMMAND_CHALLENGE_MS = 30_000;
type Tx = Parameters<Parameters<typeof dbServer.transaction>[0]>[0];
type Identity = Omit<AmbulatoryCommandMarker, 'planDigest'>;
type Flow = { purpose: 'execute' | 'recover'; identity: Identity; marker: AmbulatoryCommandMarker | null;
    native: ServerSession; device: PairedNativeBinding; request: Request; generation: string; origin: string;
    controlId: string; webId: string | null; createdAt: number; expiresAt: number; attempted: boolean; expired: boolean };
type Reply = { status: number; value: Record<string, unknown> };
const denied = (status = 403, code = 'AMBULATORY_COMMAND_DENIED'): Reply => ({ status, value: { code } });
const generationHeader = 'x-mediflow-archive-generation';
const markerKeys = [...AMBULATORY_MARKER_FIELDS];
function markerMatches(row: AmbulatoryCommandRow, marker: AmbulatoryCommandMarker): boolean {
    return markerKeys.every(key => row[key] === marker[key]);
}

/** ADR0169: correlations bind two original authorities; they never grant administration. */
export function createAmbulatoryDestructiveService(options: { now?: () => number } = {}) {
    const now = options.now ?? Date.now;
    const flows = new Map<string, Flow>();
    function peer(tx: Tx, flow: Pick<Flow, 'native' | 'device' | 'request' | 'generation'>): Reply | null {
        assertArchiveGeneration(tx, flow.generation);
        assertArchiveRequestInTransaction(tx);
        const denial = revalidatePairedCommitAuthority(tx, { request: flow.request, session: flow.native, binding: flow.device,
            archiveGeneration: flow.generation, requiredCapabilities: [NETWORK_AMBULATORY_WRITE_CAPABILITY] });
        if (denial) return { status: denial.status, value: denial.value };
        const user = tx.select().from(users).where(eq(users.id, flow.native.userId)).get();
        return user?.role === 'admin' && user.username === flow.native.username && flow.native.role === 'admin' ? null : denied();
    }
    function locate(request: Request): Flow | null {
        const reference = request.headers.get(AMBULATORY_COMMAND_REFERENCE_HEADER);
        if (!reference || !/^[a-f0-9]{64}$/u.test(reference)) return null;
        const flow = flows.get(reference);
        return flow && request.headers.get('origin') === flow.origin ? flow : null;
    }
    function web(request: Request, flow: Flow): WebSessionProjection | null {
        const id = webAuthSessionIdFromRequest(request), controlId = webAuthControlIdFromRequest(request);
        if (!id || controlId !== flow.controlId || (flow.webId !== null && id !== flow.webId)) return null;
        const resolved = resolve(id, controlId);
        if (resolved.status !== 'active' || resolved.projection.authChannel !== 'web') return null;
        const session = resolved.projection;
        if (session.userId !== flow.native.userId || session.username !== flow.native.username || session.role !== 'admin'
            || session.createdAt < flow.createdAt || session.createdAt > now() || session.expiresAt <= now()) return null;
        flow.webId = id;
        return session;
    }
    function authorize(tx: Tx, request: Request, flow: Flow): WebSessionProjection | Reply {
        if (flow.expired) return denied(401, 'AMBULATORY_AUTHORIZATION_EXPIRED');
        if (now() < flow.createdAt || now() >= flow.expiresAt) { flow.expired = true; return denied(401, 'AMBULATORY_PREPARATION_EXPIRED'); }
        if (request.headers.get(generationHeader) !== flow.generation) return denied(409, 'ARCHIVE_REPLACED');
        const denial = peer(tx, flow); if (denial) return denial;
        const session = web(request, flow);
        if (!session || !isCurrentServerSession(session)) return denied(401);
        assertArchiveGeneration(tx, archiveGenerationForSession(session));
        if (now() >= session.createdAt + AMBULATORY_COMMAND_CHALLENGE_MS) { flow.expired = true; return denied(401, 'AMBULATORY_CHALLENGE_EXPIRED'); }
        return session;
    }
    function binding(flow: Flow): AmbulatoryPlanBinding {
        return { ...flow.identity, actorRef: flow.native.userId, deviceId: flow.device.clientId,
            devicePlatform: flow.device.clientPlatform, deviceTokenHash: flow.device.tokenHash };
    }
    function existing(tx: Tx, flow: Flow, marker: AmbulatoryCommandMarker): AmbulatoryCommandRow | Reply | null {
        const row = tx.select().from(ambulatoryDestructiveCommands).where(eq(ambulatoryDestructiveCommands.commandId, marker.commandId)).get();
        if (!row) return null;
        if (row.actorRef !== flow.native.userId || row.deviceId !== flow.device.clientId || row.devicePlatform !== flow.device.clientPlatform
            || row.deviceTokenHash !== flow.device.tokenHash) return denied();
        if (!markerMatches(row, marker)) return denied(409, 'AMBULATORY_COMMAND_COLLISION');
        return row;
    }
    function terminal(row: AmbulatoryCommandRow): Reply {
        return { status: 200, value: { outcome: 'terminal', historical: row.originalArchiveGeneration !== readSqliteArchiveGeneration(dbServer.$client),
            receipt: publicAmbulatoryReceipt(row) } };
    }
    function insert(tx: Tx, row: AmbulatoryCommandRow): Reply {
        const audits = tx.select().from(auditEvents).where(eq(auditEvents.requestId, row.commandId as string)).all().map(snapshotBackupAudit);
        validateAmbulatoryCommandRows([row], audits);
        if (tx.insert(ambulatoryDestructiveCommands).values(row as typeof ambulatoryDestructiveCommands.$inferInsert).run().changes !== 1)
            throw new Error('Ambulatory command receipt did not write exactly one row');
        return terminal(row);
    }
    function row(flow: Flow, marker: AmbulatoryCommandMarker): AmbulatoryCommandRow {
        return { ...marker, actorRef: flow.native.userId, deviceId: flow.device.clientId, devicePlatform: flow.device.clientPlatform,
            deviceTokenHash: flow.device.tokenHash, outcome: 'closed', reason: null, committedAt: Math.floor(now() / 1000), resultJson: null, auditSnapshots: null };
    }
    return {
        begin(request: Request, native: ServerSession, device: PairedNativeBinding, input: unknown, admittedScope: string | null) {
            if (!commandObject(input, ['purpose', 'command']) || !['execute', 'recover'].includes(input.purpose as string)) return { ...denied(400), control: null };
            const generation = archiveGenerationForSession(native);
            if (!generation || request.headers.get(generationHeader) !== generation) return { ...denied(409, 'ARCHIVE_REPLACED'), control: null };
            let identity: Identity, marker: AmbulatoryCommandMarker | null = null;
            if (input.purpose === 'execute') {
                const command = input.command;
                if (!commandObject(command, ['operation', 'originalScopeId', 'ambulatoryId', 'expectedVersion']) || !commandOperation(command.operation)
                    || !commandOpaqueId(command.originalScopeId) || !commandOpaqueId(command.ambulatoryId) || !commandVersion(command.expectedVersion)
                    || command.originalScopeId !== admittedScope || request.headers.get('x-mediflow-expected-ambulatory-id') !== encodeURIComponent(command.originalScopeId)
                    || bindNetworkRequestScope(request, admittedScope) !== admittedScope || !admittedScope) return { ...denied(400), control: null };
                identity = { protocol: AMBULATORY_COMMAND_PROTOCOL, commandId: randomUUID(), originalArchiveGeneration: generation,
                    originalScopeId: command.originalScopeId, ambulatoryId: command.ambulatoryId, expectedVersion: command.expectedVersion, operation: command.operation };
            } else {
                marker = parseAmbulatoryCommandMarker(input.command);
                if (!marker) return { ...denied(400), control: null };
                identity = Object.fromEntries(markerKeys.filter(key => key !== 'planDigest').map(key => [key, marker![key]])) as Identity;
            }
            if (flows.size >= 128) return { ...denied(503, 'AMBULATORY_COMMAND_CAPACITY'), control: null };
            const denial = dbServer.transaction(tx => {
                const denial = peer(tx, { native, device, request, generation }); if (denial) return denial;
                if (input.purpose === 'execute') {
                    if (!tx.select({ id: ambulatories.id }).from(ambulatories).where(eq(ambulatories.id, identity.originalScopeId)).get()) return denied();
                    if (tx.select({ id: ambulatoryDestructiveCommands.commandId }).from(ambulatoryDestructiveCommands).where(eq(ambulatoryDestructiveCommands.commandId, identity.commandId)).get())
                        return denied(409, 'AMBULATORY_COMMAND_COLLISION');
                }
                return null;
            }, { behavior: 'immediate' });
            if (denial) return { ...denial, control: null };
            const control = bootstrapWebAuthControl(null); if (!control) return { ...denied(503), control: null };
            const createdAt = now(), reference = randomBytes(32).toString('hex');
            flows.set(reference, { purpose: input.purpose as Flow['purpose'], identity: Object.freeze(identity), marker: marker ? Object.freeze({ ...marker }) : null,
                native, device: { ...device }, request, generation, origin: request.headers.get('origin')!, controlId: control.controlId,
                webId: null, createdAt, expiresAt: createdAt + AMBULATORY_COMMAND_PREPARATION_MS, attempted: false, expired: false });
            return { status: 200, value: { protocol: AMBULATORY_COMMAND_PROTOCOL, contractVersion: 1, purpose: input.purpose,
                command: identity, reference, currentArchiveGeneration: generation, expiresAt: createdAt + AMBULATORY_COMMAND_PREPARATION_MS }, control };
        },
        preview(request: Request): Reply {
            const flow = locate(request); if (!flow || flow.purpose !== 'execute') return denied(401);
            return dbServer.transaction(tx => {
                const authority = authorize(tx, request, flow); if ('status' in authority) return authority;
                if (flow.attempted) return denied(409, 'AMBULATORY_COMMAND_ALREADY_SENT');
                if (!tx.select({ id: ambulatories.id }).from(ambulatories).where(eq(ambulatories.id, flow.identity.originalScopeId)).get()) return denied();
                if (tx.select({ id: ambulatoryDestructiveCommands.commandId }).from(ambulatoryDestructiveCommands).where(eq(ambulatoryDestructiveCommands.commandId, flow.identity.commandId)).get()) return denied(409, 'AMBULATORY_COMMAND_COLLISION');
                const plan = inspectAmbulatoryDestructivePlan(tx, binding(flow));
                if (plan.reason) return denied(409, plan.reason === 'fallback_ambiguous' ? 'SET_ANOTHER_DEFAULT_FIRST' : 'AMBULATORY_PLAN_NOT_ADMISSIBLE');
                if (flow.marker && flow.marker.planDigest !== plan.planDigest) return denied(409, 'AMBULATORY_PLAN_CHANGED');
                const latest = authorize(tx, request, flow); if ('status' in latest) return latest;
                flow.marker ??= Object.freeze({ ...flow.identity, planDigest: plan.planDigest });
                return { status: 200, value: { marker: flow.marker, target: plan.target, fallback: plan.fallback, counts: plan.counts,
                    challengeExpiresAt: authority.createdAt + AMBULATORY_COMMAND_CHALLENGE_MS } };
            }, { behavior: 'immediate' });
        },
        execute(request: Request, input: unknown): Reply {
            const flow = locate(request); if (!flow || flow.purpose !== 'execute' || !flow.marker) return denied(401);
            if (!commandObject(input, ['operation', 'planDigest', 'confirmation']) || input.operation !== flow.marker.operation
                || input.planDigest !== flow.marker.planDigest || input.confirmation !== (flow.marker.operation === 'ambulatory.clear-test.v1' ? 'SVUOTA' : 'ELIMINA')) return denied(400);
            return dbServer.transaction(tx => {
                const authority = authorize(tx, request, flow); if ('status' in authority) return authority;
                const previous = existing(tx, flow, flow.marker!); if (previous) return 'status' in previous ? previous : terminal(previous);
                if (flow.attempted) return denied(409, 'AMBULATORY_COMMAND_ALREADY_SENT');
                flow.attempted = true;
                assertArchiveGeneration(tx, flow.marker!.originalArchiveGeneration);
                const record = row(flow, flow.marker!);
                const plan = inspectAmbulatoryDestructivePlan(tx, binding(flow));
                if (plan.reason || plan.planDigest !== flow.marker!.planDigest
                    || !tx.select({ id: ambulatories.id }).from(ambulatories).where(eq(ambulatories.id, flow.identity.originalScopeId)).get())
                    return insert(tx, { ...record, outcome: 'rejected', reason: 'plan_changed' });
                if (tx.select({ id: auditEvents.eventId }).from(auditEvents).where(eq(auditEvents.requestId, flow.identity.commandId)).get())
                    return denied(409, 'AMBULATORY_COMMAND_COLLISION');
                const latest = authorize(tx, request, flow); if ('status' in latest) return latest;
                const requestForAudit = new Request(request.url, { headers: { 'x-request-id': flow.identity.commandId } });
                const context = { request: requestForAudit, session: authority };
                const result = flow.identity.operation === 'ambulatory.clear-test.v1'
                    ? clearAmbulatoryInTransaction(tx, context, flow.identity.ambulatoryId, flow.identity.expectedVersion, 'host', undefined)
                    : deleteAmbulatoryInTransaction(tx, context, flow.identity.ambulatoryId, flow.identity.expectedVersion, 'host', undefined);
                if (result.status !== 200) throw new Error('Admitted ambulatory plan did not commit');
                const audits = tx.select().from(auditEvents).where(and(eq(auditEvents.requestId, flow.identity.commandId), eq(auditEvents.actorRef, authority.userId))).all().map(snapshotBackupAudit);
                const publicResult = { targetVersion: flow.identity.operation === 'ambulatory.clear-test.v1' ? flow.identity.expectedVersion + 1 : null,
                    affectedAmbulatories: flow.identity.operation === 'ambulatory.clear-test.v1'
                        ? [{ id: flow.identity.ambulatoryId, version: flow.identity.expectedVersion + 1 }] : result.value.affectedAmbulatories,
                    clear: plan.counts };
                return insert(tx, { ...record, outcome: 'applied', resultJson: JSON.stringify(publicResult), auditSnapshots: JSON.stringify(audits) });
            }, { behavior: 'immediate' });
        },
        recover(request: Request, close: boolean): Reply {
            const flow = locate(request); if (!flow || flow.purpose !== 'recover' || !flow.marker) return denied(401);
            return dbServer.transaction(tx => {
                const authority = authorize(tx, request, flow); if ('status' in authority) return authority;
                const previous = existing(tx, flow, flow.marker!); if (previous) return 'status' in previous ? previous : terminal(previous);
                return close ? insert(tx, row(flow, flow.marker!)) : { status: 200, value: { outcome: 'unknown' } };
            }, { behavior: 'immediate' });
        },
        async retire(request: Request): Promise<Response> {
            const flow = locate(request), controlId = webAuthControlIdFromRequest(request), id = webAuthSessionIdFromRequest(request);
            if (!flow || controlId !== flow.controlId || !id || (flow.webId !== null && flow.webId !== id)) return new Response(null, { status: 401 });
            const resolution = resolve(id, controlId);
            if (resolution.status !== 'active' || resolution.projection.userId !== flow.native.userId
                || resolution.projection.createdAt < flow.createdAt) return new Response(null, { status: 401 });
            const reply = await completeExactWebP3Logout({ name: 'mediflow_session', value: id }, { name: 'mediflow_auth_control', value: controlId }, request);
            if (reply.status === 204) flows.delete(request.headers.get(AMBULATORY_COMMAND_REFERENCE_HEADER)!);
            return reply;
        },
    };
}
export const ambulatoryDestructiveService = createAmbulatoryDestructiveService();
