import test from 'node:test';
import assert from 'node:assert/strict';
import {
    getPreviewProfileById,
    PREVIEW_PROFILE_FLAG_LABELS,
    PREVIEW_PROFILES,
    previewProfileIdFromSetting,
} from './preview-profiles.ts';

test('unknown preview profile ids fall back to base', () => {
    assert.equal(previewProfileIdFromSetting('unknown-profile'), 'base');
    assert.equal(getPreviewProfileById('unknown-profile').id, 'base');
});

test('liquid glass preview exposes the expected shell flags', () => {
    const profile = getPreviewProfileById('liquid-glass-ui');

    assert.equal(profile.kind, 'liquid_glass');
    assert.deepEqual(profile.featureFlags, ['liquid-shell', 'frosted-sidebar']);
    assert.equal(PREVIEW_PROFILE_FLAG_LABELS['liquid-shell'], 'Shell Liquid Glass');
});

test('preview profile registry ids stay unique', () => {
    const ids = PREVIEW_PROFILES.map((profile) => profile.id);
    assert.equal(new Set(ids).size, ids.length);
});
