import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { isValidItalianTaxCode } from '../../../lib/patient-identity';
import { agentPrivateDirectory, readAgentCredential, readAgentRegistration } from './credentials.ts';
import { agentCommandFailure } from './commands.ts';
import { registerAgentMandateTool } from './mcp.ts';
import {
    AgentClientError, agentOrigin, completeAgentPairing, loadAgentVisitContext,
    prepareAndDepositAgentVisit, requestAgentPairing, requestAgentVisitConfirmation, resumeAgentReference, resumeAgentVisit, retrieveAgentMandate,
} from './visit-client.ts';

const settingsSchema = z.object({
    repository: z.string().refine(path.isAbsolute),
    origin: z.string().transform(agentOrigin),
    downloads: z.string().refine(path.isAbsolute).refine(value => fs.statSync(value).isDirectory()),
    physicianCodes: z.array(z.string().refine(isValidItalianTaxCode)),
}).strict();

export function configureAmbulatorio(home: string, file: string, value: unknown) {
    const settings = settingsSchema.parse(value);
    const root = ambulatorioHome(home);
    const temporary = path.join(root, randomUUID() + '.tmp');
    fs.writeFileSync(temporary, JSON.stringify(settings), { flag: 'wx', mode: 0o600 });
    try { fs.renameSync(temporary, file); }
    finally { fs.rmSync(temporary, { force: true }); }
}

function ambulatorioHome(home: string) {
    if (!path.isAbsolute(home)) throw Error();
    return agentPrivateDirectory(home);
}

class AmbulatorioError extends Error {}

const visit = { visitId: z.string().uuid() };
const fact = z.object({
    file: z.string().regex(/^(?:trascrizione-visita|nota-visita|[a-f0-9]{64})\.pdf$/u),
    kind: z.enum(['therapy', 'service_prescription', 'diagnosis', 'exemption']),
    values: z.record(z.string(), z.string().max(12000)),
    quote: z.string().min(12).max(600).refine(value => value.trim().split(/\s+/u).length >= 3),
}).strict();
const nextProposals = z.object({
    stato: z.literal('da_verificare_in_mediflow'),
    elementi: z.array(z.object({ tipo: z.enum(['nota', 'terapia', 'prestazione', 'diagnosi', 'esenzione']), fonte: z.string() })),
});
const depositResult = z.object({
    ...visit, mandateRef: z.string().uuid(), agentRef: z.string().uuid(),
    status: z.literal('closed'), revision: z.number(), itemCount: z.number(),
    modelProvider: z.literal('openai'), allowsClinicalEgress: z.literal(true),
    proposteInArrivo: nextProposals,
});

