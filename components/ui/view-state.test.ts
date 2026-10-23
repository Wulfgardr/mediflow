import assert from 'node:assert/strict';
import test from 'node:test';
import { find, flatten, mountContract, text } from '../settings/settings-presentation.test-support.ts';

for (const state of ['loading', 'empty', 'error', 'unavailable'] as const) test(`ViewState presents only the supplied ${state} state without inventing an action`, () => {
    const harness = mountContract('components/ui/view-state.tsx', 'ViewState', { props: {
        state, title: `Stato ${state} dei controlli`, detail: 'Le note già lette restano disponibili.',
    } });
    const tree = harness.render();
    assert.equal(find(tree, node => node.props.role === (state === 'error' || state === 'unavailable' ? 'alert' : 'status')).props['data-view-state'], state);
    assert.match(text(tree), new RegExp(`Stato ${state} dei controlli`));
    assert.match(text(tree), /Le note già lette restano disponibili/u);
    assert.equal(flatten(tree).filter(node => node.type === 'button' || node.type === 'a').length, 0);
    assert.equal(harness.effects.length, 0);
});

test('ViewState exposes only the real action supplied by the caller', () => {
    let calls = 0;
    const tree = mountContract('components/ui/view-state.tsx', 'ViewState', { props: {
        state: 'error', title: 'Lettura dei controlli fallita.', action: { label: 'Rileggi i controlli', onClick: () => { calls++; } },
    } }).render();
    const actions = flatten(tree).filter(node => node.type === 'button');
    assert.equal(actions.length, 1); assert.equal(text(actions[0]), 'Rileggi i controlli');
    assert.equal(calls, 0); (actions[0].props.onClick as () => void)(); assert.equal(calls, 1);
});
