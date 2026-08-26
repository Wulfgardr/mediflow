/* @Codex */
export type AuthHealthErrorCategory =
    | 'native-dependency-invalid'
    | 'native-dependency-missing'
    | 'db-missing'
    | 'data-dir-unavailable'
    | 'schema-missing'
    | 'query-failed'
    | 'unknown';

/* @Codex */
export type AuthHealthPayload = {
    status: 'ok' | 'error';
    isSetup?: boolean;
    hasSession?: boolean;
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
};

type SetupResponsePayload = {
    success?: boolean;
    error?: string;
    code?: string;
};

type RepairDbPayload = {
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
function isExactParsedApplicationLockReceipt(value: unknown): boolean {
    if (typeof value !== 'object' || value === null || !hasUnchangedObjectPrototype()) return false;

    try {
        if (lockObjectGetPrototypeOf(value) !== lockObjectPrototype) return false;
        const keys = lockReflectOwnKeys(value);
        if (keys.length !== 2 || keys[0] !== 'schemaVersion' || keys[1] !== 'state') return false;

        const schemaVersion = lockObjectGetOwnPropertyDescriptor(value, 'schemaVersion');
        const state = lockObjectGetOwnPropertyDescriptor(value, 'state');
        if (!schemaVersion || !state
            || !schemaVersion.enumerable || !state.enumerable
            || !lockObjectHasOwn(schemaVersion, 'value') || !lockObjectHasOwn(state, 'value')) {
            return false;
        }

        return schemaVersion.value === APPLICATION_LOCK_RECEIPT_SCHEMA_VERSION
            && state.value === 'server_invalidation_confirmed';
    } catch {
        return false;
    }
}

/* @Codex */
export async function requestApplicationLockConfirmation(): Promise<boolean> {
    const response = await fetch('/api/auth/lock', {
        method: 'POST',
        credentials: 'same-origin',
    });
    const text = await response.text();
    if (response.status !== 200 || !text) return false;

    let payload: unknown;
    try {
        payload = lockJsonParse(text) as unknown;
    } catch {
        return false;
    }

    return isExactParsedApplicationLockReceipt(payload);
}

/* @Codex */
export type ClientAuthorityNetworkBarrier = Readonly<{
    run: <T>(request: () => Promise<T>) => Promise<T>;
}>;

/* @Codex */
export function createClientAuthorityNetworkBarrier(): ClientAuthorityNetworkBarrier {
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
export function checkAuthHealthRequest() {
    return requestJson<AuthHealthPayload>('/api/auth/check', { cache: 'no-store' });
}

/* @Codex */
export function loginWithPinRequest(pin: string) {
    return requestJson<LoginSuccessPayload | LoginFailurePayload>('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pin }),
    });
}

/* @Codex */
export function setupSecurityRequest(payload: SetupRequestPayload) {
    return requestJson<SetupResponsePayload>('/api/auth/setup', {
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