export function createAmbulatorioServer(home: string, value: unknown, plugin: string) {
    const config = settingsSchema.parse(value);
    const root = ambulatorioHome(home);
    const credentials = agentPrivateDirectory(path.join(root, 'credenziali'));
    const archive = agentPrivateDirectory(path.join(root, 'visite'));
    const server = new McpServer({ name: 'mediflow-visit-agent', version: '1.0.0' });
    const annotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
    const worker = async (action: string, args: unknown, signal: AbortSignal) => {
        const pending = promisify(execFile)('python3', ['-I', '-B', path.join(plugin, 'visit.py')], {
            cwd: archive, signal, timeout: 190000, maxBuffer: 2 * 1024 * 1024,
            env: { PATH: process.env.PATH, TZ: process.env.TZ, NODE_ENV: process.env.NODE_ENV, PYTHONUTF8: '1' },
        });
        pending.child.stdin?.on('error', () => {});
        pending.child.stdin?.end(JSON.stringify({ root: archive, config: { ...config, node: process.execPath }, action, args }));
        const result: Record<string, unknown> = JSON.parse((await pending).stdout);
        if (typeof result.error === 'string') throw new AmbulatorioError(result.error);
        return result;
    };
    const active = async (signal: AbortSignal, agentRef?: string) => {
        const references = agentRef ? [agentRef] : new Set(fs.readdirSync(credentials)
            .filter(file => /^[a-f0-9-]{36}(?:\.registration)?\.json$/u.test(file)).map(file => file.slice(0, 36)));
        const candidates = Array.from(references, ref => ({ ref, cached: readAgentCredential(credentials, ref), registration: readAgentRegistration(credentials, ref) }));
        const candidate = candidates.filter(({ cached, registration }) => (cached ?? registration)?.origin === config.origin)
            .sort((a, b) => (b.cached?.expiresAt ?? 0) - (a.cached?.expiresAt ?? 0))[0];
        if (!candidate) throw new AmbulatorioError('COLLEGA_MEDIFLOW');
        const context = await loadAgentVisitContext(credentials, candidate.ref, signal, config.origin);
        if (context.modelProvider !== 'openai' || context.allowsClinicalEgress !== true) {
            throw new AmbulatorioError('MANDATO_CODEX_NON_AUTORIZZATO');
        }
        return candidate.ref;
    };
    const run = async (action: () => Promise<Record<string, unknown>>) => {
        try {
            const result = await action();
            return { structuredContent: result, content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        } catch (error) {
            const result = error instanceof AmbulatorioError ? { error: error.message } : agentCommandFailure(error);
            return { isError: true as const, content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        }
    };

    server.registerTool('mediflow_collega', {
        description: 'Chiede il codice da confrontare e approvare nella pagina Agenti di MediFlow.',
        inputSchema: z.object({}).strict(), annotations: { ...annotations, idempotentHint: false },
    }, (_, { mcpReq }) => run(() => requestAgentPairing(credentials, config.origin, 'Codex Ambulatorio', undefined, mcpReq.signal)));
    server.registerTool('mediflow_completa_collegamento', {
        description: 'Conserva la credenziale nel plugin quando il medico ha approvato il codice in MediFlow.',
        inputSchema: z.object({ requestId: z.string().uuid() }).strict(), annotations,
    }, ({ requestId }, { mcpReq }) => run(async () => {
        const result = await completeAgentPairing(credentials, requestId, mcpReq.signal);
        if (result.status === 'approved') await active(mcpReq.signal, result.agentRef);
        return result;
    }));
    registerAgentMandateTool(server, (agentRef, signal) => run(() => retrieveAgentMandate(credentials, agentRef, signal, config.origin)));
    server.registerTool('mediflow_acquisisci_visita', {
        description: 'Conserva il dettato integrale e individua i PDF per il CF dettato. Un CF proposto dai PDF richiede conferma del medico.',
        inputSchema: z.object({ dettato: z.string().min(1).max(60000).refine(value => Boolean(value.trim())), inizio: z.iso.datetime({ offset: true }).optional() }).strict(), annotations,
    }, (args, { mcpReq }) => run(async () => {
        await active(mcpReq.signal);
        return worker('acquire', { ...args, visitId: randomUUID() }, mcpReq.signal);
    }));
    server.registerTool('mediflow_aggiorna_visita', {
        description: 'Rilegge i PDF della stessa visita. Passa il CF solo dopo conferma esplicita del medico per questa visita.',
        inputSchema: z.object({ ...visit, conferma: z.string().min(1).max(160).optional() }).strict(), annotations,
    }, (args, { mcpReq }) => run(async () => {
        await active(mcpReq.signal);
        return worker('update', args, mcpReq.signal);
    }));
    server.registerTool('mediflow_correggi_visita', {
        description: 'Accoda il messaggio di correzione dettato dal medico alla stessa visita e rende necessario rigenerare il Dossier.',
        inputSchema: z.object({ ...visit, correzione: z.string().min(1).max(60000).refine(value => Boolean(value.trim())) }).strict(), annotations,
    }, (args, { mcpReq }) => run(async () => {
        await active(mcpReq.signal);
        return worker('correct', args, mcpReq.signal);
    }));
    server.registerTool('mediflow_prepara_dossier', {
        description: 'Salva la scheda con nota S/O/A/P, genera il PDF della nota e verifica il Dossier con MediFlow. Accetta solo citazioni letterali.',
        inputSchema: z.object({ ...visit, scheda: z.string().min(1).max(30000), fatti: z.array(fact).max(100) }).strict(), annotations: { ...annotations, idempotentHint: false },
    }, (args, { mcpReq }) => run(async () => {
        await active(mcpReq.signal);
        return worker('prepare', args, mcpReq.signal);
    }));

    const deposit = (visitId: string, signal: AbortSignal, resumeOnly: boolean) => run(async () => {
        const agentRef = resumeAgentReference(credentials, visitId);
        if (resumeOnly && !agentRef) throw new AmbulatorioError('DEPOSITO_NON_AVVIATO');
        const ref = await active(signal, agentRef);
        const payload = await worker('deposit', { visitId }, signal);
        const prepared = z.object({ extraction: z.string(), fiscalCode: z.string(), transcription: z.string(), proposals: nextProposals.shape.elementi }).parse(payload);
        const receipt = agentRef ? await resumeAgentVisit(credentials, agentRef, visitId, signal)
            : await prepareAndDepositAgentVisit(credentials, ref, prepared.extraction, prepared.fiscalCode, prepared.transcription, visitId, signal);
        if (receipt.status !== 'closed') throw new AgentClientError('AGENT_HTTP_UNAVAILABLE');
        return depositResult.parse({ ...receipt, proposteInArrivo: { stato: 'da_verificare_in_mediflow', elementi: prepared.proposals } });
    });

    server.registerTool('mediflow_deposita_visita', {
        description: 'Deposita il Dossier verificato della visita. La nota e le proposte cliniche attendono la conferma del medico in MediFlow.',
        inputSchema: z.object(visit).strict(), outputSchema: depositResult, annotations,
    }, ({ visitId }, { mcpReq }) => deposit(visitId, mcpReq.signal, false));
    server.registerTool('mediflow_riprendi_visita', {
        description: 'Ritenta le stesse buste cifrate dopo un’interruzione.',
        inputSchema: z.object(visit).strict(), outputSchema: depositResult, annotations,
    }, ({ visitId }, { mcpReq }) => deposit(visitId, mcpReq.signal, true));
    const confirmation = (visitId: string, operation: { visitId: string } | { reference: string }, signal: AbortSignal) => run(async () => {
        const agentRef = resumeAgentReference(credentials, visitId);
        if (!agentRef) throw new AmbulatorioError('DEPOSITO_NON_AVVIATO');
        await active(signal, agentRef);
        return requestAgentVisitConfirmation(credentials, agentRef, operation, signal, config.origin);
    });
    server.registerTool('mediflow_apri_conferma_visita', {
        description: 'Chiede di aprire il riquadro di conferma della visita depositata.',
        inputSchema: z.object(visit).strict(), annotations,
    }, ({ visitId }, { mcpReq }) => confirmation(visitId, { visitId }, mcpReq.signal));
    server.registerTool('mediflow_esito_conferma_visita', {
        description: 'Legge l’esito con il riferimento restituito da MediFlow.',
        inputSchema: z.object({ ...visit, reference: z.string().uuid() }).strict(), annotations: { ...annotations, readOnlyHint: true },
    }, ({ visitId, reference }, { mcpReq }) => confirmation(visitId, { reference }, mcpReq.signal));
    return server;
}

export function serveAmbulatorio(home: string, config: unknown, plugin: string) {
    const server = createAmbulatorioServer(home, config, plugin);
    const transport = new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 512 * 1024 });
    const handle = serveStdio(() => server, { legacy: 'serve', transport, onerror: () => process.stderr.write('AGENT_MCP_UNAVAILABLE\n') });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void handle.close(); });
    process.stdin.once('end', () => { void handle.close(); });
}
