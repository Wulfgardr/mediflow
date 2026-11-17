import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { AGENT_OPERATIONS } from '../../../lib/agent-mandate-contract.ts';
import { agentCommandFailure, executeAgentCommand, type AgentCommand } from './commands.ts';

export function createAgentVisitMcpServer(directory?: string) {
    const server = new McpServer({ name: 'mediflow-visit-agent', version: '1.0.0' });
    const run = async (command: AgentCommand, signal: AbortSignal) => {
        try {
            const result = await executeAgentCommand(command, directory, signal);
            return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result };
        } catch (error) { return { isError: true as const, content: [{ type: 'text' as const, text: JSON.stringify(agentCommandFailure(error)) }] }; }
    };
    const annotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
    server.registerTool('mediflow_collega', {
        title: 'Collega un agente', description: 'Chiede un codice da approvare nella pagina Agenti di MediFlow.',
        inputSchema: z.object({ origin: z.string(), name: z.string().min(1).max(80), operations: z.array(z.enum(AGENT_OPERATIONS)).optional() }).strict(), annotations,
    }, (args, context) => run({ command: 'collega', ...args }, context.mcpReq.signal));
    server.registerTool('mediflow_completa_collegamento', {
        title: 'Completa il collegamento', description: 'Conserva la credenziale privata dopo l’approvazione del codice nella pagina Agenti.',
        inputSchema: z.object({ requestId: z.string().uuid() }).strict(), annotations: { ...annotations, idempotentHint: true },
    }, (args, context) => run({ command: 'completa', ...args }, context.mcpReq.signal));
    server.registerTool('mediflow_deposita_visita', {
        title: 'Deposita la visita', description: 'Riusa l’estrazione preparata e i PDF riconosciuti dagli hash. La ricevuta descrive il deposito; MediFlow applica gli elementi ammessi e presenta le proposte In arrivo.',
        inputSchema: z.object({ agentRef: z.string().uuid(), extraction: z.string().min(1), fiscalCode: z.string().length(16), visitId: z.string().uuid(), transcription: z.string().optional() }).strict(), annotations,
    }, (args, context) => run({ command: 'deposita', ...args }, context.mcpReq.signal));
    server.registerTool('mediflow_riprendi_visita', {
        title: 'Riprendi un deposito', description: 'Ritenta le stesse buste cifrate della visita dopo un’interruzione.',
        inputSchema: z.object({ agentRef: z.string().uuid(), visitId: z.string().uuid() }).strict(), annotations: { ...annotations, idempotentHint: true },
    }, (args, context) => run({ command: 'riprendi', ...args }, context.mcpReq.signal));
    return server;
}
