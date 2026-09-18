/* @Codex WUL-684: JSX structure and callback contracts on synthetic snapshots.
   These tests do not attest browser rendering, React effects, keyboard or zoom. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { presentAccount, accountNotices } from '../../lib/chatgpt-account/account-presentation.ts';
import type { AccountBrowserView } from '../../lib/chatgpt-account/account-browser.ts';
import { collectAiRolloutLocalControlGuards, collectAiRolloutModelGuards, type AiRolloutGuardPayload } from '../../lib/ai-rollout-model-guard.ts';
import type { FunctionState } from '../../lib/function-status.ts';
// The synchronous loader resolves extensionless imports in this unchanged CJS dependency.
const packageRequire = createRequire(import.meta.url);
const { FUNCTION_IDS, FUNCTION_META, FUNCTION_STATE_LABELS, parseFunctionStatus } = packageRequire('../../lib/function-status.ts') as typeof import('../../lib/function-status.ts');
import { mountContract, find, flatten, text, type TestNode } from './settings-presentation.test-support.ts';

const path = (name: string) => `components/settings/${name}.tsx`;
const click = (node: TestNode) => (node.props.onClick as () => unknown)();
const buttons = (tree: unknown) => flatten(tree).filter(node => node.type === 'button');
const testId = (tree: unknown, id: string) => find(tree, node => node.props['data-testid'] === id);
const sourceView = (patch: Partial<AccountBrowserView> = {}): AccountBrowserView => ({
    kind: 'ready', busy: null, authUrl: null, models: null, limits: null, error: null, modelsObservedAt: null, limitsObservedAt: null,
    status: { state: 'connected', plan: 'pro', notice: null, loginExpiresAt: null,
        actions: ['read_models', 'read_rate_limits', 'refresh_account', 'logout'], inferenceEnabled: false, executionBlock: 'data_boundary_unqualified' }, ...patch,
});
function account(view = sourceView(), active = true) {
    const calls: string[] = [];
    const client = { snapshot: () => view, run: (operation: string) => { calls.push(operation); }, subscribe: () => () => {}, setActive: () => {} };
    const harness = mountContract(path('chatgpt-account-card'), 'ChatGptAccountCard', {
        states: { 0: client, 1: view }, props: { active },
        imports: { '@/lib/chatgpt-account/account-presentation': { presentAccount, accountNotices }, '@/lib/chatgpt-account/account-browser': { createAccountBrowser: () => client } },
    });
    return { ...harness, calls };
}

test('account card distinguishes informative account, demo, opt-in ordinary functions and real-data permission', () => {
    const harness = account(); const tree = harness.render(); const visible = text(tree, false);
    const boundary = find(tree, node => node.props['aria-label'] === 'Account, prova e uso nelle funzioni');
    assert.match(text(boundary), /non invia dati del paziente/i);
    assert.match(text(boundary), /demo[\s\S]*non autorizza l’uso clinico/i);
    assert.match(text(boundary), /scelta esplicita[\s\S]*consenso[\s\S]*contenuto esatto[\s\S]*OpenAI[\s\S]*revisione/i);
    assert.match(text(boundary), /non verifica[\s\S]*sessione/i);
    assert.match(text(boundary), /dati sanitari reali[\s\S]*non autorizza/i);
    for (const id of ['patient_insight', 'smart_import', 'document_synthesis', 'treatment_reasoning'] as const) {
        assert.ok(text(boundary).includes(FUNCTION_META[id].title));
    }
    assert.doesNotMatch(visible, /ADR\s?0134|data_boundary_unqualified|Uso nelle funzioni sospeso/);
    assert.match(text(tree), /inferenceEnabled: false/);
    const demo = find(tree, node => node.type === 'a' && node.props.href === '/settings/ai/chatgpt');
    assert.equal(demo.props.prefetch, false); assert.match(text(demo), /solo dati demo/);
    assert.equal(flatten(tree).filter(node => node.type === 'select').length, 0);
    assert.deepEqual(harness.calls, []);
});

test('connected account preserves every command, disabled flags, notices and sparse quota meaning', () => {
    const harness = account(sourceView({ limits: { primary: null, secondary: null }, limitsObservedAt: 1000 }));
    let tree = harness.render();
    assert.match(text(tree), /dato non disponibile/i);
    assert.match(text(tree), /dato assente non significa utilizzo zero/i);
    for (const button of buttons(tree)) { assert.equal(button.props.disabled, false); click(button); }
    assert.deepEqual(harness.calls, ['logout', 'status', 'models', 'rate-limits', 'read']);
    harness.values.set(1, sourceView({ busy: 'models' })); tree = harness.render();
    const controls = buttons(tree);
    assert.equal(controls[0].props.disabled, false, 'logout remains available during a read');
    assert.ok(controls.slice(1).every(node => node.props.disabled === true));
    harness.values.set(1, sourceView({ error: 'Errore sintetico da rileggere' })); tree = harness.render();
    assert.match(text(find(tree, node => node.props.role === 'alert')), /Errore sintetico/);
    assert.equal(buttons(tree).length, 2, 'error leaves logout and explicit status reread, not model reads');
});

test('locked account has no account actions or retained model list; the demo stays a separate link', () => {
    const tree = account(sourceView({ models: [{ id: 'synthetic', model: 'synthetic-secret-label', isDefault: true }] }), false).render();
    assert.equal(buttons(tree).length, 0); assert.doesNotMatch(text(tree), /synthetic-secret-label/);
    assert.match(text(tree, false), /sblocca/i); assert.match(text(tree, false), /solo dati demo/i);
});

test('login buttons keep their original command identity and secure official link attributes', () => {
    const view = sourceView({ status: { ...sourceView().status!, state: 'awaiting_login', actions: ['complete_login', 'cancel_login'], plan: null },
        authUrl: 'https://auth.openai.com/oauth/authorize?state=synthetic-only' });
    const harness = account(view), tree = harness.render();
    const official = find(tree, node => node.type === 'a' && node.props.href === view.authUrl);
    assert.equal(official.props.target, '_blank'); assert.equal(official.props.rel, 'noopener noreferrer');
    assert.equal(official.props.referrerPolicy, 'no-referrer');
    buttons(tree).forEach(click); assert.deepEqual(harness.calls, ['login/complete', 'login/cancel', 'status']);
});

const lanes = ['patient_insight', 'smart_import', 'redaction', 'clinical_entities', 'generative_challenger'] as const;
function payload() {
    return { lanes: lanes.map((lane, index) => ({ lane, available: index !== 2, updatedAt: '2026-09-18T10:00:00Z',
        jsonPath: `/synthetic/${lane}.json`, markdownPath: `/synthetic/${lane}.md`, markdown: `# Synthetic ${lane}`,
        report: index === 2 ? null : { status: index === 0 ? 'shadow-ready' : index === 1 ? 'rollback-required' : 'hold', currentState: 'synthetic-machine-state',
            selectedModel: 'synthetic-model', blockers: index === 1 ? [{ id: 'synthetic-block', message: 'Blocco sintetico da non nascondere' }] : [],
            warnings: [{ id: 'synthetic-warning', message: 'Avvertenza sintetica da non nascondere' }], evidence: { benchmarkFresh: index === 0, owner: 'synthetic-operator' } },
    })), localControls: ['patient_insight', 'smart_import', 'document_synthesis', 'treatment_reasoning'].map((lane, index) => ({
        lane, label: `technical-${lane}`, key: `synthetic-key-${lane}`, uiDriven: true, state: index % 2 === 0 ? 'disabled' : 'enabled',
    })) };
}
function readiness(status = 'ready', data: unknown = payload(), globals: Record<string, unknown> = {}) {
    return mountContract(path('ai-rollout-readiness-panel'), 'default', { states: { 0: { status, payload: data, message: 'HTTP 503 synthetic' } }, globals });
}

test('readiness preserves counts and codes while observation and non-disabled state never imply clinical readiness', () => {
    const tree = readiness().render(), visible = text(tree, false);
    for (const [id, count] of [['ready', '1'], ['hold', '2'], ['rollback', '1'], ['missing', '1']]) {
        assert.match(text(testId(tree, `ai-rollout-metric-${id}`)), new RegExp(`\\b${count}\\b`));
    }
    assert.match(text(testId(tree, 'ai-rollout-local-control-summary')), /2[\s\S]*4/);
    assert.match(visible, /osservazione[\s\S]*non autorizza l’uso clinico/i);
    assert.match(visible, /non garantisce disponibilità/i);
    assert.match(text(testId(tree, 'ai-rollout-lane-smart_import'), false), /blocco richiesto/i);
    assert.match(visible, /Blocco sintetico da non nascondere/); assert.match(visible, /Avvertenza sintetica da non nascondere/);
    assert.doesNotMatch(visible, /synthetic-machine-state|synthetic-operator|npm run|shadow-ready|technical-patient_insight/);
    assert.match(text(tree), /synthetic-machine-state/); assert.match(text(tree), /--owner operatore-demo/);
    assert.equal(buttons(tree).length, 1, 'readiness is read-only with one reread action');
    assert.equal(flatten(tree).filter(node => node.props.role === 'switch').length, 0);
    for (const node of flatten(tree).filter(node => node.type === 'summary')) {
        assert.match(String(node.props.className), /focus-visible/); assert.match(String(node.props.className), /min-h-11/);
    }
});

test('missing, loading and failed reports cannot be displayed as ready; raw error remains in diagnostics', () => {
    const missingPayload = { lanes: payload().lanes.map(lane => ({ ...lane, available: false, report: null })), localControls: [] };
    const missing = readiness('ready', missingPayload).render();
    assert.match(text(missing, false), /nessuna verifica[\s\S]*non[\s\S]*pronte/i);
    for (const lane of lanes) assert.match(text(testId(missing, `ai-rollout-missing-${lane}`), false), /non considerarla pronta/i);
    assert.match(text(readiness('loading', null).render()), /lettura/i);
    const failed = readiness('error', null).render(); assert.match(text(failed, false), /rileggi verifiche[\s\S]*errore/i);
    assert.doesNotMatch(text(failed, false), /HTTP 503/); assert.match(text(failed), /HTTP 503/);
    assert.ok(find(failed, node => node.props.role === 'alert'));
});

test('readiness reread callback keeps the same GET endpoint/cache and error transition', async () => {
    const requests: Array<[unknown, unknown]> = [];
    const harness = readiness('ready', payload(), { fetch: async (...args: unknown[]) => { requests.push(args as [unknown, unknown]); return new Response('{}', { status: 503 }); } });
    click(buttons(harness.render())[0]); await nextTurn();
    assert.equal(requests.length, 1); assert.equal(requests[0][0], '/api/system/ai-rollout-readiness');
    assert.deepEqual(JSON.parse(JSON.stringify(requests[0][1])), { cache: 'no-store' });
    assert.match(text(harness.render(), false), /non disponibili/i);
});

function guard(data: AiRolloutGuardPayload | null, model = 'synthetic-model') {
    return mountContract(path('ai-rollout-guard-notice'), 'default', { states: { 0: data },
        props: { selections: [{ roleId: 'clinical', roleLabel: 'clinical-internal-role', model }] },
        imports: { '@/lib/ai-rollout-model-guard': { collectAiRolloutLocalControlGuards, collectAiRolloutModelGuards } },
    });
}

test('guard severity/matching still come from the real collector; all blocker messages remain visible', () => {
    const data: AiRolloutGuardPayload = { lanes: [
        { lane: 'patient_insight', available: true, report: { status: 'hold', selectedModel: 'synthetic-model', blockers: [{ message: 'synthetic-first' }] } },
        { lane: 'smart_import', available: true, report: { status: 'rollback-required', selectedModel: 'synthetic-model', blockers: [{ message: 'synthetic-second' }, { message: 'synthetic-third' }] } },
    ] };
    const snapshot = structuredClone(data); const tree = guard(data).render(), visible = text(tree, false);
    assert.match(visible, /blocco richiesto/i); assert.match(visible, /Quadro paziente/); assert.match(visible, /Importazione assistita/);
    for (const marker of ['synthetic-first', 'synthetic-second', 'synthetic-third']) assert.ok(visible.includes(marker));
    assert.doesNotMatch(visible, /Patient Insight|Smart Import|clinical-internal-role|rollback-required/);
    assert.match(text(tree), /clinical-internal-role/); assert.match(text(tree), /rollback-required/);
    assert.deepEqual(data, snapshot); assert.equal(buttons(tree).length, 0);
    assert.equal(guard(data, 'unrelated-model').render(), null);
    assert.equal(guard(null).render(), null);
});

test('local-only guard does not invent failed validation or claim that a disabled function is available', () => {
    const tree = guard({ lanes: [], localControls: [{ lane: 'document_synthesis', label: 'Document Synthesis', state: 'disabled' }] }).render();
    const visible = text(tree, false);
    assert.match(visible, /Sintesi dei documenti/); assert.match(visible, /spenta/i);
    assert.match(visible, /non la riattiva[\s\S]*non ne dimostra la disponibilità/i);
    assert.doesNotMatch(visible, /funzione disponibile|non hanno[\s\S]*superato la validazione|Document Synthesis/i);
});

function functionSnapshot(state: FunctionState) {
    return { schemaVersion: 'mediflow.function-status.v1', check: 'configuration_only', checkedAt: '2026-09-18T10:00:00.000Z',
        functions: FUNCTION_IDS.map(id => ({ id, state, reason: `synthetic-reason-${id}`, provider: 'synthetic-provider', model: 'synthetic-model', lastExecutionAt: null })) };
}
function functionPanel(state: unknown) {
    return mountContract(path('function-status-panel'), 'FunctionStatusPanel', { states: { 0: 0, 1: state },
        imports: { '@/lib/function-status': { FUNCTION_META, FUNCTION_STATE_LABELS, parseFunctionStatus } } });
}
for (const state of Object.keys(FUNCTION_STATE_LABELS) as FunctionState[]) {
    test(`function status ${state}: preserves status/reason/action and does not infer execution or account readiness`, () => {
        const snapshot = functionSnapshot(state), tree = functionPanel({ kind: 'ready', snapshot }).render();
        assert.equal(flatten(tree).filter(node => node.type === 'li').length, 6);
        assert.equal(flatten(tree).filter(node => node.props['data-testid'] === 'function-state-icd11').length, 0);
        for (const id of FUNCTION_IDS.filter(id => id !== 'icd11')) {
            const card = testId(tree, `function-state-${id}`);
            assert.equal(find(card, node => node.props['data-state'] === state).props['data-state'], state);
            assert.ok(text(card).includes(FUNCTION_STATE_LABELS[state])); assert.ok(text(card).includes(`synthetic-reason-${id}`));
            const link = find(card, node => node.type === 'a');
            assert.equal(link.props.href, state === 'off' ? '/settings/ai/funzioni' : FUNCTION_META[id].href);
            assert.match(text(card), /non prova il funzionamento/);
        }
    });
}

test('function-status refresh remains disabled while loading and increments only the existing revision', () => {
    const harness = functionPanel({ kind: 'loading' });
    assert.equal(buttons(harness.render())[0].props.disabled, true);
    harness.values.set(1, { kind: 'error' }); const tree = harness.render();
    assert.equal(buttons(tree)[0].props.disabled, false); click(buttons(tree)[0]); assert.equal(harness.values.get(0), 1);
    assert.match(text(tree), /errore di lettura non significa[\s\S]*spente/i);
    assert.match(text(functionPanel({ kind: 'unauthorized' }).render()), /sblocca/i);
});
