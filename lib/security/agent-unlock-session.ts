import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { mintResourcePort, registerPrivateResource, releaseResourcePort, resolve } from './web-auth-lifecycle-owner-adapter';

type Unlock = { sessionId: string; controlId: string; confirmed: boolean };
const registry = globalThis as typeof globalThis & { mediflowAgentUnlocks?: Map<string, Unlock> };
const unlocks = registry.mediflowAgentUnlocks ??= new Map<string, Unlock>();
const ticketRef = (ticket: string) => createHash('sha256').update(ticket).digest('hex');

export function beginAgentUnlock(sessionId: string, controlId: string): string | null {
    const session = resolve(sessionId, controlId);
    if (session.status !== 'active' || session.projection.role !== 'admin') return null;
    const port = mintResourcePort(session.projection);
    if (!port) return null;
    try {
        const ticket = randomBytes(32).toString('base64url');
        const ref = ticketRef(ticket);
        if (!registerPrivateResource(port, () => { unlocks.delete(ref); })) return null;
        unlocks.set(ref, { sessionId, controlId, confirmed: false });
        return ticket;
    } finally {
        releaseResourcePort(port);
    }
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

export function isAgentUnlockActive(ref: string, actorRef: string): boolean {
    const unlock = unlocks.get(ref);
    return Boolean(unlock?.confirmed && currentAdmin(unlock, actorRef));
}
