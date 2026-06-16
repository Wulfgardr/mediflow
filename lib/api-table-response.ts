/* @Codex */
export const MEDIFLOW_API_AUTH_UNAVAILABLE_EVENT = 'mediflow:api-auth-unavailable';

/* @Codex */
export function isApiTableAuthUnavailableStatus(status: number): boolean {
    return status === 401 || status === 403;
}

/* @Codex */
export function isApiTableUnavailableStatus(status: number): boolean {
    return isApiTableAuthUnavailableStatus(status) || status === 404;
}

/* @Codex */
export function notifyApiAuthUnavailable(status: number): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(MEDIFLOW_API_AUTH_UNAVAILABLE_EVENT, {
        detail: { status },
    }));
}

/* @Codex */
export function buildApiTableFetchErrorMessage(
    endpoint: string,
    id: string,
    status: number,
    statusText: string,
): string {
    return `Failed to fetch ${endpoint}/${id}: ${status} ${statusText}`;
}
