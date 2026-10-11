/* @Codex */
import type { PassphraseAdoptionPayload, PassphraseChangePayload, PassphraseRecoveryPayload } from './passphrase-adoption-validation';

export type AuthHealthErrorCategory =
    | 'native-dependency-invalid'
    | 'native-dependency-missing'
    | 'db-missing'
    | 'data-dir-unavailable'
    | 'schema-missing'
    | 'query-failed'
    | 'unknown';

/** ADR 0143: what the browser learns before it authenticates. Only a passphrase account discloses its salt. */
export type UnlockParameters =
    | { credential: 'pin' }
    | { credential: 'passphrase'; kdfVersion: number; salt: string };

/**
 * The check response is untrusted input. Null unless it says, in a well-formed way, what unlocks
 * the account: with null the caller sends nothing, because what was typed may be a passphrase
 * and only a PIN may travel as it is.
 */
export function readUnlockParameters(value: unknown): UnlockParameters | null {
    const unlock = value && typeof value === 'object' ? value as Record<string, unknown> : null;
    if (unlock?.credential === 'pin') return { credential: 'pin' };
    if (unlock?.credential === 'passphrase' && Number.isInteger(unlock.kdfVersion)
        && typeof unlock.salt === 'string' && unlock.salt) {
        return { credential: 'passphrase', kdfVersion: unlock.kdfVersion as number, salt: unlock.salt };
    }
    return null;
}

/* @Codex */
export type AuthHealthPayload = {
    archiveGeneration?: string;
    status: 'ok' | 'error';
    isSetup?: boolean;
    hasSession?: boolean;
    unlock?: unknown;
    error?: {
        code?: string;
        category?: AuthHealthErrorCategory;
        message?: string;
        remediationCommand?: string;
        nextAction?: string;
    };
    db?: {
        state?: 'ready' | 'missing' | 'schema-missing' | 'unavailable';
    };
};

/* @Codex */
export type LoginFailurePayload = {
    error?: string;
    code?: string;
    message?: string;
    lockedUntil?: string;
    remainingAttempts?: number;
    retryAfterSeconds?: number;
};

type LoginSuccessPayload = {
    archiveGeneration: string;
    id: string;
    username: string;
    displayName?: string;
    ambulatoryName?: string;
    role: string;
    encryptedMasterKey: string;
    salt: string | number[];
};

type SetupRequestPayload = {
    username: string;
    password: string;
    encryptedMasterKey: string;
    salt: string;
    displayName: string;
    ambulatoryName: string;
    verifier?: string;
    recovery?: { wrappedMasterKey: string; salt: string; verifier: string };
};

type SetupResponsePayload = {
    success?: boolean;
    error?: string;
    code?: string;
};

type RepairDbPayload = {
    status?: 'accepted';
    requestId?: string;
    success?: boolean;
    error?: string;
    backupCreated?: boolean;
};

type PinChangeRequestPayload = {
    currentPin: string;
    newPin: string;
    encryptedMasterKey: string;
    salt: string;
};

export type PinChangeFailurePayload = {
    success?: boolean;
    error?: string;
    code?: string;
    message?: string;
};

type JsonRequestResult<T> = {
    response: Response;
    payload: T | null;
};

/* @Codex */
export type AuthControlResponseState = 'accepted' | 'stale' | 'invalid';

/* @Codex */
type AuthControlledJsonRequestResult<T> = JsonRequestResult<T> & {
    controlState: AuthControlResponseState;
};

/* @Codex */
const AUTH_CONTROL_ETAG_MAX_LENGTH = 512;
/* @Codex */
let currentAuthControlEtag: string | null = null;
/* @Codex */
let authHealthRequestInFlight: Promise<AuthControlledJsonRequestResult<AuthHealthPayload>> | null = null;

/* @Codex */
function strongAuthControlEtag(response: Response): string | null {
    const value = response.headers.get('ETag');
    if (!value || value.length > AUTH_CONTROL_ETAG_MAX_LENGTH || value.startsWith('W/')) return null;
    if (!/^"[\x21\x23-\x7e]+"$/u.test(value)) return null;
    return value;
}

