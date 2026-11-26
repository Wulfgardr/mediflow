import { LocalVoiceError, localVoiceClient, localVoiceEndpointFromEnv, type LocalVoiceEndpoint, type LocalVoiceSnapshot } from './client.mjs';

export type LocalVoiceMode = 'visit' | 'dictation';
export type LocalVoiceCommand = 'pause' | 'resume' | 'stop';
export type LocalVoiceAvailability = 'ready' | 'model-missing' | 'model-incomplete' | 'off' | 'unsupported';
export type LocalVoiceForeign =
    | { kind: 'patient'; subject: string; patientId: string }
    | { kind: 'first-visit'; subject: string }
    | { kind: 'other-user' };
export type LocalVoicePageSnapshot = Pick<LocalVoiceSnapshot, 'id' | 'subject' | 'mode' | 'state' | 'fault' | 'visible' | 'elapsedMs' | 'limitReached' | 'allowed' | 'live' | 'review'>
    & { nextSequence: number };
export type LocalVoiceReply = { status: number; body: unknown };

type Client = ReturnType<typeof localVoiceClient>;
type Owner = { user: string; subject: string; next: number; queue: Promise<unknown> };

const SUBJECT = /^(paziente|prima-visita):[A-Za-z0-9-]{8,64}$/u;
const SESSION = /^[a-f0-9]{32}$/u;
const MAX_VOCABULARY = 200;
const MAX_TERM = 80;

export function localVoiceSubject(value: unknown): string | null {
    return typeof value === 'string' && SUBJECT.test(value) ? value : null;
}

function foreignOf(owner: Owner | undefined, user: string, subject: string): LocalVoiceForeign {
    if (!owner || owner.user !== user) return { kind: 'other-user' };
    const patient = /^paziente:(.+)$/u.exec(subject);
    return patient ? { kind: 'patient', subject, patientId: patient[1] } : { kind: 'first-visit', subject };
}

function pageSnapshot(snapshot: LocalVoiceSnapshot, nextSequence: number): LocalVoicePageSnapshot {
    const { id, subject, mode, state, fault, visible, elapsedMs, limitReached, allowed, live, review } = snapshot;
    return { id, subject, mode, state, fault, visible, elapsedMs, limitReached, allowed, live, review, nextSequence };
}

function vocabularyOf(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const terms = value.filter((term): term is string => typeof term === 'string')
        .map((term) => term.normalize('NFC').trim()).filter((term) => term.length > 0 && term.length <= MAX_TERM);
    return [...new Set(terms)].slice(0, MAX_VOCABULARY);
}

function orphanOf(error: unknown): string | null {
    if (!(error instanceof LocalVoiceError) || error.code !== 'session-active') return null;
    const id = (error.body as { session?: { id?: unknown } } | undefined)?.session?.id;
    return typeof id === 'string' && SESSION.test(id) ? id : null;
}

function failure(error: unknown): LocalVoiceReply {
    if (error instanceof LocalVoiceError) {
        if (error.code === 'unreachable' || error.code === 'identity') return { status: 503, body: { error: 'off' } };
        const status = typeof error.status === 'number' && error.status >= 400 && error.status < 600 ? error.status : 502;
        return { status, body: { error: error.code } };
    }
    return { status: 502, body: { error: 'failed' } };
}

/**
 * The only path from a page to the local voice service (ADR 0204): the page never talks to it.
 * A transcript reaches a page only for the user who started the session and for the subject it was started for.
 */
