import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('./native-access.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/u)![1];
const adapter = readFileSync(new URL('../../experiments/gpui-patient-pilot/app/src/chat_access/adapter.rs', import.meta.url), 'utf8');

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
    const button = elements.get('smart-import');
    assert.ok(button, 'la carta offre l’import assistito');
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

test('the adapter admits the smart import command and its four states', () => {
    for (const state of ['import-opened', 'import-unavailable', 'import-busy', 'import-closed']) assert.ok(adapter.includes(`"${state}"`), state);
    assert.match(adapter, /"booking-receipt","smart-import"\]/u);
});

test('smart import sends only its command and accepts finite status replies', async () => {
    const cases: [string, RegExp, boolean][] = [
        ['requested', /Richiesta inviata/u, false],
        ['preparing', /Verifica nella finestra/u, false],
        ['import-opened', /Prepara la richiesta nella finestra MediFlow/u, false],
        ['import-unavailable', /non disponibile/u, true],
        ['import-busy', /già in uso/u, true],
        ['import-closed', /concluso nella finestra MediFlow/u, true],
        ['synthesis-opened', /Apertura non confermata/u, true],
        ['withdrawn', /Apertura non confermata/u, true],
        ['consumed', /Apertura non confermata/u, true],
        ['insight-opened', /Apertura non confermata/u, true],
    ];
    for (const [status, label, terminal] of cases) {
        const view = await frame({ meta: { status } });
        assert.deepEqual(view.commands(), [{ command: 'attach' }, { command: 'smart-import' }], status);
        assert.match(view.elements.get('status').textContent, label, status);
        assert.equal(view.elements.get('card').hidden, true, status);
        assert.equal(view.elements.get('consume').disabled, true, status);
        assert.equal(view.polling(), !terminal, status);
        for (const id of ['smart-import', 'document-synthesis', 'patient-insight', 'local-voice', 'request', 'therapy-active']) {
            assert.equal(view.elements.get(id).disabled, true, `${status}: ${id}`);
        }
    }
});

test('smart import refuses every extra field without displaying clinical content', async () => {
    for (const meta of [
        { status: 'import-opened', summary: 'Ada Esempio, ipertensione' },
        { status: 'import-opened', payload: '{"summary":"Ada Esempio"}' },
        { status: 'import-opened', patientId: 'patient-b' },
        { status: 'import-opened', candidates: [{ title: 'Ipertensione' }] },
        { status: 'import-opened', noteId: 'note-b' },
        { status: 'import-opened', token: 'pph_foreign' },
        { status: 'import-opened', receipt: { commandId: 'a'.repeat(36), outcome: 'applied' } },
        { status: 'import-opened', sources: ['S1 · Ada Esempio'] },
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

test('revocation stays available through preparation, consent and generation', async () => {
    const host = { meta: { status: 'requested' } };
    const view = await frame(host);
    for (const status of ['requested', 'preparing', 'import-opened', 'import-opened']) {
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

test('import-closed ends chat ownership and stops status refreshes', async () => {
    const host = { meta: { status: 'import-opened' } };
    const view = await frame(host);
    assert.equal(view.elements.get('revoke').disabled, false);
    host.meta = { status: 'import-closed' };
    await view.tick();
    assert.match(view.elements.get('status').textContent, /concluso nella finestra MediFlow/u);
    assert.equal(view.elements.get('revoke').disabled, true);
    assert.equal(view.elements.get('smart-import').disabled, true);
    assert.equal(view.polling(), false);
    assert.equal(view.elements.get('card').hidden, true);
});
