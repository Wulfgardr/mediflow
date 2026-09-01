/* @Codex */
import type { ICD11_WHO_TOKEN_TARGET } from './icd11-who-credential-lease.ts';

export type Icd11WhoOfficialHeaders = Readonly<{
    get(name: string): string | null;
}>;

export type Icd11WhoOfficialForm = Readonly<{
    get(name: string): string | null;
}>;

export type Icd11WhoOfficialHttpsClientRequest = Readonly<{
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

export type Icd11WhoOfficialHttpsClient = (
    request: Icd11WhoOfficialHttpsClientRequest,
) => Promise<unknown>;
