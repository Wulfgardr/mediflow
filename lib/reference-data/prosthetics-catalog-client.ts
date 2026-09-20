/* @Codex */
import { PROSTHETICS_MAX_BYTES } from './prosthetics-catalog-contract';
export type ProstheticsSource = { sourceName: string; base64: string };
export class ProstheticsClientError extends Error {
    readonly code: string;
    constructor(code: string, message: string) { super(message); this.code = code; }
}
export async function prostheticsRequest<T>(action: string, signal: AbortSignal, body?: unknown): Promise<T> {
    const response = await fetch(`/api/prosthetics/catalog/${action}`, {
        method: body ? 'POST' : 'GET', cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(35_000)]),
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    const value = await response.json();
    signal.throwIfAborted();
    if (!response.ok) throw new ProstheticsClientError(value.error ?? 'REQUEST_FAILED', value.message ?? 'Sessione non disponibile. Accedi e riprova.');
    return value as T;
}
export async function readProstheticsSource(file: File, signal: AbortSignal): Promise<ProstheticsSource> {
    if (file.size > PROSTHETICS_MAX_BYTES) throw new Error('Il file supera il limite di 2 MiB.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    signal.throwIfAborted();
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return { sourceName: file.name, base64: btoa(binary) };
}
