import 'server-only';
import type { dbServer } from './db-server';
import type { PatientDocumentCreateHost } from './patient-document-create-command';
import { createPatientDocumentIntake } from './native-patient-document';
import { observeNativeDocumentContext } from './security/native-document-context';
import { archiveGenerationForSession, sessionMatchesArchive } from './security/archive-session-generation';
import { verifyHostCredentials } from './security/host-credential-verification';
import * as owner from './security/web-auth-lifecycle-owner-adapter';

export type WebPatientDocumentContext = Readonly<{
    session: owner.WebSessionProjection; ambulatoryId: string; request: Request;
}>;
const deny = (): never => { throw new Error('Web patient document denied'); };

/** Current binding of the Web session, or null once it is locked, logged out or expired. */
function currentBinding(session: owner.WebSessionProjection): owner.WebResourceBinding | null {
    const port = owner.mintResourcePort(session);
    if (!port) return null;
    let use: owner.WebResourceUse | null = null;
    try {
        use = owner.beginResourceUse(port);
        if (!use) return null;
        let result: owner.WebResourceBinding | null = null;
        const allowed = owner.withCurrentResourceBinding(use, value => { result = value; });
        return allowed && owner.commitResourceUse(use) ? result : null;
    } catch { return null; }
    finally {
        if (use) owner.abortResourceUse(use);
        owner.releaseResourcePort(port);
    }
}

/** Local Web host for the shared command. The work belongs to one authentication generation of
 * one Web session: a new login, a lock or another tab with another session cannot resume it. */
function webHost() {
    return async (context: WebPatientDocumentContext): Promise<PatientDocumentCreateHost> => {
        const { session } = context;
        if (session.authChannel !== 'web' || session.role !== 'admin') return deny();
        const binding = currentBinding(session) ?? deny();
        const identity = binding.authenticationGeneration as object;
        const same = () => {
            const now = currentBinding(session);
            return now !== null && now.authenticationGeneration === identity && now.principalRef === binding.principalRef;
        };
        const lifecycle = observeNativeDocumentContext(identity, context.ambulatoryId);
        const archiveGeneration = archiveGenerationForSession(session) ?? deny();
        return {
            session: identity, actorRef: session.userId, ambulatoryId: context.ambulatoryId,
            archiveGeneration, epoch: lifecycle.epoch, surface: 'web',
            assertCurrent: () => {
                if (!lifecycle.current() || !same() || !sessionMatchesArchive(session)) {
                    lifecycle.retire();
                    deny();
                }
            },
            async confirm(pin) {
                if (!same() || !sessionMatchesArchive(session)) return false;
                try {
                    const result = await verifyHostCredentials({ username: session.username, pin });
                    return result.kind !== 'denied' && result.account.id === session.userId
                        && result.account.username === session.username && (result.account.role ?? 'user') === session.role
                        && same() && sessionMatchesArchive(session);
                } catch { return false; }
            },
            retain(dispose) {
                const port = owner.mintResourcePort(session);
                if (!port) return deny();
                let release = () => {};
                const retire = () => { try { dispose(); } finally { queueMicrotask(() => release()); } };
                const registration = owner.registerPrivateResource(port, retire);
                if (!registration) { owner.releaseResourcePort(port); return deny(); }
                let releaseContext: () => void;
                try { releaseContext = lifecycle.retain(retire); }
                catch (error) {
                    owner.unregisterPrivateResource(port, registration);
                    owner.releaseResourcePort(port);
                    throw error;
                }
                let released = false;
                release = () => {
                    if (released) return;
                    released = true;
                    releaseContext();
                    owner.unregisterPrivateResource(port, registration);
                    owner.releaseResourcePort(port);
                };
                return release;
            },
        };
    };
}

/** Same intake, extraction, review, CAS, audit and receipt as the native route; only the host differs. */
export function createWebPatientDocumentService(database: typeof dbServer, clock: () => number = Date.now) {
    return createPatientDocumentIntake(database, webHost(), clock);
}
