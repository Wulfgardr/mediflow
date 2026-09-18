/* @Codex — owned backend attempt for the four named ordinary profiles.
 * The original application owners acquire context and commit publication;
 * ordinary-flow retains those handlers across the explicit UI interactions.
 * The named egress chokepoint verifies current governance on exact bytes. */
import 'server-only';
import { randomUUID } from 'node:crypto';
import type { OrdinarySession } from '../security/ordinary-session-authority';
import type { ProductExecutionPlatform } from './execution-platform';
import type { QualifiedExecutionHost } from './execution-host';
import { createExecutionLogin } from './execution-login';
import { ExecutionError, type SynthesisCatalog, type SynthesisRequest } from './execution-contract';
import { createOrdinaryExecutionService, type OrdinaryExecutionResult } from './execution-service';
import { createOrdinaryPreparation, type OrdinaryRunnerConfiguration, type PreparedOrdinaryProfile } from './ordinary-preparation';
import type { RedactionSessionInput } from '../ai-redaction-session';
import type { OrdinaryTaskProfile } from './ordinary-task-profile';
import { createOrdinaryProductConsent, ordinaryConsentIsCurrent } from '../chatgpt-product/product-consent';
import { ProductError } from '../chatgpt-product/product-contract';

type State = 'empty' | 'preparing' | 'needs_consent' | 'consented' | 'awaiting_login' | 'connected' | 'ready' | 'completed' | 'closed';
export async function createOrdinaryProductAttempt(session: OrdinarySession, platform: ProductExecutionPlatform) {
    const owner = await import('../security/ordinary-session-authority');
    const port = owner.mintResourcePort(session);
    if (!port) throw new ProductError('session_expired');
    const authorityExpiry = owner.readResourceExpiresAt(port, session.expiresAt);
    if (authorityExpiry === null || authorityExpiry <= Date.now()) { owner.releaseResourcePort(port); throw new ProductError('session_expired'); }
    const controller = new AbortController();
    const attemptRevision = randomUUID();
    let active = true, busy = false, state: State = 'empty', epoch = 0;
    let deadline = 0, expiresAt = authorityExpiry, qualificationRevision = '';
    let contextRevision = '';
    let selectionSignal: AbortSignal | undefined;
    let job: ReturnType<typeof createOrdinaryPreparation> | undefined;
    let preparation: PreparedOrdinaryProfile | undefined;
    let consent: Awaited<ReturnType<typeof createOrdinaryProductConsent>> | undefined;
    let host: QualifiedExecutionHost | undefined;
    let login: ReturnType<typeof createExecutionLogin> | undefined;
    let execution: ReturnType<typeof createOrdinaryExecutionService> | undefined;
    let cleanup: Promise<Readonly<{ cleanupConfirmed: boolean }>> | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    let watcher: ReturnType<typeof setInterval> | undefined;
    const remaining = () => Math.max(0, Math.min(expiresAt - Date.now(), deadline ? deadline - performance.now() : Infinity));
    const local = () => active && !controller.signal.aborted && !selectionSignal?.aborted && remaining() > 0;
    function current(): boolean {
        if (!local()) return false;
        const use = owner.beginResourceUse(port); if (!use) return false;
        owner.abortResourceUse(use); return local();
    }
    function guard(expected = epoch) {
        if (!current() || expected !== epoch) throw new ProductError('revoked');
        if (qualificationRevision) {
            const qualification = platform.snapshot();
            if (qualification.state !== 'qualified' || qualification.revision !== qualificationRevision) throw new ProductError('unqualified_boundary');
        }
    }
    /** Called synchronously by owner/selection retirement; cleanup runs outside binding. */
    function dispose(): Promise<Readonly<{ cleanupConfirmed: boolean }>> {
        if (cleanup) return cleanup;
        active = false; epoch++; state = 'closed'; controller.abort();
        clearTimeout(expiry); clearInterval(watcher);
        selectionSignal?.removeEventListener('abort', retire);
        consent?.close(); login?.dispose();
        // Close content immediately (maps become unusable before awaiting cleanup).
        const contentClose = job?.close();
        cleanup = Promise.resolve().then(async () => {
            let confirmed = true;
            try { await execution?.dispose(); } catch { confirmed = false; }
            try { await contentClose; } catch { confirmed = false; }
            try { await host?.close(); } catch { confirmed = false; }
            try { await platform.close?.(); } catch { confirmed = false; }
            if (host && !host.cleanupComplete()) confirmed = false;
            if (platform.preparation && !['not_prepared', 'closed'].includes(platform.preparation().state)) confirmed = false;
            if (registration) owner.unregisterPrivateResource(port, registration);
            owner.releaseResourcePort(port);
            return Object.freeze({ cleanupConfirmed: confirmed });
        });
        void cleanup.catch(() => {});
        return cleanup;
    }
    const retire = () => { void dispose(); };
    let registration: ReturnType<typeof owner.registerPrivateResource> = null;
    registration = owner.registerPrivateResource(port, retire);
    if (!registration || !current()) { await dispose(); throw new ProductError('session_expired'); }
    expiry = setTimeout(retire, remaining()); expiry.unref?.();
    async function operation<T>(allowed: readonly State[], work: (expected: number) => Promise<T>): Promise<T> {
        guard();
        if (busy) throw new ProductError('busy');
        if (!allowed.includes(state)) throw new ProductError('invalid_state');
        busy = true; const expected = ++epoch;
        try { const result = await work(expected); guard(expected); return result; }
        catch (error) {
            if (error instanceof ProductError && error.code === 'login_pending') throw error;
            await dispose(); throw error instanceof ExecutionError || error instanceof ProductError ? error : new ProductError('upstream_error');
        } finally { if (expected === epoch) busy = false; }
    }
    return Object.freeze({
        /** No content, account secret, map or ordinary output in this projection. */
        snapshot() { guard(); return Object.freeze({ state, attemptRevision, contextRevision, qualificationRevision, expiresAt }); },
        prepare(profile: OrdinaryTaskProfile, selectedContextRevision: string, configuration: OrdinaryRunnerConfiguration, signal: AbortSignal, knownIdentifiers?: RedactionSessionInput['knownIdentifiers']) {
            return operation(['empty'], async expected => {
                if (typeof selectedContextRevision !== 'string' || !selectedContextRevision || selectedContextRevision.length > 256 || !signal) throw new ProductError('invalid_request');
                contextRevision = selectedContextRevision;
                selectionSignal = signal; selectionSignal.addEventListener('abort', retire, { once: true });
                expiresAt = Math.min(expiresAt, Date.now() + 300_000);
                deadline = performance.now() + Math.max(0, expiresAt - Date.now());
                clearTimeout(expiry); expiry = setTimeout(retire, remaining()); expiry.unref?.();
                // Watch platform qualification, NOT the intentional draining host witness.
                watcher = setInterval(() => { try { guard(); } catch { retire(); } }, 50); watcher.unref?.();
                guard(expected); state = 'preparing';
                job = createOrdinaryPreparation(profile, configuration, controller.signal, knownIdentifiers);
                preparation = await job.ready; guard(expected);
                if (platform.prepare) await platform.prepare(controller.signal, remaining());
                guard(expected);
                const qualification = platform.snapshot();
                if (qualification.state !== 'qualified') throw new ProductError('unqualified_boundary');
                qualificationRevision = qualification.revision;
                consent = await createOrdinaryProductConsent(session, preparation, { contextRevision, attemptRevision, qualificationRevision, remainingMs: remaining() });
                guard(expected); state = 'needs_consent'; return consent.disclosure();
            });
        },
        consent(request: unknown) { return operation(['needs_consent'], async () => { consent!.grant(request); state = 'consented'; }); },
        loginStart() {
            return operation(['consented'], async expected => {
                const owned = await platform.create(controller.signal);
                // A late host is never adopted or abandoned by a newer attempt.
                try { guard(expected); if (!owned.boundaryQualified()) throw new ProductError('unqualified_boundary'); } catch (error) { await owned.close(); throw error; }
                host = owned;
                login = createExecutionLogin(host.transport, () => { guard(); }, () => {}, retire, host.cwd);
                const challenge = await login.start(); guard(expected); state = 'awaiting_login'; return challenge;
            });
        },
        loginComplete() {
            return operation(['awaiting_login'], async expected => {
                const plan = await login!.complete(); guard(expected);
                execution = createOrdinaryExecutionService({ transport: host!.transport, cwd: host!.cwd,
                    preparation: preparation!, consent: consent!.token, isCurrent: current,
                    boundaryQualified: () => local() && platform.snapshot().revision === qualificationRevision && host!.boundaryQualified() });
                state = 'connected'; return Object.freeze({ plan });
            });
        },
        models() { return operation(['connected', 'ready'], async expected => { const catalog = await execution!.readCatalog(); guard(expected); state = 'ready'; return catalog; }); },
        generate(request: SynthesisRequest) {
            return operation(['ready'], async expected => {
                const result = await execution!.generate(request, controller.signal);
                guard(expected); state = 'completed'; return result;
            });
        },
        /** Only a local witness. The original function owner must bind/commit. */
        isCurrent(result: SynthesisCatalog | OrdinaryExecutionResult): boolean {
            return local() && !!consent && !!preparation && ordinaryConsentIsCurrent(consent.token, preparation)
                && platform.snapshot().revision === qualificationRevision && !!execution && execution.isCurrent(result);
        },
        dispose,
    });
}
