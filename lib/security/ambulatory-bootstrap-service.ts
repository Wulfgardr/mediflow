import 'server-only';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { dbServer } from '../db-server';
import { ambulatories, users } from '../schema';
import { createAmbulatory } from '../ambulatory-write';
import { assertArchiveGeneration } from '../archive-generation';
import { revalidatePairedCommitAuthority } from '../network-patient-commit-authority';
import { archiveGenerationForSession } from './archive-session-generation';
import { isCurrentServerSession, type PairedNativeBinding } from './current-session-authority';
import type { ServerSession } from './server-session';
import { resolve, type WebSessionProjection } from './web-auth-lifecycle-owner-adapter';
import { bootstrapWebAuthControl, webAuthControlIdFromRequest, webAuthSessionIdFromRequest } from './web-auth-control-transport';
import { completeExactWebP3Logout } from './web-auth-logout-server';

export const FIRST_AMBULATORY_OPERATION = 'first-ambulatory.create.v1';
export const BOOTSTRAP_REFERENCE_HEADER = 'x-mediflow-bootstrap-reference';
const GENERATION_HEADER = 'x-mediflow-archive-generation';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
type Tx = Parameters<Parameters<typeof dbServer.transaction>[0]>[0];
type Draft = { operation: typeof FIRST_AMBULATORY_OPERATION; id: string; name: string; address: string | null; description: string | null };
type Flow = { draft: Draft; native: ServerSession; binding: PairedNativeBinding; request: Request;
    generation: string; origin: string; controlId: string; createdAt: number; expiresAt: number; webId: string | null };
type Reply = { status: number; value: Record<string, unknown> };
const denied = (status = 403, code = 'BOOTSTRAP_DENIED'): Reply => ({ status, value: { code } });

function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype
        && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function text(value: unknown, maximum: number): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= maximum
        && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}
function draft(value: unknown): Draft | null {
    if (!exact(value, ['operation', 'id', 'name', 'address', 'description'])
        || value.operation !== FIRST_AMBULATORY_OPERATION || typeof value.id !== 'string' || !UUID.test(value.id)
        || !text(value.name, 200) || !(value.address === null || text(value.address, 500))
        || !(value.description === null || text(value.description, 2000))) return null;
    return Object.freeze({ operation: FIRST_AMBULATORY_OPERATION, id: value.id, name: value.name,
        address: value.address, description: value.description });
}

