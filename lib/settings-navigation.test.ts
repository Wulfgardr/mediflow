// WUL-297: unit coverage for the settings IA model and the quick-jump search.
// Run with: npm run test:settings-navigation

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { SETTINGS_NAV_GROUPS, searchSettingsNav } from './settings-navigation';

test('every nav item lives under /settings and has searchable metadata', () => {
    const ids = new Set<string>();
    const hrefs = new Set<string>();

    for (const group of SETTINGS_NAV_GROUPS) {
        assert.ok(group.items.length > 0, `group ${group.id} has items`);
        for (const item of group.items) {
            assert.ok(item.href.startsWith('/settings'), `${item.id} href under /settings`);
            assert.ok(item.keywords.length > 0, `${item.id} has keywords`);
            assert.ok(!ids.has(item.id), `${item.id} id unique`);
            assert.ok(!hrefs.has(item.href), `${item.href} href unique`);
            ids.add(item.id);
            hrefs.add(item.href);
        }
    }
});

test('every navigation href resolves to a settings route page', () => {
    for (const group of SETTINGS_NAV_GROUPS) {
        for (const item of group.items) {
            const routePage = path.join(process.cwd(), 'app', ...item.href.split('/').filter(Boolean), 'page.tsx');
            assert.ok(existsSync(routePage), `${item.href} resolves to ${routePage}`);
        }
    }
});

test('the danger zone is the only danger-toned surface', () => {
    const dangerItems = SETTINGS_NAV_GROUPS
        .flatMap((group) => group.items)
        .filter((item) => item.tone === 'danger');
    assert.equal(dangerItems.length, 1);
    assert.equal(dangerItems[0].id, 'zona-pericolo');
});

test('searching "pin" surfaces the access section first', () => {
    const matches = searchSettingsNav('pin');
    assert.ok(matches.length > 0);
    assert.equal(matches[0].item.id, 'accesso');
});

test('searching "backup" surfaces backup & restore first', () => {
    const matches = searchSettingsNav('backup');
    assert.ok(matches.length > 0);
    assert.equal(matches[0].item.id, 'backup');
});

/* @Codex */
test('searching "conformita" surfaces the evidence inventory first', () => {
    const matches = searchSettingsNav('conformita');
    assert.ok(matches.length > 0);
    assert.equal(matches[0].item.id, 'compliance-evidence');
});

test('searching "tema" surfaces appearance', () => {
    const matches = searchSettingsNav('tema');
    assert.ok(matches.length > 0);
    assert.equal(matches[0].item.id, 'aspetto');
});

test('accented queries are normalized (accessibilita)', () => {
    const matches = searchSettingsNav('accessibilita');
    assert.ok(matches.length > 0);
    assert.equal(matches[0].item.id, 'aspetto');
});

test('fuzzy subsequence matching still finds kill switches', () => {
    const matches = searchSettingsNav('kll swtch');
    assert.ok(matches.some((match) => match.item.id === 'ai-funzioni'));
});

test('empty query lists sections up to the limit, nonsense yields nothing', () => {
    assert.equal(searchSettingsNav('').length, 8);
    assert.equal(searchSettingsNav('', 12).length, 12);
    assert.equal(searchSettingsNav('zzzqqqxxx').length, 0);
});
