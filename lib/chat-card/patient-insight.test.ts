import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '../..');
const html = readFileSync(join(root, 'lib/chat-card/native-access.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/u)![1];
const adapter = readFileSync(join(root, 'experiments/gpui-patient-pilot/app/src/chat_access/adapter.rs'), 'utf8');

/** Esegue la carta con un host fittizio che risponde a ogni comando con `meta`. */
async function frame(meta: unknown) {
    const elements = new Map<string, any>();
    for (const id of html.matchAll(/id="([^"]+)"/gu)) elements.set(id[1], { disabled: true, hidden: true, value: '', textContent: '', replaceChildren() {} });
    let onMessage: any;
    const commands: any[] = [];
    const parent = { postMessage(message: any) {
        if (!message.id) return;
        if (message.params?.arguments) commands.push(message.params.arguments);
        const result = message.method === 'ui/initialize' ? {} : { _meta: message.params?.arguments?.command === 'attach' ? { status: 'ready' } : meta };
        queueMicrotask(() => onMessage({ source: parent, data: { jsonrpc: '2.0', id: message.id, result } }));
    } };
    // Solo i rinnovi di stato (1 s); i timeout delle chiamate (10 s) non contano.
    const timers: number[] = [];
    vm.runInNewContext(script, {
        document: { getElementById: (id: string) => elements.get(id), documentElement: { scrollHeight: 400 } },
        window: { parent, addEventListener: (name: string, cb: any) => { if (name === 'message') onMessage = cb; } },
        requestAnimationFrame: (cb: any) => cb(), setTimeout: (_cb: () => void, delay: number) => { if (delay === 1000) timers.push(delay); return 0; }, clearTimeout() {},
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(elements.get('patient-insight').disabled, false);
    elements.get('patient-insight').onclick();
    await new Promise(resolve => setImmediate(resolve));
    return { elements, commands, timers };
}

test('the frame pins its script and the adapter admits the insight command and states', () => {
    assert.ok(html.includes(`script-src 'sha256-${createHash('sha256').update(script).digest('base64')}'`));
    for (const state of ['insight-opened', 'insight-unavailable', 'insight-busy']) assert.ok(adapter.includes(`"${state}"`), state);
    assert.match(adapter, /"local-voice","patient-insight","receipt"/u);
});

test('the insight command sends no argument and shows each state without clinical content', async () => {
    const cases: [string, RegExp, boolean][] = [
        ['insight-opened', /Quadro paziente aperto nella finestra MediFlow/u, true],
        ['insight-unavailable', /non disponibile/u, true],
        ['insight-busy', /già in uso/u, true],
        ['requested', /Richiesta inviata/u, false],
        ['preparing', /Verifica nella finestra/u, false],
        ['withdrawn', /Apertura non confermata/u, true],
        ['consumed', /Apertura non confermata/u, true],
    ];
    for (const [status, label, terminal] of cases) {
        const { elements, commands, timers } = await frame({ status });
        assert.deepEqual(JSON.parse(JSON.stringify(commands)), [{ command: 'attach' }, { command: 'patient-insight' }], status);
        assert.match(elements.get('status').textContent, label, status);
        assert.equal(elements.get('card').hidden, true, status);
        assert.equal(elements.get('consume').disabled, true, status);
        assert.equal(timers.length > 0, !terminal, `${status}: solo gli stati intermedi richiedono un nuovo stato`);
        for (const id of ['patient-insight', 'local-voice', 'request', 'therapy-active']) assert.equal(elements.get(id).disabled, true, `${status}: ${id}`);
    }
});

test('a reply carrying any field beyond the state is refused and never displayed', async () => {
    for (const meta of [
        { status: 'insight-opened', summary: 'Ada Esempio, ipertensione' },
        { status: 'insight-opened', payload: '{"summary":"Ada Esempio"}' },
        { status: 'insight-opened', receipt: { commandId: 'a'.repeat(36), outcome: 'applied' } },
        { status: 'insight-opened', sources: ['S1 · Ada Esempio'] },
        null,
    ]) {
        const { elements, timers } = await frame(meta);
        assert.match(elements.get('status').textContent, /Apertura non confermata/u);
        assert.ok(!elements.get('status').textContent.includes('Ada'));
        assert.equal(elements.get('card').hidden, true);
        assert.equal(timers.length, 0);
    }
});
