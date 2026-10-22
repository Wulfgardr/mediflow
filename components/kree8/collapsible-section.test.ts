import assert from 'node:assert/strict';
import test from 'node:test';
import { mountContract, find, flatten, element } from '../settings/settings-presentation.test-support.ts';

test('una sezione visitata conserva il form montato dopo la chiusura', () => {
    const draft = element('textarea', { defaultValue: 'Bozza sintetica in corso' });
    const harness = mountContract('components/kree8/collapsible-section.tsx', 'CollapsibleSection', {
        props: { title: 'Sezione sintetica', children: draft },
        imports: { '@/components/runtime-twin-design': { useRuntimeTwinFolder: () => null } },
    });
    let tree = harness.render();
    assert.equal(flatten(tree).filter(node => node.type === 'textarea').length, 0);
    (find(tree, node => node.type === 'button').props.onClick as () => void)();
    tree = harness.render();
    assert.equal(flatten(tree).filter(node => node.type === 'textarea').length, 1);
    (find(tree, node => node.type === 'button').props.onClick as () => void)();
    tree = harness.render();
    const content = find(tree, node => typeof node.props.id === 'string' && node.props.id.endsWith('-region'));
    assert.equal(content.props.hidden, true);
    assert.equal(flatten(content).filter(node => node.type === 'textarea').length, 1, 'chiudere non deve smontare il form');
    assert.equal(find(content, node => node.type === 'textarea').props.defaultValue, 'Bozza sintetica in corso');
});
