/* @Codex — synthetic component projection, not a live/browser or admission claim. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

type Node = { type: string | ((props: Record<string, unknown>) => unknown); props: Record<string, unknown> };
const jsx = (type: Node['type'], props: Node['props']) => ({ type, props });
function loadComponent(file: string, exportName: string, state: unknown[] = []) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    const { outputText } = ts.transpileModule(source + `\nexport { ${exportName} as TestComponent };`, {
        fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
    let index = 0; const never = () => { throw new Error('outside synthetic component projection'); };
    const exports: { TestComponent?: (props: Record<string, unknown>) => Node } = {};
    const scopedRequire = (id: string): unknown => {
        if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
        if (id === 'react') return { useState: (initial: unknown) => [index < state.length ? state[index++] : initial, never] };
        if (id === '@/lib/ai-lane-kill-switch') return { isAiLaneEnabledValue: (v: unknown) => v === 'enabled' };
        if (id === '@/lib/function-models/browser') return { names: { patient_insight: 'Quadro paziente', smart_import: 'Importazione assistita', document_synthesis: 'Sintesi dei documenti', treatment_reasoning: 'Ragionamento terapeutico' }, providerName: () => 'Locale' };
        if (id.endsWith('.module.css')) return { default: {} };
        if (id === '@/components/settings/settings-ui') return { SETTINGS_SECONDARY_BUTTON_CLASS: '', SETTINGS_PRIMARY_BUTTON_CLASS: '' };
        if (['@/components/security-provider', '@/lib/function-models/preview-client', '@/lib/live-query', '@/lib/chatgpt-account/account-browser', '../treatment-reasoning-portable-setup'].includes(id)) return new Proxy({}, { get: () => never });
        throw new Error(`Unexpected UI import: ${id}`);
    };
    // Only the exact local component bytes above are evaluated; no user text.
    new Function('require', 'exports', outputText)(scopedRequire, exports);
    return (props: Record<string, unknown>) => {
        assert.equal(typeof exports.TestComponent, 'function');
        return exports.TestComponent!(props);
    };
}
function nodes(value: unknown): Node[] {
    if (Array.isArray(value)) return value.flatMap(nodes);
    if (!value || typeof value !== 'object') return [];
    const node = value as Node;
    if (typeof node.type === 'function') return nodes(node.type(node.props));
    return [node, ...nodes(node.props.children)];
}
function text(value: unknown): string {
    if (Array.isArray(value)) return value.map(text).join('');
    if (value === null || value === undefined || typeof value === 'boolean') return '';
    if (typeof value !== 'object') return String(value);
    const node = value as Node;
    return text(typeof node.type === 'function' ? node.type(node.props) : node.props.children);
}

test('digest disclosure is identity + bytes + proposal-only, never raw prepared text', () => {
    const component = loadComponent('./function-model-picker.tsx', 'OrdinaryFunctionControls');
    let rawReads = 0;
    const disclosure = { payloadSha256: 'c'.repeat(64), payloadBytes: 100,
        get rawText() { rawReads++; throw new Error('PRIVATE_PROVIDER_SENTINEL'); },
        get redactedText() { rawReads++; throw new Error('PRIVATE_PROVIDER_SENTINEL'); } };
    const view = { loading: false, error: null, state: { phase: 'needs_consent' }, disclosure };
    const tree = component({ client: { remote: {} }, view });
    const content = text(tree);
    assert.match(content, /Identità del contesto preparato/u);
    assert.doesNotMatch(content, /Verifica contenuto preparato|PRIVATE_PROVIDER_SENTINEL/u);
    assert.match(content, /100 byte/u); assert.match(content, /Questa proposta non modifica la cartella/u);
    assert.ok(content.includes('c'.repeat(64))); assert.equal(rawReads, 0);
    assert.equal(nodes(tree).find(n => n.type === 'summary')!.props.children, 'Identità del contesto preparato');
});

test('explicit OpenAI configuration previews only the shared switch with unavailable ATHENA', () => {
    const component = loadComponent('./function-preferences-panel.tsx', 'PreferenceCard', ['chatgpt_subscription', true, null]);
    let command: unknown;
    const tree = component({ row: { id: 'treatment_reasoning', enabled: false, defaultSource: 'host_configuration', defaultModelOptionId: null,
        bindingState: 'unsupported', options: [] }, activationSupported: true, disabled: false, account: null, preview: (value: unknown) => { command = value; } });
    assert.match(text(tree), /OpenAI · abbonamento ChatGPT/u);
    assert.match(text(tree), /interruttore condiviso/u); assert.doesNotMatch(text(tree), /Modello locale predefinito/u);
    const button = nodes(tree).find(n => n.type === 'button' && n.props.children === 'Anteprima modifica')!;
    assert.equal(button.props.disabled, false);
    (button.props.onClick as () => void)();
    assert.deepEqual(command, { action: 'set_activation', functionId: 'treatment_reasoning', enabled: true });
});

test('a changed local default is saved even while its function is off', () => {
    const modelOptionId = `model_option_${'a'.repeat(32)}`;
    const component = loadComponent('./function-preferences-panel.tsx', 'PreferenceCard', ['local', false, modelOptionId]);
    let command: unknown;
    const tree = component({ row: { id: 'patient_insight', enabled: false, defaultSource: 'host_configuration', defaultModelOptionId: modelOptionId,
        bindingState: 'current', options: [{ modelOptionId, label: 'Modello sintetico', provider: 'ollama', state: 'unavailable' }] },
    activationSupported: true, disabled: false, account: null, preview: (value: unknown) => { command = value; } });
    const button = nodes(tree).find(n => n.type === 'button' && n.props.children === 'Anteprima modifica')!;
    (button.props.onClick as () => void)();
    assert.deepEqual(command, { action: 'set', functionId: 'patient_insight', enabled: false, defaultModelOptionId: modelOptionId });
});

test('switching off without changing the model preserves the local binding', () => {
    const modelOptionId = `model_option_${'b'.repeat(32)}`;
    const component = loadComponent('./function-preferences-panel.tsx', 'PreferenceCard', ['local', false, modelOptionId]);
    let command: unknown;
    const tree = component({ row: { id: 'patient_insight', enabled: true, defaultSource: 'saved_preference', defaultModelOptionId: modelOptionId,
        bindingState: 'stale', options: [] }, activationSupported: true, disabled: false, account: null, preview: (value: unknown) => { command = value; } });
    const button = nodes(tree).find(n => n.type === 'button' && n.props.children === 'Anteprima modifica')!;
    (button.props.onClick as () => void)();
    assert.deepEqual(command, { action: 'set_activation', functionId: 'patient_insight', enabled: false });
});
