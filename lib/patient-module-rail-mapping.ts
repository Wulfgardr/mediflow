/* @Codex WUL-560 L7B */

import type {
    Kree8WorkspaceNavGroups,
    Kree8WorkspaceNavItem,
} from '@/components/kree8/kree8-workspace-shell';

/* D-WebRail-01 is the explicit product binding. Its flattened order replaces
   the former flat rail; no label similarity or positional inference is used. */
const PATIENT_MODULE_RAIL_SPEC = [
    {
        id: 'quadro-decisioni',
        label: 'Quadro e decisioni',
        items: [
            { href: '#quadro', label: 'Quadro' },
            { href: '#attenzione', label: 'Attenzione' },
            { href: '#identita', label: 'Identità' },
            { href: '#parametri', label: 'Parametri' },
        ],
    },
    {
        id: 'terapie-prescrizioni',
        label: 'Terapie e prescrizioni',
        items: [
            { href: '#terapie', label: 'Terapie' },
            { href: '#prestazioni', label: 'Prestazioni' },
            { href: '#protesica', label: 'Protesica' },
            { href: '#scale', label: 'Scale' },
        ],
    },
    {
        id: 'documenti-prove',
        label: 'Documenti e prove',
        items: [
            { href: '#documenti', label: 'Documenti' },
            { href: '#siss', label: 'SISS/FSE' },
        ],
    },
    {
        id: 'diario-follow-up',
        label: 'Diario e follow-up',
        items: [
            { href: '#timeline', label: 'Timeline' },
            { href: '#diario', label: 'Diario' },
            { href: '#follow-up', label: 'Follow-up' },
        ],
    },
] as const;

type RailGroupCandidate = {
    readonly id: string;
    readonly label: string;
    readonly items: readonly Kree8WorkspaceNavItem[];
};

type ExpectedItem = { readonly href: string; readonly label: string };

const expectedItems = PATIENT_MODULE_RAIL_SPEC.reduce<ExpectedItem[]>(
    (items, group) => [...items, ...group.items],
    [],
);
const expectedHrefs = new Set(expectedItems.map((item) => item.href));
const expectedGroupIds = new Set(PATIENT_MODULE_RAIL_SPEC.map((group) => group.id));

function invalid(reason: string): never {
    throw new Error(`patient_module_rail_mapping_invalid:${reason}`);
}

function validateSourceItems(items: readonly Kree8WorkspaceNavItem[]): void {
    if (items.length < expectedItems.length) invalid('missing_item');
    if (items.length > expectedItems.length) invalid('extra_item');

    const seen = new Set<string>();
    for (const item of items) {
        if (seen.has(item.href)) invalid('duplicate_href');
        seen.add(item.href);
    }

    items.forEach((item, index) => {
        const expected = expectedItems[index];
        if (item.href !== expected.href) {
            const queryBase = item.href.split(/[?&]/, 1)[0];
            if (queryBase === expected.href) invalid('query_collision');
            if (expectedHrefs.has(item.href as typeof expected.href)) invalid('item_order');
            invalid('unknown_href');
        }
        if (item.label !== expected.label) invalid('label_drift');
    });
}

export function validatePatientModuleRailGroups(
    groups: readonly RailGroupCandidate[],
    sourceItems: readonly Kree8WorkspaceNavItem[],
): void {
    validateSourceItems(sourceItems);
    if (groups.length !== PATIENT_MODULE_RAIL_SPEC.length) invalid('group_count');

    let sourceIndex = 0;
    groups.forEach((group, groupIndex) => {
        const expectedGroup = PATIENT_MODULE_RAIL_SPEC[groupIndex];
        if (group.id !== expectedGroup.id) {
            if (expectedGroupIds.has(group.id as typeof expectedGroup.id)) invalid('group_order');
            invalid('unknown_group');
        }
        if (group.label !== expectedGroup.label) invalid('group_label_drift');
        if (group.items.length !== expectedGroup.items.length) invalid('group_item_count');

        group.items.forEach((item, itemIndex) => {
            const expected = (expectedGroup.items as readonly ExpectedItem[])[itemIndex];
            if (item.href !== expected.href) invalid('group_item_order');
            if (item !== sourceItems[sourceIndex]) invalid('item_identity_drift');
            sourceIndex += 1;
        });
    });
}

export function buildPatientModuleRailGroups(
    items: readonly Kree8WorkspaceNavItem[],
): Kree8WorkspaceNavGroups {
    validateSourceItems(items);
    let sourceIndex = 0;
    const groups = PATIENT_MODULE_RAIL_SPEC.map((group) => {
        const groupedItems = Object.freeze(items.slice(sourceIndex, sourceIndex + group.items.length));
        sourceIndex += group.items.length;
        return Object.freeze({ id: group.id, label: group.label, items: groupedItems });
    });
    validatePatientModuleRailGroups(groups, items);
    return Object.freeze(groups) as Kree8WorkspaceNavGroups;
}
