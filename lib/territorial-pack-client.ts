'use client';
/* Lettura Web della capacità territoriale dell'host (ADR 0158). Nasconde le funzioni dei pacchetti
 * spenti; l'autorità resta ai writer dell'host, che rileggono lo stato nella propria transazione. */
import { useSyncExternalStore } from 'react';
import { clientArchiveGeneration } from './security/client-auth-api';
import { TERRITORIAL_PACK_SCHEMA, territorialPackActive, type TerritorialPackCapability, type TerritorialPackPreset } from './territorial-pack-contract';

export type TerritorialPackView = { status: 'loading' | 'ready' | 'error'; capability: TerritorialPackCapability | null };
const LOADING: TerritorialPackView = { status: 'loading', capability: null };
let current: TerritorialPackView = LOADING;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: TerritorialPackView) {
    current = next;
    for (const listener of listeners) listener();
}

function parse(value: unknown): TerritorialPackCapability | null {
    const item = value as Partial<TerritorialPackCapability> | null;
    return item && item.schemaVersion === TERRITORIAL_PACK_SCHEMA && (item.status === 'ready' || item.status === 'configuration_error')
        && (item.preset === 'core' || item.preset === 'core+it' || item.preset === 'core+it+lom') ? item as TerritorialPackCapability : null;
}

export function refreshTerritorialPacks(): Promise<void> {
    inflight ??= fetch('/api/system/territorial-packs', { cache: 'no-store', credentials: 'same-origin' })
        .then(async response => {
            const capability = response.ok ? parse(await response.json()) : null;
            publish(capability ? { status: 'ready', capability } : { status: 'error', capability: null });
        })
        .catch(() => publish({ status: 'error', capability: null }))
        .finally(() => { inflight = null; });
    return inflight;
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    if (current === LOADING && !inflight) void refreshTerritorialPacks();
    return () => { listeners.delete(listener); };
}

/** `lombardy` e `italy` sono falsi finché la capacità non è letta e valida. */
export function useTerritorialPacks() {
    const view = useSyncExternalStore(subscribe, () => current, () => LOADING);
    return { ...view, italy: territorialPackActive(view.capability, 'it'), lombardy: territorialPackActive(view.capability, 'lom') };
}

export class TerritorialPackClientError extends Error {
    constructor(message: string, readonly code: string) { super(message); }
}

/** Cambio d'assetto dall'interfaccia fidata, con conferma esplicita e revisione attesa. */
export async function changeTerritorialPreset(preset: TerritorialPackPreset, expectedRevision: number): Promise<TerritorialPackCapability> {
    const response = await fetch('/api/system/territorial-packs', {
        method: 'PUT', cache: 'no-store', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'x-mediflow-archive-generation': clientArchiveGeneration() },
        body: JSON.stringify({ schemaVersion: TERRITORIAL_PACK_SCHEMA, expectedRevision, preset, confirmed: true }),
    });
    const payload = await response.json().catch(() => null) as { code?: string } | null;
    const capability = response.ok ? parse(payload) : null;
    if (!capability) {
        const code = payload?.code ?? 'internal_error';
        throw new TerritorialPackClientError(code === 'conflict' ? 'L’assetto è cambiato nel frattempo: rileggi e riprova.'
            : code === 'channel_denied' ? 'Operazione ammessa solo dalla sessione Web di questo computer.'
                : 'Cambio non riuscito; assetto invariato.', code);
    }
    publish({ status: 'ready', capability });
    return capability;
}