/* @Codex */
function retainAuthControlEtag(
    response: Response,
    expected: string | null,
): Readonly<{ etag: string | null; state: AuthControlResponseState }> {
    const next = strongAuthControlEtag(response);
    if (currentAuthControlEtag !== expected) return { etag: next, state: 'stale' };
    if (!next) return { etag: null, state: 'invalid' };
    currentAuthControlEtag = next;
    return { etag: next, state: 'accepted' };
}

/* @Codex */
function createAuthMutationKey(): string {
    const key = globalThis.crypto.randomUUID();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(key)) {
        throw new Error('Secure auth mutation key unavailable.');
    }
    return key;
}

/* @Codex */
function authMutationInit(init: RequestInit, etag: string, idempotencyKey: string): RequestInit {
    const headers = new Headers(init.headers);
    headers.set('If-Match', etag);
    headers.set('Idempotency-Key', idempotencyKey);
    return { ...init, credentials: 'same-origin', headers };
}

async function parseJsonResponse<T>(response: Response): Promise<T | null> {
    const text = await response.text();
    if (!text) return null;

    try {
        return JSON.parse(text) as T;
    } catch {
        return null;
    }
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<JsonRequestResult<T>> {
    const response = await fetch(input, init);
    const payload = await parseJsonResponse<T>(response);
    return { response, payload };
}

/* @Codex */
export const APPLICATION_LOCK_RECEIPT_SCHEMA_VERSION = 'mediflow.application-lock-receipt.v1' as const;

/* @Codex */
const lockJsonParse = JSON.parse;
/* @Codex */
const lockObjectGetPrototypeOf = Object.getPrototypeOf;
/* @Codex */
const lockObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
/* @Codex */
const lockObjectHasOwn = Object.hasOwn;
/* @Codex */
const lockReflectOwnKeys = Reflect.ownKeys;
/* @Codex */
const lockObjectPrototype = Object.prototype;
/* @Codex */
const lockObjectPrototypeKeys = Object.freeze(lockReflectOwnKeys(lockObjectPrototype).slice());
/* @Codex */
const forbiddenLockObjectPrototypeKeys = Object.freeze(['then', 'value', 'schemaVersion', 'state'] as const);

/* @Codex */
function hasForbiddenObjectPrototypeDescriptor(): boolean {
    try { return forbiddenLockObjectPrototypeKeys.some((key) => lockObjectGetOwnPropertyDescriptor(lockObjectPrototype, key) !== undefined); }
    catch { return true; }
}

/* @Codex */
function hasUnchangedObjectPrototype(): boolean {
    try {
        const currentKeys = lockReflectOwnKeys(lockObjectPrototype);
        if (currentKeys.length !== lockObjectPrototypeKeys.length) return false;
        for (let index = 0; index < currentKeys.length; index += 1) {
            if (currentKeys[index] !== lockObjectPrototypeKeys[index]) return false;
        }
        return true;
    } catch {
        return false;
    }
}

/* @Codex */
function exactParsedApplicationLockReceiptState(value: unknown): 'server_invalidation_confirmed' | 'server_invalidation_unconfirmed' | null {
    if (typeof value !== 'object' || value === null || hasForbiddenObjectPrototypeDescriptor() || !hasUnchangedObjectPrototype()) return null;

    try {
        if (lockObjectGetPrototypeOf(value) !== lockObjectPrototype) return null;
        const keys = lockReflectOwnKeys(value);
        if (keys.length !== 2 || keys[0] !== 'schemaVersion' || keys[1] !== 'state') return null;

        const schemaVersion = lockObjectGetOwnPropertyDescriptor(value, 'schemaVersion');
        const state = lockObjectGetOwnPropertyDescriptor(value, 'state');
        if (!schemaVersion || !state
            || !schemaVersion.enumerable || !state.enumerable
            || !lockObjectHasOwn(schemaVersion, 'value') || !lockObjectHasOwn(state, 'value')) {
            return null;
        }

        if (schemaVersion.value !== APPLICATION_LOCK_RECEIPT_SCHEMA_VERSION) return null;
        if (state.value === 'server_invalidation_confirmed' || state.value === 'server_invalidation_unconfirmed') {
            return state.value;
        }
        return null;
    } catch {
        return null;
    }
}

/* @Codex */
export async function requestApplicationLockConfirmation(): Promise<boolean> {
    const initialEtag = currentAuthControlEtag;
    if (!initialEtag) return false;

    const send = async (etag: string, idempotencyKey: string) => {
        const execute = async () => {
            const response = await fetch('/api/auth/lock', authMutationInit({ method: 'POST' }, etag, idempotencyKey));
            const responseEtag = retainAuthControlEtag(response, etag).etag;
            const text = await response.text();
            if (!text) return { response, responseEtag, state: null } as const;

            let payload: unknown;
            try {
                payload = lockJsonParse(text) as unknown;
            } catch {
                return { response, responseEtag, state: null } as const;
            }
            return { response, responseEtag, state: exactParsedApplicationLockReceiptState(payload) } as const;
        };

        try {
            return await execute();
        } catch {
            // A lost response, including a failed body read, replays the same logical operation with the same key.
            return execute();
        }
    };

    const first = await send(initialEtag, createAuthMutationKey());
    if (first.response.status === 200 && first.state === 'server_invalidation_confirmed') return true;
    if (first.response.status !== 409
        || first.state !== 'server_invalidation_unconfirmed'
        || !first.responseEtag) return false;

    // One stale-fence retry is allowed. It is a new operation and therefore uses a new key.
    const retry = await send(first.responseEtag, createAuthMutationKey());
    return retry.response.status === 200 && retry.state === 'server_invalidation_confirmed';
}

/* @Codex */
export type ClientAuthorityNetworkBarrier = Readonly<{
    run: <T>(request: () => Promise<T>) => Promise<T>;
}>;

/* @Codex */
export function createClientAuthorityNetworkBarrier(): ClientAuthorityNetworkBarrier {
    // Serializes login/setup starts. Application lock deliberately bypasses this barrier.
    let tail = Promise.resolve();

    return Object.freeze({
        run<T>(request: () => Promise<T>): Promise<T> {
            const previous = tail;
            let settleCurrent: () => void = () => undefined;
            const current = new Promise<void>((resolve) => {
                settleCurrent = resolve;
            });
            tail = previous.then(() => current, () => current);

            return (async () => {
                await previous;
                try {
                    return await request();
                } finally {
                    settleCurrent();
                }
            })();
        },
    });
}

/* @Codex */
export async function checkAuthHealthRequest(options: { fresh?: boolean } = {}) {
    // A caller that decides what to send needs an answer produced after its gesture: one already
    // on its way was produced before, so it is awaited and asked again.
    while (authHealthRequestInFlight) {
        if (!options.fresh) return authHealthRequestInFlight;
        await authHealthRequestInFlight.catch(() => undefined);
    }

    const expectedEtag = currentAuthControlEtag;
    const request = (async (): Promise<AuthControlledJsonRequestResult<AuthHealthPayload>> => {
        const result = await requestJson<AuthHealthPayload>('/api/auth/check', {
            cache: 'no-store',
            credentials: 'same-origin',
        });
        if (result.response.ok && result.payload?.status === 'ok') observeArchiveGeneration(result.payload.archiveGeneration);
        const observation = retainAuthControlEtag(result.response, expectedEtag);
        return { ...result, controlState: observation.state };
    })();
    authHealthRequestInFlight = request;

    try {
        return await request;
    } finally {
        if (authHealthRequestInFlight === request) authHealthRequestInFlight = null;
    }
}

/* @Codex */
async function requestAuthMutationJson<T>(
    input: RequestInfo | URL,
    init: RequestInit,
): Promise<AuthControlledJsonRequestResult<T>> {
    const etag = currentAuthControlEtag;
    if (!etag) throw new Error('Auth control fence unavailable.');
    const response = await fetch(input, authMutationInit(init, etag, createAuthMutationKey()));
    const observation = retainAuthControlEtag(response, etag);
    let payload: T | null;
    try {
        payload = await parseJsonResponse<T>(response);
    } catch {
        return { response, payload: null, controlState: response.ok ? 'invalid' : observation.state };
    }
    const controlState = response.ok && observation.state === 'accepted' && observation.etag === etag
        ? 'invalid'
        : observation.state;
    if (response.ok && typeof payload === 'object' && payload !== null && 'archiveGeneration' in payload) {
        observeArchiveGeneration((payload as { archiveGeneration: unknown }).archiveGeneration);
    }
    return { response, payload, controlState };
}

/* @Codex */
export function loginWithPinRequest(pin: string) {
    return requestAuthMutationJson<LoginSuccessPayload | LoginFailurePayload>('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pin }),
    });
}

