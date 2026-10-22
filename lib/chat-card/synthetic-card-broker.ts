/** Synthetic host composition only. No archive, caller content or transport. */
import 'server-only';
import { randomBytes } from 'node:crypto';
import { types } from 'node:util';
import { z } from 'zod';
import { createContentPreparation, readPreparedContent, type PreparedContent, type PreparedContentRead, type PreparationRunnerConfiguration } from '../ai-preparation/preparation-core';
import { evaluateRedactionRuntimeEvidence, evidenceHash } from '../ai-redaction-evidence';
import { assertCardSerializedBoundary, cardEmissionPlan, selectionSchema, type Card, type CardSelection } from './card-profile';
import { projectSyntheticCard, syntheticCardFixture, SYNTHETIC_CARD_CORPUS_JSON } from './synthetic-fixtures';

export type PreparedSyntheticCard = object;
export type SyntheticCardConsent = object;
export type SyntheticCardInstallation = Readonly<{ runner: PreparationRunnerConfiguration;
    evidence: Readonly<{ validationJson: string; rolloutJson: string }> }>;
const configurationSchema = z.strictObject({ runner: z.strictObject({ pythonExecutable: z.string().min(1).max(4096),
    workerPath: z.string().min(1).max(4096), modelDirectory: z.string().min(1).max(4096) }),
    evidence: z.strictObject({ validationJson: z.string().min(1).max(2_097_152), rolloutJson: z.string().min(1).max(2_097_152) }) });
const fail = (): never => { throw new Error('synthetic_card_denied'); };
const opaque = () => Object.freeze(Object.create(null)) as object;
const random = (prefix: string) => prefix + randomBytes(16).toString('hex');
const SESSION_MS = 10 * 60_000, CONSENT_MS = 2 * 60_000;

