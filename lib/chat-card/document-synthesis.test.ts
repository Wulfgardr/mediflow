import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('./native-access.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/u)![1];

async function frame(host: { meta: unknown }) {
    const elements = new Map<string, any>();
    for (const id of html.matchAll(/id="([^"]+)"/gu)) {
        elements.set(id[1], { disabled: true, hidden: true, value: '', textContent: '', replaceChildren() {} });
    }
    let onMessage: any;
    const commands: unknown[] = [];
    const parent = { postMessage(message: any) {
        if (!message.id) return;
        const args = message.params?.arguments;
        if (args) commands.push(args);
        const result = message.method === 'ui/initialize' ? {} : {
            _meta: args?.command === 'attach' ? { status: 'ready' }
                : args?.command === 'revoke' ? { status: 'withdrawn' } : host.meta,
        };
        queueMicrotask(() => onMessage({ source: parent, data: { jsonrpc: '2.0', id: message.id, result } }));
    } };
    let polls: (() => void)[] = [];
    vm.runInNewContext(script, {
        document: { getElementById: (id: string) => elements.get(id), documentElement: { scrollHeight: 400 } },
        window: { parent, addEventListener: (name: string, cb: any) => { if (name === 'message') onMessage = cb; } },
        requestAnimationFrame: (cb: () => void) => cb(),
        setTimeout: (cb: () => void, delay: number) => { if (delay === 1000) polls.push(cb); return 0; },
        clearTimeout() {},
    });
    const settle = () => new Promise(resolve => setImmediate(resolve));
    await settle();
    const button = elements.get('document-synthesis');
    assert.ok(button, 'la carta offre la sintesi dei documenti');
    assert.equal(button.disabled, false);
    button.onclick();
    await settle();
    return {
        elements, settle,
        commands: () => JSON.parse(JSON.stringify(commands)),
        polling: () => polls.length > 0,
        tick: async () => { const due = polls; polls = []; for (const poll of due) poll(); await settle(); },
    };
}

test('document synthesis sends only its command and accepts finite status replies', async () => {
    const cases: [string, RegExp, boolean][] = [
        ['requested', /Richiesta inviata/u, false],
        ['preparing', /Verifica nella finestra/u, false],
        ['synthesis-opened', /Scegli il documento nella finestra MediFlow/u, false],
        ['synthesis-unavailable', /non disponibile/u, true],
        ['synthesis-busy', /già in uso/u, true],
        ['synthesis-closed', /conclusa nella finestra MediFlow/u, true],
        ['withdrawn', /Apertura non confermata/u, true],
        ['consumed', /Apertura non confermata/u, true],
        ['insight-opened', /Apertura non confermata/u, true],
    ];
    for (const [status, label, terminal] of cases) {
        const view = await frame({ meta: { status } });
        assert.deepEqual(view.commands(), [{ command: 'attach' }, { command: 'document-synthesis' }], status);
        assert.match(view.elements.get('status').textContent, label, status);
        assert.equal(view.elements.get('card').hidden, true, status);
        assert.equal(view.elements.get('consume').disabled, true, status);
        assert.equal(view.polling(), !terminal, status);
        for (const id of ['document-synthesis', 'patient-insight', 'local-voice', 'request', 'therapy-active']) {
            assert.equal(view.elements.get(id).disabled, true, `${status}: ${id}`);
        }
    }
});

test('document synthesis refuses every extra field without displaying clinical content', async () => {
    for (const meta of [
        { status: 'synthesis-opened', summary: 'Ada Esempio, ipertensione' },
        { status: 'synthesis-opened', payload: '{"summary":"Ada Esempio"}' },
        { status: 'synthesis-opened', patientId: 'patient-b' },
        { status: 'synthesis-opened', attachmentId: 'document-b' },
        { status: 'synthesis-opened', token: 'pph_foreign' },
        { status: 'synthesis-opened', receipt: { commandId: 'a'.repeat(36), outcome: 'applied' } },
        { status: 'synthesis-opened', sources: ['S1 · Ada Esempio'] },
        null,
    ]) {
        const view = await frame({ meta });
        assert.match(view.elements.get('status').textContent, /Apertura non confermata/u);
        assert.ok(!view.elements.get('status').textContent.includes('Ada'));
        assert.equal(view.elements.get('card').hidden, true);
        assert.equal(view.elements.get('revoke').disabled, true);
        assert.equal(view.polling(), false);
    }
});

test('revocation stays available through document selection, consent and generation', async () => {
    const host = { meta: { status: 'requested' } };
    const view = await frame(host);
    for (const status of ['requested', 'preparing', 'synthesis-opened', 'synthesis-opened']) {
        host.meta = { status };
        await view.tick();
        assert.equal(view.elements.get('revoke').disabled, false, status);
        assert.equal(view.elements.get('consume').disabled, true, status);
        assert.equal(view.polling(), true, status);
    }
    view.elements.get('revoke').onclick();
    await view.settle();
    assert.deepEqual(view.commands().at(-1), { command: 'revoke' });
    assert.match(view.elements.get('status').textContent, /Richiesta ritirata/u);
    assert.equal(view.elements.get('revoke').disabled, true);
});

test('synthesis-closed ends chat ownership and stops status refreshes', async () => {
    const host = { meta: { status: 'synthesis-opened' } };
    const view = await frame(host);
    assert.equal(view.elements.get('revoke').disabled, false);
    host.meta = { status: 'synthesis-closed' };
    await view.tick();
    assert.match(view.elements.get('status').textContent, /conclusa nella finestra MediFlow/u);
    assert.equal(view.elements.get('revoke').disabled, true);
    assert.equal(view.elements.get('document-synthesis').disabled, true);
    assert.equal(view.polling(), false);
    assert.equal(view.elements.get('card').hidden, true);
});
