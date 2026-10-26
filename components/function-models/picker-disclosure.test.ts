import assert from 'node:assert/strict';
import test from 'node:test';
import { mountContract, flatten, text } from '../settings/settings-presentation.test-support.ts';
import { providerName } from '../../lib/function-models/browser.ts';

const local = { modelOptionId: `model_option_${'a'.repeat(32)}`, label: 'Modello locale sintetico', provider: 'ollama', state: 'available_unqualified' };
function render(remote?: object, choice: object | null = null) {
    const view = { dto: { functions: [{ id: 'document_synthesis', enabled: true, defaultModelOptionId: local.modelOptionId, bindingState: 'current', options: [local] }] },
        choice, loading: false, blocked: true, consumed: false, error: null, ...(remote ? { remote } : {}) };
    return mountContract('components/function-models/function-model-picker.tsx', 'FunctionModelPicker', { states: { 0: true },
        props: { picker: { client: { remote: {} }, view, active: true, functionId: 'document_synthesis', needsReprepare: false } },
        imports: { '@/components/choice-field': { ChoiceField: (props: Record<string, unknown>) => ({ type: 'select', props }) },
            '@/lib/ai-lane-kill-switch': { isAiLaneEnabledValue: (v: unknown) => v === 'enabled' },
            '@/lib/function-models/browser': { providerName }, '@/components/security-provider': {}, '@/lib/function-models/preview-client': {},
            '@/components/settings/settings-ui': { SETTINGS_SECONDARY_BUTTON_CLASS: '' }, '../treatment-reasoning-portable-setup': {} },
    }).render();
}
function content(tree: unknown, className: string) { return text(flatten(tree).find(n => n.props.className === className)); }
const remote = (extra = {}) => ({ settings: { enabled: true }, loading: false, state: null, completed: false, error: null, ...extra });

for (const [name, state] of [
    ['before access', remote()],
    ['with current catalog choice', remote({ catalog: { choices: [{ optionId: 'option.synthetic', model: 'Modello OpenAI sintetico', effort: 'medium' }] }, choice: 'option.synthetic' })],
    ['after a denied preparation', remote({ error: 'Preparazione negata.' })],
] as const) test(`ChatGPT disclosure uses only the selected remote path ${name}`, () => {
    const tree = render(state);
    assert.match(content(tree, 'fixture-pickerProvider'), /OpenAI.*ChatGPT/u);
    assert.doesNotMatch(content(tree, 'fixture-pickerProvider'), /Ollama|Predefinito/u);
    assert.doesNotMatch(content(tree, 'fixture-pickerDetailBody'), /Modello locale sintetico|Usa il modello predefinito/u);
    assert.equal(flatten(tree).filter(n => n.type === 'button' && /Rileggi modelli|Riusa predefinito/u.test(text(n.props.children))).length, 0);
});

test('local default and explicit local choice keep their own provider and persistence disclosure', () => {
    assert.match(content(render(), 'fixture-pickerProvider'), /Ollama.*locale.*Predefinito/u);
    assert.match(content(render(), 'fixture-pickerDetailBody'), /Modello locale sintetico.*Usa il modello predefinito/u);
    const explicit = render(undefined, { modelOptionId: local.modelOptionId });
    assert.match(content(explicit, 'fixture-pickerProvider'), /Ollama.*Solo questa proposta/u);
    assert.match(content(explicit, 'fixture-pickerDetailBody'), /Scelta per una sola proposta; non salvata/u);
});
