import { AGENT_MAX_ITEM_BYTES, agentBytes, isAgentId, validAgentEnvelope, type AgentEnvelope, type AgentItemKind } from './agent-cassette-crypto.ts';
import type { AgentOperation } from './agent-mandate-contract';

export type AgentCassetteItem = { id: string; kind: Exclude<AgentItemKind, 'anchor'>; envelope: AgentEnvelope; byteLength: number; documentHash: string | null };
export type AgentCassette = { id: string; mandateRef: string; agentRef: string; actorRef: string; archiveGeneration: string;
    publicKey: string; wrappedPrivateKey: string; modelProvider: 'openai' | 'anthropic' | 'local'; allowsClinicalEgress: number;
    anchorCiphertext: string; itemsCiphertext: string; status: 'open' | 'closed'; revision: number; depositedAt: number; modifiedAt: number };
export const AGENT_ITEM_OPERATION: Record<AgentCassetteItem['kind'], AgentOperation> = {
    note: 'visita.nota', transcription: 'visita.trascrizione', pdf: 'visita.allega', therapy: 'visita.proponi.terapia',
    service: 'visita.proponi.prestazione', diagnosis: 'visita.proponi.diagnosi', exemption: 'visita.proponi.esenzione', observation: 'visita.proponi.osservazione',
};
export function validAgentCassetteItem(value: unknown): value is AgentCassetteItem {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const item = value as AgentCassetteItem;
    return Object.keys(item).sort().join(',') === 'byteLength,documentHash,envelope,id,kind'
        && isAgentId(item.id) && Object.hasOwn(AGENT_ITEM_OPERATION, item.kind) && validAgentEnvelope(item.envelope)
        && Number.isSafeInteger(item.byteLength) && item.byteLength > 0 && item.byteLength <= AGENT_MAX_ITEM_BYTES
        && agentBytes(item.envelope.ciphertext).length === item.byteLength + 16
        && (item.kind === 'pdf' ? typeof item.documentHash === 'string' && /^[a-f0-9]{64}$/u.test(item.documentHash) : item.documentHash === null);
}
export function cassetteItems(cassette: Pick<AgentCassette, 'itemsCiphertext'>): AgentCassetteItem[] {
    if (typeof cassette.itemsCiphertext !== 'string' || cassette.itemsCiphertext.length > 50 * 1024 * 1024) throw new Error('AGENT_CASSETTE_INVALID');
    const items: unknown = JSON.parse(cassette.itemsCiphertext);
    if (!Array.isArray(items) || items.length > 128 || !items.every(validAgentCassetteItem)
        || new Set(items.map(item => item.id)).size !== items.length || items.reduce((sum, item) => sum + item.byteLength, 0) > 32 * 1024 * 1024) throw new Error('AGENT_CASSETTE_INVALID');
    return items;
}
export function assertAgentCassetteBackup(rows: Record<string, unknown>[]): void {
    const ids = new Set<string>();
    for (const row of rows) {
        if (Object.keys(row).sort().join(',') !== 'actorRef,agentRef,allowsClinicalEgress,anchorCiphertext,archiveGeneration,depositedAt,id,itemsCiphertext,mandateRef,modelProvider,modifiedAt,publicKey,revision,status,wrappedPrivateKey'
            || ![row.id, row.agentRef, row.mandateRef, row.archiveGeneration].every(isAgentId)
            || typeof row.actorRef !== 'string' || !row.actorRef.length || row.actorRef.length > 256
            || !['open', 'closed'].includes(row.status as string) || !['openai', 'anthropic', 'local'].includes(row.modelProvider as string)
            || ![0, 1].includes(row.allowsClinicalEgress as number) || row.modelProvider === 'local' && row.allowsClinicalEgress !== 0
            || typeof row.publicKey !== 'string' || !/^B[A-Za-z0-9+/]{86}=$/u.test(row.publicKey)
            || typeof row.wrappedPrivateKey !== 'string' || !/^ENC:[A-Za-z0-9+/]{16}:[A-Za-z0-9+/]+=*$/u.test(row.wrappedPrivateKey) || row.wrappedPrivateKey.length > 4096
            || !Number.isSafeInteger(row.revision) || (row.revision as number) < 1 || (row.revision as number) > 130
            || !Number.isSafeInteger(row.depositedAt) || (row.depositedAt as number) < 0 || !Number.isSafeInteger(row.modifiedAt) || (row.modifiedAt as number) < (row.depositedAt as number)
            || typeof row.anchorCiphertext !== 'string' || row.anchorCiphertext.length > 8192 || !validAgentEnvelope(JSON.parse(row.anchorCiphertext))
            || ids.has(row.id as string)) throw new Error('AGENT_CASSETTE_BACKUP_INVALID');
        cassetteItems(row as AgentCassette); ids.add(row.id as string);
    }
}
