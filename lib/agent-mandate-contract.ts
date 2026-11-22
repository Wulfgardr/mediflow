export const AGENT_OPERATIONS = [
    'visita.apri', 'visita.allega', 'visita.trascrizione', 'visita.nota',
    'visita.proponi.terapia', 'visita.proponi.prestazione', 'visita.proponi.diagnosi',
    'visita.proponi.esenzione', 'visita.proponi.osservazione', 'visita.chiudi',
] as const;
export type AgentOperation = typeof AGENT_OPERATIONS[number];
export const clinicalContentAllowed = (provider: AgentMandateInput['provider'], allowsClinicalEgress: boolean | number) =>
    provider === 'local' || allowsClinicalEgress === true || allowsClinicalEgress === 1;
export const MANDATE_MAX_DURATION_MS = 24 * 60 * 60 * 1000;
export type AgentMandateInput = {
    id: string;
    durationMs: number;
    operations: AgentOperation[];
    provider: 'openai' | 'anthropic' | 'local';
    allowsClinicalEgress: boolean;
    publicKey: string;
    wrappedPrivateKey: string;
};
export type AgentMandate = Omit<AgentMandateInput, 'durationMs'> & {
    actorRef: string;
    archiveGeneration: string;
    createdAt: number;
    expiresAt: number;
    revokedAt: number | null;
};
export function validMandateInput(value: unknown): value is AgentMandateInput {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const input = value as AgentMandateInput;
    return Object.keys(input).sort().join(',') === 'allowsClinicalEgress,durationMs,id,operations,provider,publicKey,wrappedPrivateKey'
        && typeof input.id === 'string' && /^[a-f0-9-]{36}$/u.test(input.id)
        && Number.isSafeInteger(input.durationMs) && input.durationMs > 0 && input.durationMs <= MANDATE_MAX_DURATION_MS
        && Array.isArray(input.operations) && input.operations.length > 0
        && new Set(input.operations).size === input.operations.length
        && input.operations.every(operation => AGENT_OPERATIONS.includes(operation))
        && ['openai', 'anthropic', 'local'].includes(input.provider)
        && typeof input.allowsClinicalEgress === 'boolean' && (input.provider !== 'local' || !input.allowsClinicalEgress)
        && typeof input.publicKey === 'string' && /^B[A-Za-z0-9+/]{86}=$/u.test(input.publicKey)
        && typeof input.wrappedPrivateKey === 'string' && /^ENC:[A-Za-z0-9+/]{16}:[A-Za-z0-9+/]+=*$/u.test(input.wrappedPrivateKey)
        && input.wrappedPrivateKey.length <= 4096;
}
