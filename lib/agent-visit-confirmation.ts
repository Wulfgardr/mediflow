import 'server-only';
import { randomUUID } from 'node:crypto';
import { agentAppliedItemIds, agentConfirmationPatientState, applyConfirmedAgentVisit, hasAgentVisitConfirmationReceipt, recordDeniedAgentVisitConfirmation } from './agent-visit-application';
import { readAgentCassette } from './agent-cassette-store';
import { cassetteItems } from './agent-cassette-contract';
import { openDbServer } from './db-server';
import { agentCassetteAppliesAutomatically, agentKindOnlyAutomatic, agentKindPhases, type AgentApplication } from './agent-visit-application-contract';
import { launchNativeVisitConfirmation, nativeVisitConfirmationConfigured } from './agent-visit-confirmation-native';
import { createVisitConfirmationChallenge } from './agent-visit-confirmation-proof';
import { visitConfirmationDurationMs, type VisitConfirmationReceipt, type VisitConfirmationTicket } from './agent-visit-confirmation-contract';
import { archiveGenerationForSession, currentArchiveGeneration } from './security/archive-session-generation';
import type { AgentPrincipal } from './agent-pairing-store';
import type { ServerSession } from './security/server-session';
import { mintResourcePort, registerPrivateResource, releaseResourcePort, unregisterPrivateResource } from './security/web-auth-lifecycle-owner-adapter';
import { isCurrentServerSession } from './security/current-session-authority';

type NativePeer = Awaited<ReturnType<typeof launchNativeVisitConfirmation>>;
type AgentIdentity = Pick<AgentPrincipal, 'agentRef' | 'actorRef' | 'archiveGeneration' | 'mandateRef'>;
type SessionPreparation = Readonly<{ sessionId: string; patientId: string; patientVersion: number; patientState: string }>;
type Confirmation = VisitConfirmationTicket & {
    identity: AgentIdentity;
    modelProvider: AgentPrincipal['modelProvider'];
    state: { kind: 'waiting' } | { kind: 'starting'; prepared: SessionPreparation; abort: AbortController }
        | { kind: 'ready' | 'showing'; prepared: SessionPreparation; abort: AbortController; peer: NativePeer }
        | { kind: 'denied' | 'applied' };
    cleanup?: () => void;
    deadline: number;
    wake: ReturnType<typeof setTimeout>;
};
const globalState = globalThis as typeof globalThis & { mediFlowVisitConfirmations?: Map<string, Confirmation> };
const requests = globalState.mediFlowVisitConfirmations ??= new Map();
const denied = () => new Error('VISIT_CONFIRMATION_DENIED');
const receipt = (reference: string, status: VisitConfirmationReceipt['status']): VisitConfirmationReceipt => ({ reference, status });

function sameAgent(first: AgentIdentity, second: AgentIdentity): boolean {
    return first.actorRef === second.actorRef && first.agentRef === second.agentRef && first.mandateRef === second.mandateRef
        && first.archiveGeneration === second.archiveGeneration;
}

function retire(request: Confirmation, outcome: 'applied' | 'denied' = 'denied', reason = 'confirmation_not_applied') {
    if (request.state.kind === 'applied' || request.state.kind === 'denied') return;
    const auditedDenial = outcome === 'denied' && request.state.kind === 'showing';
    if (outcome === 'applied' && 'peer' in request.state) {
        request.state.peer.complete();
    } else {
        if ('abort' in request.state) request.state.abort.abort();
        if ('peer' in request.state) request.state.peer.stop();
    }
    request.cleanup?.();
    request.cleanup = undefined;
    clearTimeout(request.wake);
    request.state = { kind: outcome };
    request.wake = setTimeout(() => { requests.delete(request.reference); }, visitConfirmationDurationMs);
    request.wake.unref();
    if (auditedDenial) {
        try { recordDeniedAgentVisitConfirmation({ ...request.identity, reference: request.reference, visitId: request.visitId,
            revision: request.revision, modelProvider: request.modelProvider }, reason); } catch {}
    }
}

function waiting(request: Confirmation): boolean {
    if (request.state.kind === 'applied' || request.state.kind === 'denied') return false;
    if (performance.now() < request.deadline) return true;
    retire(request, 'denied', 'confirmation_expired');
    return false;
}

function fromCassette(request: Confirmation, requireAutomatic: boolean): boolean {
    const row = readAgentCassette(openDbServer(), request.visitId, request.identity.actorRef);
    if (!row || !sameAgent(row, request.identity) || row.status !== 'closed' || row.revision !== request.revision) return false;
    const applied = new Set(agentAppliedItemIds(request.visitId));
    const pending = cassetteItems(row).filter(item => !applied.has(item.id));
    const appliesAutomatically = agentCassetteAppliesAutomatically(row);
    return pending.some(item => agentKindPhases(appliesAutomatically, item.kind).includes('review'))
        && (!requireAutomatic || appliesAutomatically && !pending.some(item => agentKindOnlyAutomatic(appliesAutomatically, item.kind)));
}

