import 'server-only';
import { randomUUID } from 'node:crypto';
import { createFunctionModelDispatch } from '../ai-providers/fabric/function-model-dispatch';
import { resolveFunctionModelDispatch, FunctionModelError, type FunctionModelSources } from '../ai-providers/fabric/function-model-preferences';
import type { PairedNativeSession } from '../security/paired-native-session';
import { ProductError } from './product-contract';

export const NATIVE_FABRIC_SCHEMA = 'mediflow.native-fabric.v1';
type Selection = ReturnType<typeof resolveFunctionModelDispatch>;
type Context = ReturnType<typeof import('../security/server-session-clinical-context-native-sources').nativeOrdinaryProjectionContext>;
type Entry = { context: Context; selection: Selection; id: string; phase: 'ready' | 'generating' | 'completed'; controller: AbortController; dispose(): void };
const reply = (value: object) => Response.json({ schema: NATIVE_FABRIC_SCHEMA, ...value }, { headers: { 'Cache-Control': 'no-store' } });

/** Private host service. Its context is an authentic source capture, never an HTTP DTO. */
export function createNativeFabricExecution(dependencies: Readonly<{
    readSources(): FunctionModelSources; confirm(context: Context): void;
    execute(request: Request, context: Context): Promise<Response>;
    sourceSignal(context: Context): AbortSignal; close(context: Context): void;
}>) {
    const entries = new Map<string, Entry>();
    type Preparation = { session: PairedNativeSession; controller: AbortController; context?: Context; detach(): void };
    const preparations = new Set<Preparation>();
    function retirePreparation(preparation: Preparation, close = true) {
        preparations.delete(preparation); preparation.detach();
        if (close) {
            preparation.controller.abort();
            if (preparation.context) dependencies.close(preparation.context);
        }
    }
    function prepare(session: PairedNativeSession) {
        const preparation: Preparation = { session, controller: new AbortController(), detach: () => {} };
        preparations.add(preparation);
        return Object.freeze({ signal: preparation.controller.signal,
            cancel: () => retirePreparation(preparation),
            bind(context: Context) {
                if (context.session !== session || !preparations.has(preparation) || preparation.context) {
                    dependencies.close(context); throw new ProductError('revoked');
                }
                preparation.context = context;
                const signal = dependencies.sourceSignal(context), abort = () => retirePreparation(preparation);
                preparation.detach = () => signal.removeEventListener('abort', abort);
                signal.addEventListener('abort', abort, { once: true });
                if (signal.aborted) { retirePreparation(preparation); throw new ProductError('revoked'); }
            },
        });
    }
    const evidence = (selection: Selection) => Object.freeze({ modelOptionId: selection.binding.modelOptionId,
        catalogRevision: selection.catalogRevision, preferenceRevision: selection.preferenceRevision, source: selection.source,
        provider: selection.binding.provider, model: selection.binding.model, venue: 'local', fallback: 'none' });
    const capture = (functionId: Context['request']['functionId']) => resolveFunctionModelDispatch(dependencies.readSources(), functionId);
    function verify(context: Context, selected: Selection) {
        dependencies.confirm(context);
        const current = capture(context.request.functionId);
        if (current.catalogRevision !== selected.catalogRevision || current.preferenceRevision !== selected.preferenceRevision
            || current.binding.modelOptionId !== selected.binding.modelOptionId) throw new FunctionModelError('binding_stale');
        return current;
    }
    function retire(entry: Entry) {
        entries.delete(entry.id); entry.controller.abort(); entry.dispose(); dependencies.close(entry.context);
    }
    function find(session: PairedNativeSession, id: string): Entry {
        const entry = entries.get(id);
        if (!entry || entry.context.session !== session) throw new ProductError('revoked');
        try { verify(entry.context, entry.selection); }
        catch (error) { retire(entry); throw error; }
        return entry;
    }
    function ready(context: Context, selection: Selection): Response {
        verify(context, selection);
        if (entries.size >= 16 || [...entries.values()].some(entry => entry.context.session === context.session)) throw new ProductError('busy');
        const pending = [...preparations].find(value => value.context?.sources === context.sources && value.session === context.session);
        if (!pending || pending.controller.signal.aborted) throw new ProductError('revoked');
        const signal = dependencies.sourceSignal(context);
        const entry: Entry = { context, selection, id: randomUUID(), phase: 'ready', controller: new AbortController(), dispose: () => {} };
        const abort = () => retire(entry);
        entry.dispose = () => signal.removeEventListener('abort', abort);
        entries.set(entry.id, entry); signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) { retire(entry); throw new ProductError('revoked'); }
        retirePreparation(pending, false);
        return reply({ phase: 'ready', attemptId: entry.id, functionId: context.request.functionId,
            expiresAt: context.selection.expiresAt, selection: evidence(selection) });
    }
    async function generate(request: Request, session: PairedNativeSession, id: string): Promise<Response> {
        const entry = find(session, id);
        if (entry.phase !== 'ready') throw new ProductError('invalid_state');
        entry.phase = 'generating';
        const identity = new Request(request.url, { method: 'POST', signal: AbortSignal.any([request.signal, entry.controller.signal]) });
        const dispatch = createFunctionModelDispatch({
            authenticate: async () => { verify(entry.context, entry.selection); return session.id; },
            readSources: dependencies.readSources,
        })(entry.context.request.functionId, async owned => dependencies.execute(owned, entry.context));
        try {
            const response = await dispatch(identity);
            verify(entry.context, entry.selection);
            if (identity.signal.aborted || entries.get(id) !== entry) throw new ProductError('revoked');
            if (!response.ok) { retire(entry); return response; }
            const result: unknown = await response.json();
            verify(entry.context, entry.selection);
            if (identity.signal.aborted || entries.get(id) !== entry) throw new ProductError('revoked');
            const root = result as { preview?: { status?: unknown }; status?: unknown } | null;
            const status = ['patient_insight', 'smart_import'].includes(entry.context.request.functionId) ? root?.preview?.status : root?.status;
            if (status !== 'available') {
                retire(entry);
                return Response.json({ code: 'unavailable', error: 'La funzione locale non ha prodotto una proposta verificabile.' },
                    { status: 503, headers: { 'Cache-Control': 'no-store' } });
            }
            entry.phase = 'completed';
            return reply({ phase: 'completed', attemptId: id, functionId: entry.context.request.functionId,
                expiresAt: entry.context.selection.expiresAt, selection: evidence(entry.selection), result,
                clinicalWrites: 0, apply: 'denied' });
        } catch (error) { retire(entry); throw error; }
    }
    function cancel(session: PairedNativeSession, id: string): Response {
        const entry = entries.get(id);
        if (entry && entry.context.session !== session) throw new ProductError('revoked');
        if (entry) retire(entry);
        return reply({ phase: 'closed', attemptId: id, cleanupConfirmed: true });
    }
    function status(session: PairedNativeSession, id: string | null): Response {
        if (!id) {
            for (const pending of [...preparations]) if (pending.session === session) retirePreparation(pending);
            const busy = [...entries.values()].some(entry => entry.context.session === session);
            return reply({ phase: busy ? 'busy' : 'closed', cleanupConfirmed: !busy });
        }
        const entry = find(session, id);
        return reply({ phase: 'current', attemptId: id, functionId: entry.context.request.functionId,
            expiresAt: entry.context.selection.expiresAt, selection: evidence(entry.selection) });
    }
    return Object.freeze({ prepare, capture, verify, ready, generate, cancel, status });
}
