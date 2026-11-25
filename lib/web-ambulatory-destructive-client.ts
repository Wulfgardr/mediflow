import { clientArchiveGeneration } from './security/client-auth-api';
import type { AmbulatoryDestructiveOperation } from './ambulatory-destructive-command-contract';

export type WebAmbulatoryPlan = {
    reference: string;
    operation: AmbulatoryDestructiveOperation;
    target: { id: string; name: string; version: number };
    fallback: { id: string; name: string } | null;
    counts: { tombstonedPatients: number; unlinkedPatients: number; preservedLivePatients: number; removedMembershipRows: number } | null;
};
export type WebAmbulatoryReceipt = { outcome: 'applied'; ambulatoryId: string; version: number | null };
type Outcome<T> = { ok: true; value: T } | { ok: false; code: string };

async function post<T>(path: string, body: unknown): Promise<Outcome<T>> {
    const response = await fetch(path, {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'x-mediflow-archive-generation': clientArchiveGeneration() },
        body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (response.ok && payload) return { ok: true, value: payload as T };
    return { ok: false, code: typeof payload?.code === 'string' ? payload.code : `HTTP_${response.status}` };
}

export function prepareAmbulatoryCommand(operation: AmbulatoryDestructiveOperation, ambulatoryId: string, expectedVersion: number) {
    return post<WebAmbulatoryPlan>('/api/ambulatories/commands/prepare', { operation, ambulatoryId, expectedVersion });
}

export function executeAmbulatoryCommand(reference: string, pin: string) {
    return post<WebAmbulatoryReceipt>('/api/ambulatories/commands/execute', { reference, pin });
}

export const AMBULATORY_COMMAND_RETRY_CODES = new Set(['AMBULATORY_PREPARATION_EXPIRED', 'AMBULATORY_PLAN_CHANGED', 'AMBULATORY_COMMAND_UNKNOWN']);