export function startVisitConfirmation(principal: AgentPrincipal, visitId: string): VisitConfirmationReceipt {
    const reference = randomUUID();
    if (!nativeVisitConfirmationConfigured()) return receipt(reference, 'unavailable');
    const row = readAgentCassette(openDbServer(), visitId, principal.actorRef);
    if (!row || !sameAgent(row, principal) || row.status !== 'closed' || currentArchiveGeneration() !== principal.archiveGeneration) {
        return receipt(reference, 'not_applied');
    }
    const existing = [...requests.values()].find(request => waiting(request));
    if (existing) return existing.visitId === visitId && sameAgent(existing.identity, principal)
        ? receipt(existing.reference, 'waiting') : receipt(reference, 'unavailable');
    if (requests.size >= 32) return receipt(reference, 'unavailable');
    const identity = Object.freeze({ actorRef: principal.actorRef, archiveGeneration: principal.archiveGeneration,
        agentRef: principal.agentRef, mandateRef: principal.mandateRef });
    const pending: Confirmation = { reference, visitId, revision: row.revision, identity, modelProvider: principal.modelProvider,
        state: { kind: 'waiting' }, deadline: performance.now() + visitConfirmationDurationMs,
        wake: setTimeout(() => retire(pending, 'denied', 'confirmation_expired'), visitConfirmationDurationMs) };
    if (!fromCassette(pending, false)) {
        clearTimeout(pending.wake);
        return receipt(reference, 'not_applied');
    }
    pending.wake.unref();
    requests.set(reference, pending);
    return receipt(reference, 'waiting');
}

export function readVisitConfirmationReceipt(principal: AgentPrincipal, reference: string): VisitConfirmationReceipt {
    if (hasAgentVisitConfirmationReceipt(reference, principal)) return receipt(reference, 'applied');
    const pending = requests.get(reference);
    return receipt(reference, pending && sameAgent(pending.identity, principal) && waiting(pending) ? 'waiting' : 'not_applied');
}

function matchesSession(pending: Confirmation, session: ServerSession): boolean {
    return pending.identity.actorRef === session.userId && session.authChannel === 'web' && session.role === 'admin'
        && pending.identity.archiveGeneration === archiveGenerationForSession(session)
        && pending.identity.archiveGeneration === currentArchiveGeneration();
}

export function nextVisitConfirmation(session: ServerSession): VisitConfirmationTicket | null {
    for (const pending of requests.values()) {
        if (waiting(pending) && pending.state.kind === 'waiting' && matchesSession(pending, session) && fromCassette(pending, true)) {
            return { reference: pending.reference, visitId: pending.visitId, revision: pending.revision };
        }
    }
    return null;
}

export async function prepareVisitConfirmation(session: ServerSession, reference: string, patientId: string, patientVersion: number, signal: AbortSignal) {
    const pending = requests.get(reference);
    if (!pending || !waiting(pending) || pending.state.kind !== 'waiting' || !matchesSession(pending, session) || !fromCassette(pending, true)) throw denied();
    const patientState = agentConfirmationPatientState(patientId, patientVersion);
    const prepared = Object.freeze({ sessionId: session.id, patientId, patientVersion, patientState });
    const port = mintResourcePort(session);
    if (!port) throw denied();
    const registration = registerPrivateResource(port, () => retire(pending, 'denied', 'session_retired'));
    if (!registration) {
        releaseResourcePort(port);
        throw denied();
    }
    pending.cleanup = () => {
        unregisterPrivateResource(port, registration);
        releaseResourcePort(port);
    };
    const abort = new AbortController();
    pending.state = { kind: 'starting', prepared, abort };
    try {
        const peer = await launchNativeVisitConfirmation(AbortSignal.any([abort.signal, signal]));
        if (!waiting(pending) || pending.state.kind !== 'starting' || signal.aborted) {
            peer.stop();
            throw denied();
        }
        pending.state = { kind: 'ready', prepared, abort, peer };
        return { agreementPublicKey: peer.registration.agreementPublicKey };
    } catch (error) {
        retire(pending);
        throw error;
    }
}

export function dismissVisitConfirmation(session: ServerSession, reference: string) {
    const pending = requests.get(reference);
    if (!pending || !waiting(pending) || !matchesSession(pending, session) || !('prepared' in pending.state)
        || pending.state.prepared.sessionId !== session.id) throw denied();
    retire(pending);
}

export async function presentVisitConfirmation(request: Request, session: ServerSession, currentSession: () => Promise<ServerSession | null>,
    reference: string, plan: AgentApplication, presentation: string) {
    const pending = requests.get(reference);
    if (!pending || !waiting(pending) || pending.state.kind !== 'ready' || !matchesSession(pending, session)) throw denied();
    const { prepared, peer, abort } = pending.state;
    if (prepared.sessionId !== session.id || plan.visitId !== pending.visitId || plan.cassetteRevision !== pending.revision
        || plan.patientId !== prepared.patientId || plan.expectedVersion !== prepared.patientVersion || plan.phase !== 'review') throw denied();

    pending.state = { kind: 'showing', prepared, peer, abort };
    const assertLive = () => {
        if (!waiting(pending) || pending.state.kind !== 'showing' || request.signal.aborted || abort.signal.aborted) throw denied();
        peer.assertLive();
    };
    const withdraw = () => retire(pending, 'denied', 'web_connection_closed');
    request.signal.addEventListener('abort', withdraw, { once: true });
    try {
        assertLive();
        if (!fromCassette(pending, true) || agentConfirmationPatientState(plan.patientId, plan.expectedVersion) !== prepared.patientState) throw denied();
        const expiresAt = Date.now() + Math.floor(pending.deadline - performance.now());
        const challenge = createVisitConfirmationChallenge({ ...pending.identity, ...prepared, reference, expiresAt,
            visitId: pending.visitId, revision: pending.revision }, plan, presentation, peer.registration.signingPublicKey);
        const proof = await peer.confirm(challenge.bytes, presentation);
        const current = await currentSession();
        if (!current || current.id !== session.id || !matchesSession(pending, current) || !isCurrentServerSession(current)) throw denied();
        const result = applyConfirmedAgentVisit(request, current, plan, { challenge, proof, assertLive });
        retire(pending, 'applied');
        return result;
    } catch (error) {
        retire(pending);
        throw error;
    } finally {
        request.signal.removeEventListener('abort', withdraw);
    }
}
