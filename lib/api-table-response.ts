export const MEDIFLOW_API_AUTH_UNAVAILABLE_EVENT = 'mediflow:api-auth-unavailable';

export function isApiTableAuthUnavailableStatus(status: number): boolean {
    return status === 401 || status === 403;
}

export function isApiTableUnavailableStatus(status: number): boolean {
    return isApiTableAuthUnavailableStatus(status) || status === 404;
}

export function notifyApiAuthUnavailable(status: number): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(MEDIFLOW_API_AUTH_UNAVAILABLE_EVENT, {
        detail: { status },
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
