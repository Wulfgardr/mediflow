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

test('ai stack preview keeps only functional flags on top of the official shell', () => {
    const profile = getPreviewProfileById('ai-stack-preview');

    assert.equal(profile.kind, 'ai_stack');
    assert.deepEqual(profile.featureFlags, ['ai-preview']);
    assert.equal(PREVIEW_PROFILE_FLAG_LABELS['ai-preview'], 'Badge AI preview');
});

test('preview profile registry ids stay unique', () => {
    const ids = PREVIEW_PROFILES.map((profile) => profile.id);
    assert.equal(new Set(ids).size, ids.length);
});
