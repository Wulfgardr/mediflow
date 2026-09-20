/* @Codex: bounded consumer preconditions, never a source of auth/selection authority. */
import { randomBytes } from 'node:crypto';
import type * as LifecycleOwner from './web-auth-lifecycle-owner-adapter.ts';

export type PatientCreateOwner = Pick<typeof LifecycleOwner,
    'mintResourcePort' | 'releaseResourcePort' | 'beginResourceUse' | 'commitResourceUse'
    | 'abortResourceUse' | 'withCurrentResourceBinding' | 'registerPrivateResource'
    | 'unregisterPrivateResource'>;
export type PatientCreateSession = LifecycleOwner.WebSessionProjection;
export type PatientCreatePrecondition = Readonly<{ nonce: string; ambulatoryId: string }>;
export type PatientCreatePreviewContext = PatientCreatePrecondition & Readonly<{
    version: 1; ambulatoryName: string; expiresAt: number;
}>;
export const PATIENT_CREATE_CONTEXT_LIMITS = Object.freeze({ ttlMs: 300_000, capacity: 128, perGeneration: 8 });
export const PATIENT_CREATE_HEADERS = Object.freeze({
    mode: 'X-MediFlow-Patient-Create-Mode',
    context: 'X-MediFlow-Patient-Create-Context',
    target: 'X-MediFlow-Patient-Create-Target',
});
export type PatientCreateLane =
    | Readonly<{ kind: 'legacy' }>
    | Readonly<{ kind: 'invalid' }>
    | Readonly<{ kind: 'fenced'; precondition: PatientCreatePrecondition }>;
const noncePattern = /^[a-f0-9]{64}$/u;
function validTarget(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 128
        && !/[\u0000-\u0020\u007f]/u.test(value);
}
export function readPatientCreateLane(headers: Pick<Headers, 'get'>): PatientCreateLane {
    const mode = headers.get(PATIENT_CREATE_HEADERS.mode);
    const nonce = headers.get(PATIENT_CREATE_HEADERS.context);
    const ambulatoryId = headers.get(PATIENT_CREATE_HEADERS.target);
    if (mode === null && nonce === null && ambulatoryId === null) return { kind: 'legacy' };
    if (mode !== 'fixed-preview-v1' || nonce === null || !noncePattern.test(nonce) || !validTarget(ambulatoryId)) {
        return { kind: 'invalid' };
    }
    return { kind: 'fenced', precondition: { nonce, ambulatoryId } };
}

type Entry = {
    preview: PatientCreatePreviewContext;
    principalRef: string;
    generation: LifecycleOwner.WebAuthenticationGeneration;
    port: LifecycleOwner.WebResourcePort;
    registration?: LifecycleOwner.WebResourceRegistration;
};

