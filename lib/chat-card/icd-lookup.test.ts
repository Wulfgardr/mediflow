import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('./native-access.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/u)![1];
const adapter = readFileSync(new URL('../../experiments/gpui-patient-pilot/app/src/chat_access/adapter.rs', import.meta.url), 'utf8');

async function frame(host: { meta: unknown }, command = 'icd-lookup') {
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
    const button = elements.get(command);
    assert.ok(button, `la carta offre ${command}`);
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

test('the adapter admits the ICD lookup command and its four states', () => {
    for (const state of ['icd-opened', 'icd-unavailable', 'icd-busy', 'icd-closed']) assert.ok(adapter.includes(`"${state}"`), state);
    assert.ok(adapter.includes('"icd-lookup"'));
});

test('ICD lookup sends only its command and accepts finite status replies', async () => {
    const cases: [string, RegExp, boolean][] = [
        ['requested', /Richiesta inviata/u, false],
        ['preparing', /Verifica nella finestra/u, false],
        ['icd-opened', /Cerca nella finestra MediFlow/u, false],
        ['icd-unavailable', /non disponibile/u, true],
        ['icd-busy', /già in uso/u, true],
        ['icd-closed', /conclusa nella finestra MediFlow/u, true],
        ['synthesis-opened', /Apertura non confermata/u, true],
        ['withdrawn', /Apertura non confermata/u, true],
        ['consumed', /Apertura non confermata/u, true],
        ['insight-opened', /Apertura non confermata/u, true],
    ];
    for (const [status, label, terminal] of cases) {
        const view = await frame({ meta: { status } });
        assert.deepEqual(view.commands(), [{ command: 'attach' }, { command: 'icd-lookup' }], status);
        assert.match(view.elements.get('status').textContent, label, status);
        assert.equal(view.elements.get('card').hidden, true, status);
        assert.equal(view.elements.get('consume').disabled, true, status);
        assert.equal(view.polling(), !terminal, status);
        for (const id of ['icd-lookup', 'document-synthesis', 'patient-insight', 'local-voice', 'request', 'therapy-active']) {
            assert.equal(view.elements.get(id).disabled, true, `${status}: ${id}`);
        }
    }
});

test('ICD lookup refuses every extra field without displaying clinical content', async () => {
    for (const meta of [
        { status: 'icd-opened', summary: 'Ada Esempio, ipertensione' },
        { status: 'icd-opened', payload: '{"summary":"Ada Esempio"}' },
        { status: 'icd-opened', patientId: 'patient-b' },
        { status: 'icd-opened', candidates: [{ title: 'Ipertensione' }] },
        { status: 'icd-opened', noteId: 'note-b' },
        { status: 'icd-opened', token: 'pph_foreign' },
        { status: 'icd-opened', receipt: { commandId: 'a'.repeat(36), outcome: 'applied' } },
        { status: 'icd-opened', sources: ['S1 · Ada Esempio'] },
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

test('revocation stays available through admission and consultation', async () => {
    const host = { meta: { status: 'requested' } };
    const view = await frame(host);
    for (const status of ['requested', 'preparing', 'icd-opened', 'icd-opened']) {
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

test('icd-closed ends chat ownership and stops status refreshes', async () => {
    const host = { meta: { status: 'icd-opened' } };
    const view = await frame(host);
    assert.equal(view.elements.get('revoke').disabled, false);
    host.meta = { status: 'icd-closed' };
    await view.tick();
    assert.match(view.elements.get('status').textContent, /conclusa nella finestra MediFlow/u);
    assert.equal(view.elements.get('revoke').disabled, true);
    assert.equal(view.elements.get('icd-lookup').disabled, true);
    assert.equal(view.polling(), false);
    assert.equal(view.elements.get('card').hidden, true);
});

test('follow-ups open from the Web chat using only the current native patient and return a status receipt', async () => {
    for (const [status, terminal] of [['requested', false], ['preparing', false], ['loops-opened', false],
        ['loops-closed', true], ['loops-unavailable', true], ['loops-busy', true]] as const) {
        const view = await frame({ meta: { status } }, 'open-loops');
        assert.deepEqual(view.commands(), [{ command: 'attach' }, { command: 'open-loops' }]);
        assert.equal(view.elements.get('card').hidden, true);
        assert.equal(view.elements.get('consume').disabled, true);
        assert.equal(view.polling(), !terminal);
        assert.ok(adapter.includes(`"${status}"`), status);
        if (status === 'loops-closed') assert.match(view.elements.get('status').textContent, /Follow-up consultati/u);
    }
});

test('Web follow-ups reject foreign patient, denied permission and clinical or receipt payloads', async () => {
    for (const meta of [{ status: 'withdrawn' }, { status: 'icd-closed' },
        { status: 'loops-opened', patientId: 'patient-b' },
        { status: 'loops-closed', receipt: { outcome: 'read' } },
        { status: 'loops-opened', payload: 'Referto sintetico' },
        { status: 'loops-opened', groups: [] }]) {
        const view = await frame({ meta }, 'open-loops');
        assert.equal(view.polling(), false);
        assert.equal(view.elements.get('card').hidden, true);
        assert.match(view.elements.get('status').textContent, /Apertura non confermata/u);
    }
});

test('Web follow-ups discard a late successful status after revocation', async () => {
    const host = { meta: { status: 'loops-opened' } };
    const view = await frame(host, 'open-loops');
    assert.equal(view.elements.get('revoke').disabled, false);
    view.elements.get('revoke').onclick();
    await view.settle();
    host.meta = { status: 'loops-closed' };
    await view.tick();
    assert.match(view.elements.get('status').textContent, /Richiesta ritirata/u);
    assert.equal(view.polling(), false);
    assert.equal(view.elements.get('card').hidden, true);
});

test('document evidence open from the Web chat using only the current native patient and return a status receipt', async () => {
    for (const [status, terminal] of [['requested', false], ['preparing', false], ['evidence-opened', false],
        ['evidence-closed', true], ['evidence-unavailable', true], ['evidence-busy', true]] as const) {
        const view = await frame({ meta: { status } }, 'evidence-queue');
        assert.deepEqual(view.commands(), [{ command: 'attach' }, { command: 'evidence-queue' }]);
        assert.equal(view.elements.get('card').hidden, true);
        assert.equal(view.elements.get('consume').disabled, true);
        assert.equal(view.polling(), !terminal);
        assert.ok(adapter.includes(`"${status}"`), status);
        if (status === 'evidence-closed') assert.match(view.elements.get('status').textContent, /Evidenze consultate/u);
    }
});

test('Web document evidence reject foreign patient, denied permission and clinical or receipt payloads', async () => {
    for (const meta of [{ status: 'withdrawn' }, { status: 'icd-closed' },
        { status: 'evidence-opened', patientId: 'patient-b' },
        { status: 'evidence-closed', receipt: { outcome: 'read' } },
        { status: 'evidence-opened', payload: 'Referto sintetico' },
        { status: 'evidence-opened', groups: [] }]) {
        const view = await frame({ meta }, 'evidence-queue');
        assert.equal(view.polling(), false);
        assert.equal(view.elements.get('card').hidden, true);
        assert.match(view.elements.get('status').textContent, /Apertura non confermata/u);
    }
});

test('Web document evidence discard a late successful status after revocation', async () => {
    const host = { meta: { status: 'evidence-opened' } };
    const view = await frame(host, 'evidence-queue');
    assert.equal(view.elements.get('revoke').disabled, false);
    view.elements.get('revoke').onclick();
    await view.settle();
    host.meta = { status: 'evidence-closed' };
    await view.tick();
    assert.match(view.elements.get('status').textContent, /Richiesta ritirata/u);
    assert.equal(view.polling(), false);
    assert.equal(view.elements.get('card').hidden, true);
});
