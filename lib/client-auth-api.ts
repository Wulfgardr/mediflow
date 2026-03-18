/* @Codex */
export type AuthHealthPayload = {
    status: 'ok' | 'error';
    isSetup?: boolean;
    hasSession?: boolean;
    error?: {
        code?: string;
        message?: string;
    };
    db?: {
        dataDir?: string;
        dbPath?: string;
        dbExists?: boolean;
        dbReadable?: boolean;
        dbWritable?: boolean;
        dbSizeBytes?: number;
        legacyDbPath?: string;
        legacyExists?: boolean;
        schemaOk?: boolean;
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
export function logoutSecuritySession(): void {
    void fetch('/api/auth/logout', { method: 'POST' });
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
        body: JSON.stringify({ username: 'admin', password: pin }),
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
export function repairLegacyDbRequest() {
    return requestJson<RepairDbPayload>('/api/system/repair-db', { method: 'POST' });
}
