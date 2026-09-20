/* @Codex WUL-684: source and callback contracts; browser/focus acceptance is separate. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { mountContract, find, flatten, text, type TestNode } from './settings/settings-presentation.test-support.ts';

const componentUrl = new URL('./intelligent-host-checkup-action.tsx', import.meta.url);
const adapterUrl = new URL('../lib/security/intelligent-host-checkup-browser-adapter.ts', import.meta.url);
const pageUrl = new URL('../app/patients/[id]/modules/page.tsx', import.meta.url);
test('governed checkup wiring retains adapters, selection invalidation, PIN and no exposed UI binding', () => {
    const component = readFileSync(componentUrl, 'utf8'), adapter = readFileSync(adapterUrl, 'utf8');
    assert.match(component, /data-testid="intelligent-host-checkup-action"/u);
    assert.match(component, /data-lume-action="quiet"/u);
    assert.match(component, /min-h-11 min-w-11 sm:min-w-0/u);
    assert.match(component, /type="password"/u);
    assert.match(component, /client\.select\(patientId, ambulatoryId, selectedId\)/u);
    assert.match(component, /await client\.revokeOperation\(patientId\)[\s\S]{0,220}setSelectedId\(nextId\)/u);
    assert.match(component, /setCheckupRef\(''\); setProposalRef\(''\); setProposal\(null\)/u);
    assert.match(component, /selectedResource\.title[\s\S]{0,120}selectedResource\.revision/u);
    assert.match(component, /proposal\.resourceTitle/u); assert.match(component, /notifyDbChange\('checkups'\)/u);
    assert.doesNotMatch(component, /uiBindingRef|setInterval|setTimeout|console\./u);
    assert.match(adapter, /selection\.initialize\(\)[\s\S]{0,160}selection\.select/u);
    assert.match(adapter, /intelligent-host\/activate/u);
    assert.match(adapter, /await activateCurrentHost\(patientId, ambulatoryId\)[\s\S]{0,200}checkup-status/u);
    assert.match(adapter, /proposalBindings = new WeakMap/u);
});

test('real patient page retains the governed checkup entrypoint', {
    skip: !existsSync(pageUrl) ? 'NOT_RUN: caller page is outside the supplied source slice; re-run in the complete checkout.' : false,
}, () => {
    const page = readFileSync(pageUrl, 'utf8');
    assert.match(page, /<IntelligentHostCheckupAction patientId=\{patient\.id\}[\s\S]{0,120}ambulatoryId=\{patient\.ambulatoryId \?\? null\}/u);
    assert.doesNotMatch(page, /<IntelligentHostPatientAction/u);
});

const click = (node: TestNode) => (node.props.onClick as () => unknown)();
const button = (tree: unknown, pattern: RegExp) => find(tree, node => node.type === 'button' && pattern.test(text(node)));
const proposal = { proposalRef: 'hcsp_' + 'b'.repeat(64), targetStatus: 'completed', expectedRevision: 1,
    expiresAt: 1790000000000, resourceTitle: 'Checkup sintetico', resourceRevision: 1 };
class AdapterError extends Error { constructor(readonly code: string) { super(code); } }
function fixture(states: Record<number, unknown> = {}, props: Record<string, unknown> = {}, fail?: string) {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const record = (method: string, result: unknown) => async (...args: unknown[]) => {
        calls.push({ method, args }); if (fail) throw new AdapterError(fail); return result;
    };
    const client = {
        reset: () => calls.push({ method: 'reset', args: [] }), enroll: record('enroll', undefined), revokeRole: record('revokeRole', undefined),
        select: record('select', { checkupRef: 'hcsr_' + 'a'.repeat(64), resourceTitle: 'Checkup sintetico', resourceRevision: 1 }),
        revokeOperation: record('revokeOperation', 'revoked'), read: record('read', proposal),
        confirm: record('confirm', { toStatus: 'completed', newRevision: 2 }),
    };
    const harness = mountContract('components/intelligent-host-checkup-action.tsx', 'IntelligentHostCheckupAction', {
        states: { 0: client, 1: true, ...states },
        props: { patientId: 'synthetic-patient', ambulatoryId: 'synthetic-ambulatory', checkups: [
            { id: 'synthetic-checkup', title: 'Checkup sintetico', status: 'pending', version: 1 },
            { id: 'synthetic-done', title: 'Checkup sintetico concluso', status: 'completed', version: 2 },
        ], ...props },
        imports: {
            '@/lib/security/intelligent-host-checkup-browser-adapter': { createIntelligentHostCheckupBrowserAdapter: () => client, IntelligentHostCheckupBrowserAdapterError: AdapterError },
            '@/lib/live-query': { notifyDbChange: (table: string) => calls.push({ method: 'notifyDbChange', args: [table] }) },
        },
        globals: { navigator: { clipboard: { writeText: record('copy', undefined) } } },
    });
    return { ...harness, calls };
}

test('trigger, tooltip and main copy describe a checkup state change, not a machine diagnostic', () => {
    const harness = fixture(), tree = harness.render();
    const trigger = find(tree, node => node.type === 'button' && node.props['aria-controls'] !== undefined);
    assert.match(String(trigger.props['aria-label']), /gestisci[\s\S]*checkup/i);
    assert.equal(trigger.props['aria-label'], text(trigger).trim());
    assert.match(String(trigger.props.title), /completamento[\s\S]*annullamento[\s\S]*PIN/);
    assert.match(text(tree, false), /conferma con il PIN modifica lo stato del checkup/);
    assert.doesNotMatch(text(tree, false), /\bMCP\b|\bHost\b|\bpending\b|\breceipt\b|PIN fresco/i);
    assert.match(text(tree), /MCP/); assert.deepEqual(harness.calls, []);
    const pin = find(tree, node => node.type === 'input' && node.props.type === 'password');
    assert.ok(find(tree, node => node.type === 'label' && node.props.htmlFor === pin.props.id));
    assert.equal(pin.props.autoComplete, 'current-password');
    assert.equal(flatten(tree).filter(node => node.type === 'option').length, 1, 'only pending checkups are offered');
});

test('PIN and busy states keep enrollment, definitive revocation and confirmation disabled', () => {
    for (const [pin, busy] of [['', false], ['123', false], ['1234', true]] as const) {
        const tree = fixture({ 4: pin, 2: busy, 7: proposal }).render();
        for (const pattern of [/abilita gestione/i, /revoca definitivamente/i, /conferma modifica/i]) assert.equal(button(tree, pattern).props.disabled, true);
    }
    const tree = fixture({ 4: '1234', 7: proposal }).render();
    for (const pattern of [/abilita gestione/i, /revoca definitivamente/i, /conferma modifica/i]) assert.equal(button(tree, pattern).props.disabled, false);
    assert.equal(button(fixture({}, { ambulatoryId: null }).render(), /attiva e collega/i).props.disabled, true);
});

test('enroll and definitive revocation retain exact callbacks and clear the typed PIN', async () => {
    const harness = fixture({ 4: '1234' });
    await click(button(harness.render(), /abilita gestione/i));
    assert.deepEqual(harness.calls, [{ method: 'enroll', args: ['1234'] }]); assert.equal(harness.values.get(4), '');
    harness.values.set(4, '5678'); await click(button(harness.render(), /revoca definitivamente/i));
    assert.deepEqual(harness.calls.slice(1), [{ method: 'revokeRole', args: ['5678'] }, { method: 'reset', args: [] }]);
    assert.equal(harness.values.get(5), ''); assert.equal(harness.values.get(7), null);
    assert.match(text(harness.render()), /revocata definitivamente/);
});

test('select/close retain identity and distinguish closing one operation from revoking the role', async () => {
    const harness = fixture(); await click(button(harness.render(), /attiva e collega/i));
    assert.deepEqual(harness.calls[0], { method: 'select', args: ['synthetic-patient', 'synthetic-ambulatory', 'synthetic-checkup'] });
    assert.equal(button(harness.render(), /attiva e collega/i).props.disabled, true);
    await click(button(harness.render(), /chiudi operazione/i));
    assert.equal(harness.calls[1].method, 'revokeOperation'); assert.equal(harness.values.get(5), '');
    assert.match(text(harness.render()), /servizio[\s\S]*resta attivo/i);
    assert.ok(!harness.calls.some(call => call.method === 'revokeRole'));
});

test('changing the selected checkup invalidates the old proposal and operation', async () => {
    const harness = fixture({ 5: 'synthetic-ref', 6: 'synthetic-proposal', 7: proposal });
    const select = find(harness.render(), node => node.type === 'select');
    (select.props.onChange as (event: unknown) => void)({ target: { value: 'synthetic-next' } }); await nextTurn();
    assert.equal(harness.calls[0].method, 'revokeOperation'); assert.equal(harness.values.get(3), 'synthetic-next');
    assert.equal(harness.values.get(5), ''); assert.equal(harness.values.get(6), ''); assert.equal(harness.values.get(7), null);
});

test('read/confirm/replay preserve proposed target, PIN, callback arguments and database change notice', async () => {
    const harness = fixture({ 6: '  ' + proposal.proposalRef + '  ' });
    await click(button(harness.render(), /rileggi proposta/i));
    assert.deepEqual(harness.calls[0], { method: 'read', args: ['synthetic-patient', proposal.proposalRef] });
    harness.values.set(4, '1234'); await click(button(harness.render(), /conferma modifica/i));
    assert.deepEqual(harness.calls[1], { method: 'confirm', args: ['synthetic-patient', proposal, '1234'] });
    assert.deepEqual(harness.calls[2], { method: 'notifyDbChange', args: ['checkups'] });
    assert.equal(harness.values.get(4), ''); assert.equal(harness.values.get(9), true);
    assert.match(text(harness.render()), /eseguito alla versione 2/i);
    harness.values.set(4, '5678'); await click(button(harness.render(), /rileggi conferma/i));
    assert.equal(harness.calls[3].method, 'confirm', 'same adapter method; replay prevention remains adapter-owned');
    assert.match(text(harness.render()), /nessuna seconda scrittura/i);
});

for (const code of ['session_unavailable', 'role_unavailable', 'conflict', 'expired', 'host_unavailable']) {
    test(`checkup ${code}: preserves the error branch and presents a recovery action`, async () => {
        const harness = fixture({ 4: '1234' }, {}, code); await click(button(harness.render(), /abilita gestione/i));
        const status = find(harness.render(), node => node.props.role === 'status');
        assert.equal(status.props['aria-live'], 'polite'); assert.equal(status.props['aria-atomic'], 'true');
        assert.match(text(status), /sblocca|verifica|richiedi/i); assert.doesNotMatch(text(status), /abilitata per questa sessione/i);
        assert.equal(harness.values.get(2), false); assert.equal(harness.values.get(4), '');
    });
}
