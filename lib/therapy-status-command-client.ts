import { clientArchiveGeneration } from './security/client-auth-api';
import { parseTherapyStatusCommand, parseTherapyStatusReceipt, type TherapyStatusCommand, type TherapyStatusExecute, type TherapyStatusReceipt } from './therapy-status-command-contract';
export type TherapyCommandResponse = { outcome: 'unknown' } | { outcome: 'terminal'; historical: boolean; receipt: TherapyStatusReceipt };
export async function requestTherapyStatusCommand(operation: 'execute' | 'receipt' | 'close', command: TherapyStatusCommand | TherapyStatusExecute, signal: AbortSignal): Promise<TherapyCommandResponse> {
    signal.throwIfAborted();
    const path = `/api/therapy-status-commands/${encodeURIComponent(command.commandId)}/${operation}`;
    const query = operation === 'receipt' ? '?' + new URLSearchParams(Object.entries(command).map(([key, value]) => [key, String(value)])) : '';
    const response = await fetch(path + query, { method: operation === 'receipt' ? 'GET' : 'POST', signal, credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'x-mediflow-archive-generation': clientArchiveGeneration() },
        ...(operation === 'receipt' ? {} : { body: JSON.stringify(command) }) });
    if (!response.ok) throw new Error('Therapy command unconfirmed');
    const result = await response.json() as TherapyCommandResponse;
    signal.throwIfAborted();
    if (result?.outcome === 'unknown' && operation === 'receipt' && Object.keys(result).length === 1) return result;
    if (result?.outcome !== 'terminal' || Object.keys(result).length !== 3 || typeof result.historical !== 'boolean' || !parseTherapyStatusReceipt(result.receipt)) throw new Error('Invalid therapy receipt');
    const row = result.receipt;
    const binding = { commandId: row.commandId, protocol: row.protocol, archiveGeneration: row.archiveGeneration, patientId: row.patientId, therapyId: row.therapyId, expectedVersion: row.expectedVersion };
    if (!parseTherapyStatusCommand(binding, false) || !Object.keys(binding).every(key => binding[key as keyof typeof binding] === command[key as keyof TherapyStatusCommand])
        || !['applied', 'rejected', 'closed'].includes(row.outcome) || typeof row.actorRef !== 'string'
        || (row.outcome === 'closed' ? row.target !== null : !['active', 'suspended', 'completed'].includes(row.target!))
        || (operation === 'execute' && row.outcome !== 'closed' && row.target !== (command as TherapyStatusExecute).target)) throw new Error('Invalid therapy receipt');
    return result;
}