/** ADR 0143: an account with a passphrase sends the verifier derived from it; the passphrase stays in the browser. */
export function loginWithVerifierRequest(verifier: string) {
    return requestAuthMutationJson<LoginSuccessPayload | LoginFailurePayload>('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verifier }),
    });
}

/* @Codex */
export function setupSecurityRequest(payload: SetupRequestPayload) {
    return requestAuthMutationJson<SetupResponsePayload>('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
}

/* @Codex */
export function changePinRequest(payload: PinChangeRequestPayload) {
    return requestJson<PinChangeFailurePayload>('/api/auth/change-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
}

export function adoptPassphraseRequest(payload: PassphraseAdoptionPayload) {
    return requestJson<PinChangeFailurePayload & { earlierCopiesCleared?: boolean }>('/api/auth/passphrase', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
}

export function changePassphraseRequest(payload: PassphraseChangePayload) {
    return requestJson<PinChangeFailurePayload>('/api/auth/passphrase/change', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
}

export function recoverPassphraseRequest(payload: PassphraseRecoveryPayload) {
    return requestAuthMutationJson<PinChangeFailurePayload>('/api/auth/passphrase/recover', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
}

/* @Codex */
export function rewrapMasterKeyRequest(payload: { encryptedMasterKey: string; salt: string }) {
    return requestJson<{ success?: boolean; error?: string; code?: string }>('/api/auth/rewrap-master-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
}

/* @Codex */
export function repairLegacyDbRequest() {
    return requestJson<RepairDbPayload>('/api/system/repair-db', { method: 'POST' });
}

const GENERATION = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export const ARCHIVE_REPLACED_EVENT = 'mediflow:archive-replaced';
let documentGeneration: string | null = null;

/** Never relatch a document that still contains records from the preceding archive. */
export function rejectReplacedArchive(): never {
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(ARCHIVE_REPLACED_EVENT));
        window.location.reload();
    }
    throw new Error('ARCHIVE_REPLACED');
}

export function observeArchiveGeneration(value: unknown): void {
    if (typeof value !== 'string' || !GENERATION.test(value)) throw new Error('Archive generation unavailable.');
    if (documentGeneration === null) { documentGeneration = value; return; }
    if (documentGeneration === value) return;
    rejectReplacedArchive();
}

/** One document-wide transport fence also reaches controllers that use plain fetch. */
export function installArchiveGenerationTransport(): () => void {
    const original = window.fetch;
    const guarded: typeof fetch = (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
        const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
        if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')
            || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return original(input, init);
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        // A caller cannot silently change which archive this document has displayed.
        if (documentGeneration) headers.set('x-mediflow-archive-generation', documentGeneration);
        else headers.delete('x-mediflow-archive-generation');
        return original(input, { ...init, headers }).then(async response => {
            if (response.status === 409) {
                const payload = await response.clone().json().catch(() => null);
                if (payload?.code === 'ARCHIVE_REPLACED') rejectReplacedArchive();
            }
            return response;
        });
    };
    window.fetch = guarded;
    return () => { if (window.fetch === guarded) window.fetch = original; };
}
