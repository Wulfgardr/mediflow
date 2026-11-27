import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test, { after, afterEach, beforeEach } from 'node:test';
import { startFakeLocalVoice } from './fake-service.test-support.ts';
import { createLocalVoiceBridge, type LocalVoiceReply } from './web-bridge.ts';

type Gate = { open: () => void; promise: Promise<void> };
type Microphone = { onBlock: (pcm: Uint8Array) => void; closed: boolean };
const microphones = {
    opened: [] as Microphone[],
    gate: null as Gate | null,
    emit(count: number, marker: number) {
        const live = microphones.opened.filter((item) => !item.closed).at(-1);
        assert.ok(live, 'no open microphone');
        for (let index = 0; index < count; index += 1) live.onBlock(new Uint8Array(new Int16Array(800).fill(marker + index).buffer));
    },
};
(globalThis as Record<string, unknown>).mediflowTestMicrophones = microphones;
const fakeMicrophoneDir = mkdtempSync(join(tmpdir(), 'mediflow-recorder-microphone-'));
const fakeMicrophonePath = join(fakeMicrophoneDir, 'microphone.mjs');
writeFileSync(fakeMicrophonePath, `
export class MicrophoneUnavailable extends Error { constructor(reason) { super(reason); this.reason = reason; } }
export async function openMicrophone(onBlock) {
    const state = globalThis.mediflowTestMicrophones;
    const microphone = { onBlock, closed: false };
    if (state.gate) await state.gate.promise;
    state.opened.push(microphone);
    return { flush: async () => {}, close: async () => { microphone.closed = true; } };
}`);
const fakeMicrophone = pathToFileURL(fakeMicrophonePath).href;
const load = createRequire(import.meta.url);
const { registerHooks } = load('node:module') as {
    registerHooks: (hooks: { resolve: (specifier: string, context: { parentURL?: string }, next: (specifier: string, context: unknown) => { url: string }) => { url: string; shortCircuit?: boolean } }) => { deregister: () => void };
};
const hooks = registerHooks({ resolve(specifier, context, next) {
    return specifier === './microphone' && context.parentURL?.endsWith('/lib/local-voice/recorder.ts') ? { url: fakeMicrophone, shortCircuit: true } : next(specifier, context);
} });
const { LocalVoiceRecorder: Recorder } = await import('./recorder.ts');
const created: InstanceType<typeof Recorder>[] = [];
class LocalVoiceRecorder extends Recorder {
    constructor(subject: string) { super(subject); created.push(this); }
}
afterEach(() => { for (const recorder of created.splice(0)) recorder.dispose(); });

const secret = crypto.randomBytes(32).toString('hex');
const fake = await startFakeLocalVoice({ secret, lines: [{ speaker: 'doctor', text: 'Buongiorno.' }] });
const bridge = createLocalVoiceBridge({ endpoint: () => ({ url: fake.url, secret }) });
const USER = 'voice-recorder-user';
const SUBJECT = 'paziente:33333333-3333-4333-8333-333333333333';
const original = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://127.0.0.1:3000');
    const method = init?.method ?? 'GET';
    const subject = url.searchParams.get('subject');
    const parts = url.pathname.split('/').filter(Boolean);
    const json = () => JSON.parse(String(init?.body ?? 'null'));
    let reply: LocalVoiceReply;
    if (parts.length === 2) reply = method === 'GET' ? await bridge.status(USER, subject) : await bridge.create(USER, json());
    else if (parts[3] === 'audio') reply = await bridge.audio(USER, parts[2], subject, url.searchParams.get('seq'), new Uint8Array(await (init!.body as Blob).arrayBuffer()));
    else if (parts[3] === 'commands') { const body = json(); reply = await bridge.command(USER, parts[2], body.subject, body.command); }
    else reply = method === 'DELETE' ? await bridge.discard(USER, parts[2], subject) : await bridge.snapshot(USER, parts[2], subject);
    return reply.status === 204 ? new Response(null, { status: 204 }) : Response.json(reply.body, { status: reply.status });
}) as typeof fetch;

after(async () => {
    globalThis.fetch = original;
    hooks.deregister();
    await fake.close();
    rmSync(fakeMicrophoneDir, { recursive: true, force: true });
});
beforeEach(async () => {
    microphones.opened.length = 0;
    microphones.gate = null;
    if (fake.state.session) await bridge.discard(USER, fake.state.session.id, SUBJECT);
    fake.state.requests.length = 0;
});

