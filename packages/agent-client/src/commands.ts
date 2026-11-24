import { defaultAgentCredentialDirectory } from './credentials';
import { AgentClientError, completeAgentPairing, prepareAndDepositAgentVisit, requestAgentPairing, requestAgentVisitConfirmation, resumeAgentVisit, retrieveAgentMandate } from './visit-client';
import { AGENT_OPERATIONS, type AgentOperation } from '../../../lib/agent-mandate-contract';

export type AgentCommand =
    | { command: 'collega'; origin: string; name: string; operations?: AgentOperation[] }
    | { command: 'completa'; requestId: string }
    | { command: 'deposita'; agentRef: string; extraction: string; fiscalCode: string; transcription?: string; visitId: string; replaces?: string }
    | { command: 'ritira'; agentRef: string }
    | { command: 'riprendi'; agentRef: string; visitId: string }
    | { command: 'apri-conferma'; agentRef: string; visitId: string }
    | { command: 'esito-conferma'; agentRef: string; reference: string };
export function executeAgentCommand(command: AgentCommand, directory = defaultAgentCredentialDirectory(), signal?: AbortSignal) {
    switch (command.command) {
        case 'collega': return requestAgentPairing(directory, command.origin, command.name, command.operations, signal);
        case 'completa': return completeAgentPairing(directory, command.requestId, signal);
        case 'deposita': return prepareAndDepositAgentVisit(directory, command.agentRef, command.extraction, command.fiscalCode, command.transcription, command.visitId, signal, command.replaces);
        case 'ritira': return retrieveAgentMandate(directory, command.agentRef, signal);
        case 'riprendi': return resumeAgentVisit(directory, command.agentRef, command.visitId, signal);
        case 'apri-conferma': return requestAgentVisitConfirmation(directory, command.agentRef, { visitId: command.visitId }, signal);
        case 'esito-conferma': return requestAgentVisitConfirmation(directory, command.agentRef, { reference: command.reference }, signal);
    }
}
export function parseAgentCommand(argv: string[]): { command: AgentCommand; directory?: string } {
    const [verb, ...rest] = argv, values = new Map<string, string>();
    if (rest.length % 2) throw new AgentClientError('AGENT_INPUT_INVALID');
    for (let index = 0; index < rest.length; index += 2) {
        const name = rest[index], value = rest[index + 1];
        if (!/^--[a-z]+$/u.test(name) || values.has(name) || !value || value.startsWith('--')) throw new AgentClientError('AGENT_INPUT_INVALID');
        values.set(name, value);
    }
    const take = (name: string, optional = false) => {
        const value = values.get(name); values.delete(name);
        if (!value && !optional) throw new AgentClientError('AGENT_INPUT_INVALID');
        return value;
    };
    const directory = take('--credenziali', true);
    let command: AgentCommand;
    switch (verb) {
        case 'collega': {
            const origin = take('--origine')!, name = take('--nome')!, operations = take('--operazioni', true)?.split(',');
            if (operations && operations.some(operation => !AGENT_OPERATIONS.includes(operation as AgentOperation))) throw new AgentClientError('AGENT_INPUT_INVALID');
            command = { command: 'collega', origin, name, ...(operations ? { operations: operations as AgentOperation[] } : {}) }; break;
        }
        case 'completa': command = { command: 'completa', requestId: take('--richiesta')! }; break;
        case 'deposita': command = { command: 'deposita', agentRef: take('--agente')!, extraction: take('--estrazione')!, fiscalCode: take('--cf')!, visitId: take('--visita')!, transcription: take('--trascrizione', true), replaces: take('--sostituisce', true) }; break;
        case 'ritira': command = { command: 'ritira', agentRef: take('--agente')! }; break;
        case 'riprendi': command = { command: 'riprendi', agentRef: take('--agente')!, visitId: take('--visita')! }; break;
        case 'apri-conferma': command = { command: 'apri-conferma', agentRef: take('--agente')!, visitId: take('--visita')! }; break;
        case 'esito-conferma': command = { command: 'esito-conferma', agentRef: take('--agente')!, reference: take('--riferimento')! }; break;
        default: throw new AgentClientError('AGENT_INPUT_INVALID');
    }
    if (values.size) throw new AgentClientError('AGENT_INPUT_INVALID');
    return { command, directory };
}
export function agentCommandFailure(error: unknown) {
    return error instanceof AgentClientError ? { error: error.code, ...(error.status ? { status: error.status } : {}), ...(error.visitId ? { visitId: error.visitId } : {}) }
        : { error: 'AGENT_INPUT_INVALID' };
}
