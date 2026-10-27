export const MEDIFLOW_API_AUTH_UNAVAILABLE_EVENT = 'mediflow:api-auth-unavailable';

export function isApiTableAuthUnavailableStatus(status: number): boolean {
    return status === 401 || status === 403;
}

export function isApiTableUnavailableStatus(status: number): boolean {
    return isApiTableAuthUnavailableStatus(status) || status === 404;
}

export function captureApiReadSession(getSession: () => AbortSignal | null, callerSignal?: AbortSignal) {
    const sessionSignal = getSession();
    const signal = callerSignal && sessionSignal && callerSignal !== sessionSignal
        ? AbortSignal.any([callerSignal, sessionSignal])
        : callerSignal ?? sessionSignal ?? undefined;
    const assertCurrent = () => {
        signal?.throwIfAborted();
        if (getSession() !== sessionSignal) throw new DOMException('Sessione di lettura scaduta.', 'AbortError');
    };
    return { sessionSignal, signal, assertCurrent };
}

export function notifyApiAuthUnavailable(status: number, sessionSignal: AbortSignal | null): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(MEDIFLOW_API_AUTH_UNAVAILABLE_EVENT, {
        detail: { status, sessionSignal },
    }));
}

export function buildApiTableFetchErrorMessage(
    endpoint: string,
    id: string,
    status: number,
    statusText: string,
): string {
    return `Failed to fetch ${endpoint}/${id}: ${status} ${statusText}`;
}