function plainData(value: unknown, depth = 0): void {
    if (depth > 8) return fail();
    if (!value || typeof value !== 'object') return;
    if (types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return fail();
    for (const key of Reflect.ownKeys(value)) {
        const d = Object.getOwnPropertyDescriptor(value, key);
        if (typeof key !== 'string' || !d?.enumerable || !('value' in d)) return fail();
        plainData(d.value, depth + 1);
    }
}
type Attempt = { token: object; id: string; generation: number; patient: string; selection: CardSelection;
    controller: AbortController; job: ReturnType<typeof createContentPreparation>; core?: PreparedContent;
    expected: Card; sourceRef: string; payloadSha256?: string; payload?: string; consumed: boolean };

/** Only trusted local code receives owner. The future transport receives reader
 * and opaque handles, never fixture selection, mappings or an approval boolean. */
export function createSyntheticCardBroker(input: SyntheticCardInstallation) {
    let installation: z.infer<typeof configurationSchema>;
    try { plainData(input); installation = configurationSchema.parse(input); } catch { return fail(); }
    let validation: unknown, rollout: unknown;
    try { validation = JSON.parse(installation.evidence.validationJson); rollout = JSON.parse(installation.evidence.rolloutJson); } catch { return fail(); }
    const corpus = JSON.parse(SYNTHETIC_CARD_CORPUS_JSON);
    const validationSha256 = evidenceHash(installation.evidence.validationJson), corpusSha256 = evidenceHash(SYNTHETIC_CARD_CORPUS_JSON);
    const session = random('session_'), started = Date.now(), expires = started + SESSION_MS;
    let pseudonym = random('card_');
    let lastTime = started, generation = 0, patient: string | undefined, revoked = false, active: Attempt | undefined;
    let cleanup = Promise.resolve();
    const prepared = new WeakMap<object, Attempt>();
    const consents = new WeakMap<object, { attempt: Attempt; digest: string; expires: number }>();
    function now(): number {
        const time = Date.now();
        if (revoked || !Number.isFinite(time) || time < lastTime || time >= expires) {
            revoked = true; patient = undefined;
            clearTimeout(timer);
            void retire().catch(() => {});
            return fail();
        }
        lastTime = time;
        return time;
    }
    function handle(value: unknown): object {
        if (!value || typeof value !== 'object' || types.isProxy(value)) return fail();
        return value;
    }
    function current(attempt: Attempt): void {
        now();
        if (active !== attempt || attempt.consumed || attempt.generation !== generation || attempt.patient !== patient || attempt.controller.signal.aborted) return fail();
    }
    function boundary(attempt: Attempt): PreparedContentRead {
        current(attempt);
        if (!attempt.core) return fail();
        const read = readPreparedContent(attempt.core);
        assertCardSerializedBoundary(read, attempt.expected);
        if (evidenceHash(read.payload) !== read.payloadSha256 || Buffer.byteLength(read.payload, 'utf8') !== read.payloadBytes) return fail();
        const evaluated = evaluateRedactionRuntimeEvidence({ validation, validationSha256, corpus, corpusSha256, rollout,
            observed: read.redactionIdentity, now: now() });
        if (evaluated.status !== 'valid') return fail();
        return read;
    }
    function retire(): Promise<void> {
        const previous = active;
        active = undefined;
        if (!previous) return cleanup;
        prepared.delete(previous.token);
        previous.controller.abort();
        cleanup = Promise.all([cleanup, previous.job.close()]).then(() => {});
        void cleanup.catch(() => {});
        return cleanup;
    }
    const owner = Object.freeze({
        selectPatient(selected: string): Promise<void> {
            now();
            if (typeof selected !== 'string') return fail();
            syntheticCardFixture(selected);
            generation++; patient = selected; pseudonym = random('card_');
            return retire();
        },
        async prepare(selectionInput: CardSelection): Promise<PreparedSyntheticCard> {
            try {
                now();
                if (!patient) return fail();
                plainData(selectionInput);
                const selection = Object.freeze(selectionSchema.parse(selectionInput));
                const previousCleanup = retire();
                const token = opaque(), controller = new AbortController(), sourceRef = random('src_');
                const expected = projectSyntheticCard(patient, selection, pseudonym, sourceRef);
                const job = createContentPreparation(cardEmissionPlan(expected), installation.runner, text => JSON.parse(text), controller.signal);
                const attempt: Attempt = { token, id: random('attempt_'), generation, patient, selection, expected, sourceRef, job, controller, consumed: false };
                active = attempt;
                try {
                    await previousCleanup;
                    attempt.core = await job.ready;
                    const read = boundary(attempt);
                    attempt.payloadSha256 = read.payloadSha256; attempt.payload = read.payload;
                    prepared.set(token, attempt);
                    return token;
                } catch {
                    if (active === attempt) await retire(); else await job.close();
                    return fail();
                }
            } catch { return fail(); }
        },
        review(token: PreparedSyntheticCard) {
            try {
                const attempt = prepared.get(handle(token)) ?? fail(), read = boundary(attempt);
                if (read.payload !== attempt.payload || read.payloadSha256 !== attempt.payloadSha256) return fail();
                return Object.freeze({ patient: attempt.patient, selection: attempt.selection, session, attempt: attempt.id,
                    payload: read.payload, payloadSha256: read.payloadSha256, payloadBytes: read.payloadBytes });
            } catch { return fail(); }
        },
        approve(token: PreparedSyntheticCard, reviewedPayloadSha256: string): SyntheticCardConsent {
            try {
                const attempt = prepared.get(handle(token)) ?? fail(), read = boundary(attempt);
                if (typeof reviewedPayloadSha256 !== 'string' || read.payload !== attempt.payload
                    || read.payloadSha256 !== attempt.payloadSha256 || reviewedPayloadSha256 !== read.payloadSha256) return fail();
                const consent = opaque();
                consents.set(consent, { attempt, digest: read.payloadSha256, expires: Math.min(now() + CONSENT_MS, expires) });
                return consent;
            } catch { return fail(); }
        },
        resolveSource(token: PreparedSyntheticCard, reference: string) {
            const attempt = prepared.get(handle(token)) ?? fail();
            current(attempt);
            if (reference !== attempt.sourceRef) return fail();
            const source = syntheticCardFixture(attempt.patient).localSource;
            return Object.freeze({ ...source });
        },
        revoke(): Promise<void> { revoked = true; generation++; patient = undefined; clearTimeout(timer); return retire(); },
        close(): Promise<void> { return owner.revoke(); },
    });
    const reader = Object.freeze({
        takeApprovedBytes(token: PreparedSyntheticCard, consentToken: SyntheticCardConsent): string {
            try {
                const attempt = prepared.get(handle(token)) ?? fail(), consent = consents.get(handle(consentToken)) ?? fail();
                if (consent.attempt !== attempt || now() >= consent.expires) return fail();
                const read = boundary(attempt);
                if (read.payloadSha256 !== consent.digest || read.payload !== attempt.payload || read.payloadSha256 !== attempt.payloadSha256) return fail();
                attempt.consumed = true; consents.delete(consentToken);
                return read.payload;
            } catch { return fail(); }
        },
    });
    const timer = setTimeout(() => { void owner.revoke().catch(() => {}); }, SESSION_MS);
    timer.unref();
    return Object.freeze({ owner, reader });
}
