/* PROPOSED, standalone synthetic proof. Never wired to a host or clinical owner. */
import { types } from 'node:util';
import { performance } from 'node:perf_hooks';
import { channelFor, fixtureFor, payloadFor, encodePayload, payloadHash, DESTINATION, TTL_MS,
    type Channel, type Payload } from './contract';
import { PROFILE, type FixtureId } from './fixture';
import { evaluatePayload } from './evaluator';

type State = 'prepared' | 'granted' | 'evaluating' | 'consumed' | 'denied' | 'cancelled';
type Attempt = { state: State; generation: number; channel: Channel; payload: Payload;
    bytes: string; hash: string; createdAt: number; expiresAt: number; deadline: number };
export type DispatchOutcome = 'dispatched' | 'denied' | 'stale' | 'busy' | 'already_used' | 'invalid'
    | 'consent_required' | 'evaluation_failed' | 'sink_failed';
/** Sink is a trusted in-process test transport, fixed at construction. This
 * proves bytes supplied to it, not its destination behavior or network framing. */
export function createSyntheticDisclosureSession(sink: (channel: Channel, payload: Payload) => Promise<void>) {
    if (typeof sink !== 'function') throw new Error('synthetic_sink_invalid');
    const attempts = new WeakMap<object, Attempt>();
    let selected: FixtureId | null = null, generation = 0, closed = false, count = 0;
    const record = (token: unknown): Attempt | undefined =>
        token && typeof token === 'object' && !types.isProxy(token) ? attempts.get(token) : undefined;
    const current = (attempt: Attempt): boolean => {
        const now = Date.now();
        const usable = attempt.state === 'prepared' || attempt.state === 'granted' || attempt.state === 'evaluating';
        const valid = usable && !closed && selected !== null && generation === attempt.generation
            && Number.isSafeInteger(now) && now >= attempt.createdAt && now < attempt.expiresAt
            && performance.now() < attempt.deadline;
        // Observed staleness is terminal, including a concurrent dispatch while
        // evaluation awaits. Clock recovery can never revive this authorization.
        if (!valid && attempt.state !== 'consumed') attempt.state = 'denied';
        return valid;
    };
    return Object.freeze({
        select(id: unknown): void {
            const fixture = fixtureFor(id);
            if (closed) throw new Error('synthetic_session_closed');
            selected = fixture; generation++;
        },
        prepare(channelValue: unknown): object {
            const channel = channelFor(channelValue);
            if (closed || !selected || count >= 64) throw new Error('synthetic_preparation_unavailable');
            const now = Date.now();
            if (!Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - TTL_MS) throw new Error('synthetic_clock_invalid');
            const payload = payloadFor(channel, selected), bytes = encodePayload(channel, payload);
            const token = Object.freeze(Object.create(null));
            attempts.set(token, { state: 'prepared', generation, channel, payload, bytes, hash: payloadHash(bytes),
                createdAt: now, expiresAt: now + TTL_MS, deadline: performance.now() + TTL_MS });
            count++;
            return token;
        },
        disclosure(token: unknown) {
            const attempt = record(token);
            if (!attempt || !current(attempt) || attempt.state !== 'prepared') throw new Error('synthetic_disclosure_unavailable');
            return Object.freeze({ status: 'Proposed' as const, profile: PROFILE, destination: DESTINATION,
                channel: attempt.channel, payloadSha256: attempt.hash, payloadBytes: Buffer.byteLength(attempt.bytes, 'utf8'),
                expiresAt: attempt.expiresAt });
        },
        confirm(token: unknown, expectedPayloadSha256: unknown): boolean {
            const attempt = record(token);
            if (!attempt || !current(attempt) || attempt.state !== 'prepared' || attempt.hash !== expectedPayloadSha256) return false;
            attempt.state = 'granted'; return true;
        },
        cancel(token: unknown): void {
            const attempt = record(token);
            if (attempt && attempt.state !== 'consumed' && attempt.state !== 'denied') attempt.state = 'cancelled';
        },
        revoke(): void { closed = true; selected = null; generation++; },
        async dispatch(token: unknown): Promise<DispatchOutcome> {
            const attempt = record(token);
            if (!attempt) return 'invalid';
            if (attempt.state === 'consumed' || attempt.state === 'denied') return 'already_used';
            if (!current(attempt)) return 'stale';
            if (attempt.state === 'evaluating') return 'busy';
            if (attempt.state !== 'granted') return 'consent_required';
            attempt.state = 'evaluating';
            let evaluated: Awaited<ReturnType<typeof evaluatePayload>>;
            try { evaluated = await evaluatePayload(attempt.bytes); }
            catch { attempt.state = 'denied'; return 'evaluation_failed'; }
            // No await or external callback between final validation, consumption
            // and sink invocation. Already dispatched bytes cannot be recalled.
            if (attempt.state !== 'evaluating' || !current(attempt)) { attempt.state = 'denied'; return 'stale'; }
            if (evaluated.status !== 'allowed' || evaluated.payloadSha256 !== attempt.hash
                || encodePayload(attempt.channel, attempt.payload) !== attempt.bytes
                || payloadHash(attempt.bytes) !== attempt.hash) { attempt.state = 'denied'; return 'denied'; }
            if (attempt.state !== 'evaluating' || !current(attempt)) { attempt.state = 'denied'; return 'stale'; }
            attempt.state = 'consumed'; // BEFORE dispatch, including synchronous throw.
            try { await sink(attempt.channel, attempt.payload); return 'dispatched'; }
            catch { return 'sink_failed'; } // No automatic retry or renewed grant.
        },
    });
}
