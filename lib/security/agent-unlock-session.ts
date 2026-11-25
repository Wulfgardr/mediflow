import 'server-only';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mintResourcePort, registerPrivateResource, releaseResourcePort, resolve } from './web-auth-lifecycle-owner-adapter';

type Unlock = { sessionId: string; controlId: string; confirmed: boolean; sharedGestures: Set<string> };
const registry = globalThis as typeof globalThis & { mediflowAgentUnlocks?: Map<string, Unlock> };
const unlocks = registry.mediflowAgentUnlocks ??= new Map<string, Unlock>();
const ticketRef = (ticket: string) => createHash('sha256').update(ticket).digest('hex');

function rememberUnlock(ref: string, sessionId: string, controlId: string): Unlock | null {
    const session = resolve(sessionId, controlId);
    if (session.status !== 'active' || session.projection.role !== 'admin') return null;
    const existing = unlocks.get(ref);
    if (existing) return existing.sessionId === sessionId && existing.controlId === controlId ? existing : null;
    const port = mintResourcePort(session.projection);
    if (!port) return null;
    try {
        if (!registerPrivateResource(port, () => { unlocks.delete(ref); })) return null;
        const unlock = { sessionId, controlId, confirmed: false, sharedGestures: new Set<string>() };
        unlocks.set(ref, unlock);
        return unlock;
    } finally {
        releaseResourcePort(port);
    }
}

export function beginAgentUnlock(sessionId: string, controlId: string): string | null {
    const ticket = randomBytes(32).toString('base64url');
    return rememberUnlock(ticketRef(ticket), sessionId, controlId) ? ticket : null;
}

function currentAdmin(unlock: Unlock, actorRef: string): boolean {
    const resolved = resolve(unlock.sessionId, unlock.controlId);
    return resolved.status === 'active' && resolved.projection.userId === actorRef && resolved.projection.role === 'admin';
}

export function confirmAgentUnlock(ticket: string, sessionId: string, actorRef: string, issue: (unlockRef: string) => void): boolean {
    const ref = ticketRef(ticket);
    const unlock = unlocks.get(ref);
    if (!unlock || unlock.sessionId !== sessionId || !currentAdmin(unlock, actorRef)) return false;
    if (!unlock.confirmed) {
        issue(ref);
        unlock.confirmed = true;
    }
    return true;
}

export function confirmSharedAgentUnlock(gesture: string, sessionId: string, controlId: string, actorRef: string, issue: (unlockRef: string) => void): boolean {
    const ref = ticketRef(JSON.stringify(['shared-tab', sessionId]));
    const unlock = rememberUnlock(ref, sessionId, controlId);
    if (!unlock || !currentAdmin(unlock, actorRef)) return false;
    if (!unlock.sharedGestures.has(gesture)) {
        issue(ref + ':' + gesture);
        unlock.sharedGestures.add(gesture);
        unlock.confirmed = true;
    }
    return true;
}

export function confirmDirectAgentRenewal(sessionId: string, controlId: string, actorRef: string, issue: (unlockRef: string) => void): boolean {
    return confirmSharedAgentUnlock(randomUUID(), sessionId, controlId, actorRef, issue);
}
