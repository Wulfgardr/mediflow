import { openMandatePrivateKey } from './agent-mandate-client';
import { cassetteItems, type AgentCassette } from './agent-cassette-contract';
import { openAgentItem, type AgentItemKind } from './agent-cassette-crypto';

export type OpenedAgentVisit = { cassette: AgentCassette; anchor: Record<string, unknown>; items: { id: string; kind: Exclude<AgentItemKind, 'anchor'>; value: Record<string, unknown> }[] };
function json(bytes: Uint8Array): Record<string, unknown> {
    try {
        const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid');
        return value as Record<string, unknown>;
    } finally { bytes.fill(0); }
}
export async function openAgentVisit(cassette: AgentCassette): Promise<OpenedAgentVisit> {
    const key = await openMandatePrivateKey(cassette);
    const context = { mandateRef: cassette.mandateRef, visitId: cassette.id };
    const anchor = json(await openAgentItem(key, { ...context, itemId: cassette.id, kind: 'anchor' }, JSON.parse(cassette.anchorCiphertext)));
    const items = [];
    for (const item of cassetteItems(cassette)) {
        const value = json(await openAgentItem(key, { ...context, itemId: item.id, kind: item.kind }, item.envelope));
        items.push({ id: item.id, kind: item.kind, value });
    }
    return { cassette, anchor, items };
}
