/* @Codex WUL-560 L7B */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildPatientModuleRailGroups,
    validatePatientModuleRailGroups,
} from './patient-module-rail-mapping';

const canonicalItems = () => [
    { href: '#quadro', label: 'Quadro', meta: 'q' },
    { href: '#attenzione', label: 'Attenzione', meta: 'a' },
    { href: '#identita', label: 'Identità' },
    { href: '#parametri', label: 'Parametri', meta: 'p' },
    { href: '#terapie', label: 'Terapie', meta: 't' },
    { href: '#prestazioni', label: 'Prestazioni' },
    { href: '#protesica', label: 'Protesica' },
    { href: '#scale', label: 'Scale' },
    { href: '#documenti', label: 'Documenti', meta: 'd' },
    { href: '#siss', label: 'SISS/FSE' },
    { href: '#timeline', label: 'Timeline' },
    { href: '#diario', label: 'Diario' },
    { href: '#follow-up', label: 'Follow-up', meta: 'f' },
] as const;

test('builds the four D-WebRail-01 groups without cloning caller items', () => {
    const items = canonicalItems();
    const groups = buildPatientModuleRailGroups(items);

    assert.deepEqual(groups.map(({ id, label }) => ({ id, label })), [
        { id: 'quadro-decisioni', label: 'Quadro e decisioni' },
        { id: 'terapie-prescrizioni', label: 'Terapie e prescrizioni' },
        { id: 'documenti-prove', label: 'Documenti e prove' },
        { id: 'diario-follow-up', label: 'Diario e follow-up' },
    ]);
    assert.deepEqual(groups.map((group) => group.items.map((item) => item.href)), [
        ['#quadro', '#attenzione', '#identita', '#parametri'],
        ['#terapie', '#prestazioni', '#protesica', '#scale'],
        ['#documenti', '#siss'],
        ['#timeline', '#diario', '#follow-up'],
    ]);
    assert.deepEqual(groups.flatMap((group) => group.items), items);
    groups.flatMap((group) => group.items).forEach((item, index) => assert.equal(item, items[index]));
});

test('fails closed on incomplete, duplicate, unknown, reordered, query or label input', () => {
    const cases = [
        { name: 'missing', items: canonicalItems().slice(0, -1), reason: 'missing_item' },
        { name: 'extra', items: [...canonicalItems(), { href: '#extra', label: 'Extra' }], reason: 'extra_item' },
        { name: 'duplicate', items: canonicalItems().map((item, index) => index === 1 ? canonicalItems()[0] : item), reason: 'duplicate_href' },
        { name: 'unknown', items: canonicalItems().map((item, index) => index === 0 ? { href: '#unknown', label: 'Quadro' } : item), reason: 'unknown_href' },
        { name: 'reordered', items: [canonicalItems()[1], canonicalItems()[0], ...canonicalItems().slice(2)], reason: 'item_order' },
        { name: 'query', items: canonicalItems().map((item, index) => index === 0 ? { href: '#quadro?copy=1', label: 'Quadro' } : item), reason: 'query_collision' },
        { name: 'label', items: canonicalItems().map((item, index) => index === 0 ? { href: '#quadro', label: 'Quadro clinico' } : item), reason: 'label_drift' },
    ];

    for (const entry of cases) {
        assert.throws(
            () => buildPatientModuleRailGroups(entry.items),
            new RegExp(`patient_module_rail_mapping_invalid:${entry.reason}`),
            entry.name,
        );
    }
});

test('rejects group identity, order and caller-object drift', () => {
    const items = canonicalItems();
    const groups = buildPatientModuleRailGroups(items);
    const cloned = groups.map((group) => ({ ...group, items: [...group.items] }));

    assert.throws(
        () => validatePatientModuleRailGroups(
            cloned.map((group, index) => index === 0 ? { ...group, id: 'unknown-group' } : group),
            items,
        ),
        /patient_module_rail_mapping_invalid:unknown_group/,
    );
    assert.throws(
        () => validatePatientModuleRailGroups([cloned[1], cloned[0], cloned[2], cloned[3]], items),
        /patient_module_rail_mapping_invalid:group_order/,
    );
    assert.throws(
        () => validatePatientModuleRailGroups(
            cloned.map((group, index) => index === 0
                ? { ...group, items: [{ ...group.items[0] }, ...group.items.slice(1)] }
                : group),
            items,
        ),
        /patient_module_rail_mapping_invalid:item_identity_drift/,
    );
});