/** ADR0167: correlations never replace either original owner authority. */
export function createAmbulatoryBootstrapService(options: { now?: () => number } = {}) {
    const now = options.now ?? Date.now;
    const flows = new Map<string, Flow>();
    function peer(tx: Tx, flow: Pick<Flow, 'native' | 'binding' | 'request' | 'generation'>): Reply | null {
        assertArchiveGeneration(tx, flow.generation);
        const denial = revalidatePairedCommitAuthority(tx, { request: flow.request, session: flow.native,
            binding: flow.binding, archiveGeneration: flow.generation });
        if (denial) return { status: denial.status, value: denial.value };
        const user = tx.select().from(users).where(eq(users.id, flow.native.userId)).get();
        return user?.role === 'admin' && user.username === flow.native.username && flow.native.role === 'admin'
            ? null : denied();
    }
    function locate(request: Request): Flow | null {
        const reference = request.headers.get(BOOTSTRAP_REFERENCE_HEADER);
        if (!reference || !/^[0-9a-f]{64}$/u.test(reference)) return null;
        const flow = flows.get(reference);
        return flow && request.headers.get('origin') === flow.origin ? flow : null;
    }
    function web(request: Request, flow: Flow): WebSessionProjection | null {
        const control = webAuthControlIdFromRequest(request);
        const id = webAuthSessionIdFromRequest(request);
        if (control !== flow.controlId || !id || (flow.webId !== null && id !== flow.webId)) return null;
        const resolution = resolve(id, control);
        if (resolution.status !== 'active' || resolution.projection.authChannel !== 'web') return null;
        const session = resolution.projection;
        if (session.userId !== flow.native.userId || session.username !== flow.native.username || session.role !== 'admin'
            || session.createdAt < flow.createdAt || session.createdAt > now() || session.expiresAt <= now()) return null;
        flow.webId = id;
        return session;
    }
    function authorize(tx: Tx, request: Request, flow: Flow): WebSessionProjection | Reply {
        if (now() < flow.createdAt || now() >= flow.expiresAt) return denied(401, 'BOOTSTRAP_EXPIRED');
        if (request.headers.get(GENERATION_HEADER) !== flow.generation) return denied(409, 'ARCHIVE_REPLACED');
        const denial = peer(tx, flow);
        if (denial) return denial;
        const session = web(request, flow);
        if (!session || !isCurrentServerSession(session)) return denied(401);
        assertArchiveGeneration(tx, archiveGenerationForSession(session));
        return session;
    }
    return {
        begin(request: Request, native: ServerSession, binding: PairedNativeBinding, input: unknown) {
            const payload = draft(input);
            if (!payload) return { ...denied(400, 'BOOTSTRAP_INPUT_INVALID'), control: null };
            if (flows.size >= 128) return { ...denied(503, 'BOOTSTRAP_CAPACITY'), control: null };
            const generation = archiveGenerationForSession(native);
            if (!generation || request.headers.get(GENERATION_HEADER) !== generation) return { ...denied(409, 'ARCHIVE_REPLACED'), control: null };
            const denial = dbServer.transaction(tx => peer(tx, { native, binding, request, generation }), { behavior: 'immediate' });
            if (denial) return { ...denial, control: null };
            const createdAt = now();
            const control = bootstrapWebAuthControl(null);
            if (!control) return { ...denied(503), control: null };
            const reference = randomBytes(32).toString('hex');
            const expiresAt = createdAt + 120_000;
            flows.set(reference, { draft: payload, native, binding, request, generation, origin: request.headers.get('origin')!,
                controlId: control.controlId, createdAt, expiresAt, webId: null });
            return { status: 200, value: { operation: FIRST_AMBULATORY_OPERATION, contractVersion: 1,
                reference, archiveGeneration: generation, expiresAt }, control };
        },
        commit(request: Request, input: unknown): Reply {
            if (!exact(input, ['operation', 'confirm']) || input.operation !== FIRST_AMBULATORY_OPERATION || input.confirm !== true) return denied(400, 'BOOTSTRAP_INPUT_INVALID');
            const flow = locate(request);
            if (!flow) return denied(401);
            return dbServer.transaction((tx): Reply => {
                const authority = authorize(tx, request, flow);
                if ('status' in authority) return authority;
                if (tx.select({ id: ambulatories.id }).from(ambulatories).limit(1).get()) return denied(409, 'BOOTSTRAP_NOT_EMPTY');
                const result = createAmbulatory({ request, session: authority }, { id: flow.draft.id, name: flow.draft.name, address: flow.draft.address,
                    description: flow.draft.description, parentId: null, type: 'live', isDefault: true });
                return { status: result.status, value: result.status === 201
                    ? { ...result.value, operation: FIRST_AMBULATORY_OPERATION, contractVersion: 1, archiveGeneration: flow.generation }
                    : result.value };
            }, { behavior: 'immediate' });
        },
        read(request: Request): Reply {
            const flow = locate(request);
            if (!flow) return denied(401);
            return dbServer.transaction((tx): Reply => {
                const authority = authorize(tx, request, flow);
                if ('status' in authority) return authority;
                const row = tx.select().from(ambulatories).where(eq(ambulatories.id, flow.draft.id)).get();
                if (!row) return denied(404, 'BOOTSTRAP_NOT_FOUND');
                if (row.name !== flow.draft.name || row.address !== flow.draft.address || row.description !== flow.draft.description
                    || row.parentId !== null || row.type !== 'live' || row.isDefault !== true || row.version !== 1) return denied(409, 'READBACK_DIVERGED');
                return { status: 200, value: { operation: 'first-ambulatory.read.v1', contractVersion: 1,
                    archiveGeneration: flow.generation, id: row.id, name: row.name, address: row.address,
                    description: row.description, parentId: null, type: 'live', isDefault: true, version: 1 } };
            }, { behavior: 'immediate' });
        },
        async retire(request: Request, input: unknown): Promise<Response> {
            if (!exact(input, ['operation']) || input.operation !== 'first-ambulatory.retire.v1') return Response.json(denied(400).value, { status: 400 });
            const flow = locate(request);
            const controlId = webAuthControlIdFromRequest(request), id = webAuthSessionIdFromRequest(request);
            if (!flow || controlId !== flow.controlId || !id || (flow.webId !== null && id !== flow.webId)) return new Response(null, { status: 401 });
            const resolution = resolve(id, controlId);
            if (resolution.status !== 'active' || resolution.projection.userId !== flow.native.userId
                || resolution.projection.createdAt < flow.createdAt) return new Response(null, { status: 401 });
            const result = await completeExactWebP3Logout({ name: 'mediflow_session', value: id },
                { name: 'mediflow_auth_control', value: controlId }, request);
            if (result.status === 204) flows.delete(request.headers.get(BOOTSTRAP_REFERENCE_HEADER)!);
            return result;
        },
    };
}

export const ambulatoryBootstrapService = createAmbulatoryBootstrapService();
