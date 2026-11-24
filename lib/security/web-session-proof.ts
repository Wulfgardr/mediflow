import { createHash } from 'node:crypto';
import { LOCAL_CLIENT_SESSION_PROOF_HEADER, WEB_SESSION_PROOF_HEADER } from './web-session-proof-header.ts';

type Proof = Readonly<{ kind: 'web' | 'local-client'; digest: string }>;
type Binding = {
    sessionId: string;
    expiresAt: number;
    kind: Proof['kind'];
    digests: Set<string>;
    expire?: () => void;
};

const proofPattern = /^[a-f0-9]{64}$/u;
const tabGrantLifetimeMs = 10_000;
const maxTabProofs = 32;

export function presentedWebSessionProof(headers: Pick<Headers, 'get'>): Proof | null {
    const browser = headers.get(WEB_SESSION_PROOF_HEADER);
    const local = headers.get(LOCAL_CLIENT_SESSION_PROOF_HEADER);
    if ((browser === null) === (local === null)) return null;
    const proof = browser ?? local;
    if (!proof || !proofPattern.test(proof)) return null;
    return { kind: local === null ? 'web' : 'local-client', digest: createHash('sha256').update(proof).digest('hex') };
}

function matches(binding: Binding, presented: Proof | null): boolean {
    return presented !== null && binding.kind === presented.kind && binding.digests.has(presented.digest);
}

export function createWebSessionProofBindings(now = Date.now) {
    const controls = new Map<string, Binding>();
    const grants = new Map<string, { controlId: string; binding: Binding; expiresAt: number }>();

    function current(controlId: string): Binding | undefined {
        const binding = controls.get(controlId);
        if (binding && binding.expiresAt <= now()) {
            controls.delete(controlId);
            binding.expire?.();
            return undefined;
        }
        return binding;
    }

    return Object.freeze({
        bind(controlId: string, sessionId: string, expiresAt: number, proof: Proof, expire?: () => void) {
            for (const control of controls.keys()) current(control);
            const binding = { sessionId, expiresAt, kind: proof.kind, digests: new Set([proof.digest]), expire };
            controls.set(controlId, binding);
            return () => {
                if (controls.get(controlId) === binding) controls.delete(controlId);
                for (const [digest, grant] of grants) if (grant.binding === binding) grants.delete(digest);
            };
        },
        admits(controlId: string, sessionId: string, proof: Proof | null): boolean {
            const binding = current(controlId);
            return binding?.sessionId === sessionId && matches(binding, proof);
        },
        controlAvailable(controlId: string, proof: Proof | null): boolean {
            const binding = current(controlId);
            return !binding || matches(binding, proof);
        },
        offerTab(controlId: string, sessionId: string, source: Proof | null, recipient: unknown): boolean {
            const binding = current(controlId);
            if (typeof recipient !== 'string' || !proofPattern.test(recipient) || binding?.kind !== 'web'
                || binding.sessionId !== sessionId || !matches(binding, source) || recipient === source?.digest) return false;
            const at = now();
            let outstanding = 0;
            for (const [digest, grant] of grants) {
                if (grant.expiresAt <= at || controls.get(grant.controlId) !== grant.binding) grants.delete(digest);
                else if (grant.binding === binding) outstanding++;
            }
            if (grants.has(recipient)
                || (!binding.digests.has(recipient) && binding.digests.size + outstanding >= maxTabProofs)) return false;
            grants.set(recipient, { controlId, binding, expiresAt: at + tabGrantLifetimeMs });
            return true;
        },
        acceptTab(proof: Proof | null): Readonly<{ controlId: string; sessionId: string }> | null {
            if (proof?.kind !== 'web') return null;
            const grant = grants.get(proof.digest);
            if (!grant) return null;
            grants.delete(proof.digest);
            if (grant.expiresAt <= now() || current(grant.controlId) !== grant.binding) return null;
            grant.binding.digests.add(proof.digest);
            return { controlId: grant.controlId, sessionId: grant.binding.sessionId };
        },
    });
}

const bindingsKey = Symbol.for('mediflow.web-session-proof-bindings.v1');
const processState = globalThis as typeof globalThis & {
    [bindingsKey]?: ReturnType<typeof createWebSessionProofBindings>;
};

export const webSessionProofBindings = processState[bindingsKey] ??= createWebSessionProofBindings();
