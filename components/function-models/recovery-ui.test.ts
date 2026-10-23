import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mountContract, text, type TestNode } from '../settings/settings-presentation.test-support.ts';

function visibleNodes(tree: unknown): TestNode[] {
    if (Array.isArray(tree)) return tree.flatMap(visibleNodes);
    if (!tree || typeof tree !== 'object' || !('type' in tree)) return [];
    const node = tree as TestNode;
    if (node.props.hidden) return [];
    return [node, ...visibleNodes(node.props.children)];
}

const modelOptionId = `model_option_${'a'.repeat(32)}`;
const dto = { functions: [{ id: 'patient_insight', enabled: true, bindingState: 'current',
    defaultModelOptionId: modelOptionId, options: [{ modelOptionId, label: 'Modello sintetico',
        provider: 'ollama', state: 'available_unqualified' }] }] };

for (const scenario of [
    { name: 'bloccato', dto, blocked: true, consumed: false, error: 'Scelta non attuale: conferma il modello.', action: 'Riusa predefinito' },
    { name: 'bloccato senza catalogo', dto: null, blocked: true, consumed: false, error: null, action: 'Rileggi modelli' },
    { name: 'consumato', dto, blocked: false, consumed: true, error: null, action: 'Riusa predefinito' },
    { name: 'errore', dto: null, blocked: true, consumed: false, error: 'Impossibile leggere i modelli.', action: 'Rileggi modelli' },
]) {
    for (const editing of [false, true]) test(`recupero ${scenario.name}: azione e spiegazione visibili con editor ${editing ? 'aperto' : 'chiuso'}`, () => {
        const calls: string[] = [];
        const component = mountContract('components/function-models/function-model-picker.tsx', 'FunctionModelPicker', {
            states: { 0: editing },
            props: { picker: { functionId: 'patient_insight', active: true,
                client: { read: () => calls.push('read'), choose: (value: string) => calls.push(`choose:${value}`) },
                view: { ...scenario, choice: null, loading: false } } },
            imports: {
                '@/components/choice-field': { ChoiceField: (props: Record<string, unknown>) => ({ type: 'select', props }) },
                '@/lib/ai-lane-kill-switch': {},
                '@/components/security-provider': {},
                '@/lib/function-models/preview-client': {},
                '@/lib/function-models/browser': { providerName: () => 'Locale' },
                '@/components/settings/settings-ui': { SETTINGS_SECONDARY_BUTTON_CLASS: '' },
                '../treatment-reasoning-portable-setup': {},
            },
        });
        const tree = component.render();
        const visible = visibleNodes(tree);
        const actions = visible.filter(node => node.type === 'button' && text(node.props.children).trim() === scenario.action);
        assert.equal(actions.length, 1, 'un solo comando di recupero visibile');
        const action = actions[0];
        assert.equal(action.props.disabled, false);
        const descriptionId = action.props['aria-describedby'];
        assert.equal(typeof descriptionId, 'string', 'il comando indica la spiegazione');
        const description = visible.find(node => node.props.id === descriptionId);
        assert.ok(description, 'la spiegazione è visibile');
        assert.ok(text(description).trim().length > 0);
        assert.ok(visible.some(node => {
            const children = Array.isArray(node.props.children) ? node.props.children : [node.props.children];
            return children.includes(action) && children.includes(description);
        }), 'azione e spiegazione sono adiacenti nello stesso gruppo');
        (action.props.onClick as () => void)();
        assert.deepEqual(calls, [scenario.action === 'Rileggi modelli' ? 'read' : 'choose:']);
        if (scenario.error) assert.ok(visible.some(node => node.props.role === 'alert' && text(node).includes(scenario.error!)));
        const editor = visible.find(node => node.type === 'select');
        assert.equal(!!editor, editing, 'il recupero preserva la riga riassuntiva e lo stato dell’editor');
    });
}
