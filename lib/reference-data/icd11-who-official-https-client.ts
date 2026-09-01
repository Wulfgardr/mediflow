/* @Codex */
import type { ICD11_WHO_TOKEN_TARGET } from './icd11-who-credential-lease.ts';
import type { ICD11_WHO_TRANSPORT_TARGET } from './icd11-who-service.ts';

export type Icd11WhoOfficialHeaders = Readonly<{
    get(name: string): string | null;
}>;

export type Icd11WhoOfficialForm = Readonly<{
    get(name: string): string | null;
}>;

export type Icd11WhoOfficialQuery = Readonly<{
    get(name: string): string | null;
}>;

export type Icd11WhoOfficialTokenHttpsClientRequest = Readonly<{
    target: typeof ICD11_WHO_TOKEN_TARGET;
    protocol: 'https:';
    hostname: 'icdaccessmanagement.who.int';
    path: '/connect/token';
    method: 'POST';
    redirect: 'error';
    headers: Icd11WhoOfficialHeaders;
    form: Icd11WhoOfficialForm;
    signal: AbortSignal;
    maxRequestBytes: number;
    maxResponseBytes: number;
}>;

export type Icd11WhoOfficialSearchHttpsClientRequest = Readonly<{
    target: typeof ICD11_WHO_TRANSPORT_TARGET;
    protocol: 'https:';
    hostname: 'id.who.int';
    path: '/icd/release/11/2026-01/mms/search';
    method: 'GET';
    redirect: 'error';
    headers: Icd11WhoOfficialHeaders;
    query: Icd11WhoOfficialQuery;
    signal: AbortSignal;
    maxResponseBytes: 65_536;
}>;

export type Icd11WhoOfficialHttpsClientRequest =
    | Icd11WhoOfficialTokenHttpsClientRequest
    | Icd11WhoOfficialSearchHttpsClientRequest;

export type Icd11WhoOfficialHttpsClient = (
    request: Icd11WhoOfficialHttpsClientRequest,
) => Promise<unknown>;