export function createLocalVoiceBridge({ endpoint = localVoiceEndpointFromEnv, platform = process.platform, client = localVoiceClient }: {
    endpoint?: () => LocalVoiceEndpoint | null; platform?: NodeJS.Platform; client?: (endpoint: LocalVoiceEndpoint) => Client;
} = {}) {
    const owners = new Map<string, Owner>();
    const connect = () => {
        const target = endpoint();
        return target ? client(target) : null;
    };
    const owned = (id: unknown, user: string, subject: unknown): Owner | null => {
        if (typeof id !== 'string' || !SESSION.test(id)) return null;
        const owner = owners.get(id);
        return owner && owner.user === user && owner.subject === localVoiceSubject(subject) ? owner : null;
    };
    const matching = (owner: Owner, snapshot: LocalVoiceSnapshot): LocalVoiceReply => snapshot.subject === owner.subject
        ? { status: 200, body: pageSnapshot(snapshot, owner.next) }
        : { status: 409, body: { error: 'subject-mismatch' } };

    return {
        async status(user: string, subject: unknown): Promise<LocalVoiceReply> {
            const expected = localVoiceSubject(subject);
            if (!expected) return { status: 400, body: { error: 'subject' } };
            const voice = connect();
            if (!voice) return { status: 200, body: { availability: platform === 'darwin' ? 'off' : 'unsupported', session: null } };
            let status: { model?: string; session?: { id: string; subject: string; state: string } | null };
            try { status = await voice.status(); } catch { return { status: 200, body: { availability: 'off', session: null } }; }
            const availability: LocalVoiceAvailability = status.model === 'ready' ? 'ready' : status.model === 'incomplete' ? 'model-incomplete' : 'model-missing';
            const current = status.session;
            const owner = current ? owners.get(current.id) : undefined;
            if (!current || !owner) return { status: 200, body: { availability, session: null } };
            const own = owner?.user === user && owner.subject === expected && current.subject === expected;
            return { status: 200, body: { availability, session: own
                ? { id: current.id, state: current.state, own: true }
                : { id: owner?.user === user ? current.id : null, state: current.state, own: false, foreign: foreignOf(owner, user, current.subject) } } };
        },

        async create(user: string, input: { subject?: unknown; mode?: unknown; vocabulary?: unknown }): Promise<LocalVoiceReply> {
            const subject = localVoiceSubject(input.subject);
            const mode: LocalVoiceMode | null = input.mode === 'visit' || input.mode === 'dictation' ? input.mode : null;
            if (!subject || !mode) return { status: 400, body: { error: 'request' } };
            const voice = connect();
            if (!voice) return { status: 503, body: { error: 'off' } };
            try {
                const request: { mode: LocalVoiceMode; subject: string; vocabulary: string[] } = {
                    mode,
                    subject,
                    vocabulary: vocabularyOf(input.vocabulary),
                };
                const created = await voice.create(request).catch(async (error: unknown) => {
                    const orphan = orphanOf(error);
                    if (!orphan || owners.has(orphan)) throw error;
                    await voice.discard(orphan);
                    return voice.create(request);
                });
                if (created.subject !== subject) {
                    await voice.discard(created.id).catch(() => undefined);
                    return { status: 409, body: { error: 'subject-mismatch' } };
                }
                const owner: Owner = { user, subject, next: 0, queue: Promise.resolve() };
                owners.set(created.id, owner);
                return matching(owner, await voice.command(created.id, 'start'));
            } catch (error) { return failure(error); }
        },

        async snapshot(user: string, id: unknown, subject: unknown): Promise<LocalVoiceReply> {
            const owner = owned(id, user, subject);
            if (!owner) return { status: 404, body: { error: 'session-not-found' } };
            const voice = connect();
            if (!voice) return { status: 503, body: { error: 'off' } };
            try { return matching(owner, await voice.get(id as string)); } catch (error) { return failure(error); }
        },

        async command(user: string, id: unknown, subject: unknown, command: unknown): Promise<LocalVoiceReply> {
            const owner = owned(id, user, subject);
            if (!owner) return { status: 404, body: { error: 'session-not-found' } };
            if (command !== 'pause' && command !== 'resume' && command !== 'stop') return { status: 400, body: { error: 'request' } };
            const voice = connect();
            if (!voice) return { status: 503, body: { error: 'off' } };
            const run = owner.queue.then(() => voice.command(id as string, command));
            owner.queue = run.catch(() => undefined);
            try { return matching(owner, await run); } catch (error) { return failure(error); }
        },

        /** Blocks reach the service once each and in the page's order; a repeated block is acknowledged, not resent. */
        async audio(user: string, id: unknown, subject: unknown, sequence: unknown, pcm: Uint8Array): Promise<LocalVoiceReply> {
            const owner = owned(id, user, subject);
            if (!owner) return { status: 404, body: { error: 'session-not-found' } };
            const seq = typeof sequence === 'string' && /^(0|[1-9][0-9]{0,8})$/u.test(sequence) ? Number(sequence) : null;
            if (seq === null || pcm.byteLength === 0 || pcm.byteLength % 2 !== 0) return { status: 400, body: { error: 'request' } };
            const voice = connect();
            if (!voice) return { status: 503, body: { error: 'off' } };
            const run = owner.queue.then(async (): Promise<LocalVoiceReply> => {
                if (seq < owner.next) return { status: 202, body: { sequence: seq, repeated: true, expected: owner.next } };
                if (seq > owner.next) return { status: 409, body: { error: 'out-of-order', expected: owner.next } };
                await voice.audio(id as string, pcm);
                owner.next += 1;
                return { status: 202, body: { sequence: seq } };
            });
            owner.queue = run.catch(() => undefined);
            try { return await run; } catch (error) { return failure(error); }
        },

        async discard(user: string, id: unknown, subject: unknown): Promise<LocalVoiceReply> {
            const owner = owned(id, user, subject);
            if (!owner) return { status: 404, body: { error: 'session-not-found' } };
            const voice = connect();
            if (!voice) return { status: 503, body: { error: 'off' } };
            try {
                await voice.discard(id as string);
                owners.delete(id as string);
                return { status: 204, body: null };
            } catch (error) { return failure(error); }
        },
    };
}

export type LocalVoiceBridge = ReturnType<typeof createLocalVoiceBridge>;

const shared = globalThis as typeof globalThis & { mediflowLocalVoiceBridge?: LocalVoiceBridge };

export function localVoiceBridge(): LocalVoiceBridge {
    shared.mediflowLocalVoiceBridge ??= createLocalVoiceBridge();
    return shared.mediflowLocalVoiceBridge;
}