/** Receives the unchanged exported physical owner interface. No auth state is minted here. */
export class PatientCreateContextRegistry {
    private readonly entries = new Map<string, Entry>();
    private readonly owner: PatientCreateOwner;
    private readonly clock: () => number;
    constructor(owner: PatientCreateOwner, clock: () => number = Date.now) {
        this.owner = owner;
        this.clock = clock;
    }
    private binding(session: PatientCreateSession): LifecycleOwner.WebResourceBinding | null {
        const port = this.owner.mintResourcePort(session);
        if (!port) return null;
        let use: LifecycleOwner.WebResourceUse | null = null;
        try {
            use = this.owner.beginResourceUse(port);
            if (!use) return null;
            let result: LifecycleOwner.WebResourceBinding | null = null;
            const allowed = this.owner.withCurrentResourceBinding(use, value => { result = value; });
            return allowed && this.owner.commitResourceUse(use) ? result : null;
        } finally {
            if (use) this.owner.abortResourceUse(use);
            this.owner.releaseResourcePort(port);
        }
    }
    private remove(entry: Entry): void {
        this.entries.delete(entry.preview.nonce);
        if (entry.registration) this.owner.unregisterPrivateResource(entry.port, entry.registration);
        this.owner.releaseResourcePort(entry.port);
    }
    private live(entry: Entry): boolean {
        const now = this.clock();
        return Number.isSafeInteger(now) && now < entry.preview.expiresAt
            && this.entries.get(entry.preview.nonce) === entry;
    }
    private prune(): void {
        const now = this.clock();
        for (const entry of this.entries.values()) {
            if (!Number.isSafeInteger(now) || now >= entry.preview.expiresAt) this.remove(entry);
        }
    }
    capture(session: PatientCreateSession, target: Readonly<{ id: string; name: string }>): PatientCreatePreviewContext | null {
        this.prune();
        if (!validTarget(target.id) || typeof target.name !== 'string' || target.name.length === 0
            || target.name.length > 512 || this.entries.size >= PATIENT_CREATE_CONTEXT_LIMITS.capacity) return null;
        const binding = this.binding(session);
        const now = this.clock();
        if (!binding || !Number.isSafeInteger(now)) return null;
        let count = 0;
        for (const entry of this.entries.values()) if (entry.generation === binding.authenticationGeneration) count += 1;
        if (count >= PATIENT_CREATE_CONTEXT_LIMITS.perGeneration) return null;
        const expiresAt = Math.min(now + PATIENT_CREATE_CONTEXT_LIMITS.ttlMs, session.expiresAt);
        if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return null;
        let nonce: string;
        try { nonce = randomBytes(32).toString('hex'); } catch { return null; }
        if (this.entries.has(nonce)) return null;
        const port = this.owner.mintResourcePort(session);
        if (!port) return null;
        const preview: PatientCreatePreviewContext = Object.freeze({ version: 1, nonce,
            ambulatoryId: target.id, ambulatoryName: target.name, expiresAt,
        });
        const entry: Entry = { preview, principalRef: binding.principalRef,
            generation: binding.authenticationGeneration, port };
        // The owner owns disposal. Calling the owner again here would be reentrant.
        const registration = this.owner.registerPrivateResource(port, () => { this.entries.delete(nonce); });
        if (!registration) { this.owner.releaseResourcePort(port); return null; }
        entry.registration = registration;
        this.entries.set(nonce, entry);
        return preview;
    }

    /** Call ONLY inside the synchronous DB transaction; false must cause rollback. */
    withCurrentBinding(session: PatientCreateSession, precondition: PatientCreatePrecondition,
        operation: (ambulatoryId: string) => void): boolean {
        this.prune();
        if (!precondition || !noncePattern.test(precondition.nonce) || !validTarget(precondition.ambulatoryId)) return false;
        const entry = this.entries.get(precondition.nonce);
        if (!entry || entry.preview.ambulatoryId !== precondition.ambulatoryId) return false;
        const requestBinding = this.binding(session);
        if (!requestBinding || requestBinding.authenticationGeneration !== entry.generation
            || requestBinding.principalRef !== entry.principalRef) return false;
        const use = this.owner.beginResourceUse(entry.port);
        if (!use) return false;
        try {
            let called = false;
            const allowed = this.owner.withCurrentResourceBinding(use, binding => {
                if (binding.authenticationGeneration !== entry.generation || binding.principalRef !== entry.principalRef
                    || !this.live(entry)) return;
                const result = operation(entry.preview.ambulatoryId);
                if (result !== undefined) throw new Error('Patient create callback must be synchronous and void.');
                called = true;
            });
            // The callback may have inserted rows and the owner STILL may deny here.
            // Neither this method nor its callback commits a database transaction.
            if (!allowed || !called || !this.live(entry)) return false;
            return this.owner.commitResourceUse(use) && this.live(entry);
        } finally {
            this.owner.abortResourceUse(use);
        }
    }
}

// Next may bundle routes separately. Share only bounded precondition entries in this
// process; NOT the selected ambulatory, nor a second authentication owner.
const registryKey = Symbol.for('mediflow.patient-create-context.v1');
type RegistryGlobal = typeof globalThis & { [registryKey]?: PatientCreateContextRegistry };
export function patientCreateContexts(owner: PatientCreateOwner): PatientCreateContextRegistry {
    const shared = globalThis as RegistryGlobal;
    return shared[registryKey] ??= new PatientCreateContextRegistry(owner);
}