const settle = async (check: () => boolean, label: string) => {
    for (let attempt = 0; attempt < 100 && !check(); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(check(), label);
};
const gate = (): Gate => { let open = () => {}; const promise = new Promise<void>((resolve) => { open = resolve; }); return { open, promise }; };
const markers = () => fake.state.blocks.map((block) => new Int16Array(block.buffer, block.byteOffset, 1)[0]);

test('pausa, uscita e rientro: la ripresa consegna al servizio tutti i blocchi nuovi', async () => {
    const first = new LocalVoiceRecorder(SUBJECT);
    await first.refresh();
    await first.start('visit', []);
    await settle(() => first.getSnapshot().snapshot?.state === 'preparing', 'preparing');
    microphones.emit(3, 100);
    await settle(() => fake.state.blocks.length === 3, 'three blocks before the pause');
    await first.pause();
    assert.equal(fake.state.session?.state, 'paused');
    first.dispose();

    const second = new LocalVoiceRecorder(SUBJECT);
    await second.refresh();
    await settle(() => second.getSnapshot().snapshot?.state === 'paused', 'the new surface finds the paused session');
    await second.resume();
    await settle(() => second.getSnapshot().snapshot?.state === 'preparing' || second.getSnapshot().snapshot?.state === 'recording', 'resumed');
    microphones.emit(4, 200);
    await settle(() => fake.state.blocks.length === 7, 'every block after the resume reaches the service');
    assert.deepEqual(markers(), [100, 101, 102, 200, 201, 202, 203]);
    second.dispose();
});

test('una conferma di duplicato per un blocco mai mandato non vale come consegna', async () => {
    const recorder = new LocalVoiceRecorder(SUBJECT);
    await recorder.refresh();
    await recorder.start('visit', []);
    await settle(() => recorder.getSnapshot().snapshot?.state === 'preparing', 'preparing');
    microphones.emit(2, 300);
    await settle(() => fake.state.blocks.length === 2, 'two blocks');
    const session = fake.state.session!.id;
    assert.equal((await bridge.audio(USER, session, SUBJECT, '2', new Uint8Array(new Int16Array(800).fill(399).buffer))).status, 202);
    microphones.emit(2, 310);
    await settle(() => fake.state.blocks.length === 5, 'blocks sent after someone else advanced the sequence still arrive');
    assert.deepEqual(markers(), [300, 301, 399, 310, 311]);
    recorder.dispose();
});

test('chiuso mentre il microfono si apre: il microfono si chiude e nessuna sessione nasce', async () => {
    microphones.gate = gate();
    const recorder = new LocalVoiceRecorder(SUBJECT);
    await recorder.refresh();
    const starting = recorder.start('visit', []);
    recorder.dispose();
    microphones.gate.open();
    await starting;
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(microphones.opened.length, 1);
    assert.equal(microphones.opened[0].closed, true);
    assert.equal(fake.state.requests.filter((item) => item.path === '/v1/sessions').length, 0);
    assert.equal(fake.state.session, null);
});

test('chiuso mentre il microfono si riapre dopo la pausa: nessuna ripresa e microfono chiuso', async () => {
    const recorder = new LocalVoiceRecorder(SUBJECT);
    await recorder.refresh();
    await recorder.start('visit', []);
    await settle(() => recorder.getSnapshot().snapshot?.state === 'preparing', 'preparing');
    microphones.emit(1, 500);
    await settle(() => fake.state.blocks.length === 1, 'one block');
    await recorder.pause();
    microphones.gate = gate();
    const resuming = recorder.resume();
    recorder.dispose();
    microphones.gate.open();
    await resuming;
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.ok(microphones.opened.every((item) => item.closed));
    assert.equal(fake.state.session?.state, 'paused');
    assert.equal(fake.state.requests.filter((item) => item.path.endsWith('/commands')).length, 2);
});

test('due schede aperte: la scheda di un altro paziente non riceve né consegna il testo, e una risposta per un altro soggetto non si consegna', async () => {
    const OTHER = 'paziente:44444444-4444-4444-8444-444444444444';
    const recorder = new LocalVoiceRecorder(SUBJECT);
    await recorder.refresh();
    await recorder.start('visit', []);
    await settle(() => recorder.getSnapshot().snapshot?.state === 'preparing', 'preparing');
    microphones.emit(1, 500);
    await settle(() => fake.state.blocks.length === 1, 'one block');
    await recorder.stop();
    await settle(() => recorder.getSnapshot().phase === 'review', 'review');

    const elsewhere = new LocalVoiceRecorder(OTHER);
    await elsewhere.refresh();
    assert.equal(elsewhere.getSnapshot().phase, 'foreign');
    assert.equal(elsewhere.getSnapshot().review, null);
    assert.equal(await elsewhere.take(), null);
    assert.equal(fake.state.session?.state, 'review');

    fake.state.subjectOverride = OTHER;
    const late = new LocalVoiceRecorder(SUBJECT);
    await late.refresh();
    fake.state.subjectOverride = null;
    assert.equal(late.getSnapshot().review, null);
    assert.equal(await late.take(), null);
    assert.equal(await recorder.take(), 'Medico: Buongiorno.');
    assert.equal(fake.state.session, null);
});
