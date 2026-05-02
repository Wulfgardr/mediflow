/* @Codex */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildUpdateAwarenessPayload, compareReleaseVersions, parseLatestChangelog } from './update-awareness.ts';

test('compareReleaseVersions compares semantic release versions', () => {
    assert.equal(compareReleaseVersions('0.5.1', '0.5.0'), 1);
    assert.equal(compareReleaseVersions('v0.5.0', '0.5.1'), -1);
    assert.equal(compareReleaseVersions('0.5.0', '0.5.0'), 0);
    assert.equal(compareReleaseVersions('not-a-version', '0.5.0'), 0);
});

test('buildUpdateAwarenessPayload prefers local manifest over env runtime values', () => {
    const previousVersion = process.env.MEDIFLOW_AVAILABLE_VERSION;
    process.env.MEDIFLOW_AVAILABLE_VERSION = '0.6.0';

    try {
        const payload = buildUpdateAwarenessPayload({
            currentVersion: '0.5.0',
            manifest: { version: '0.5.2', channel: 'stable', notes: ['Aggiornamento locale pronto'] },
            checkedAt: new Date('2026-05-02T00:00:00.000Z'),
        });

        assert.equal(payload.availableVersion, '0.5.2');
        assert.equal(payload.updateAvailable, true);
        assert.equal(payload.source, 'local-manifest');
        assert.equal(payload.channel, 'stable');
        assert.deepEqual(payload.notes, ['Aggiornamento locale pronto']);
    } finally {
        if (previousVersion === undefined) delete process.env.MEDIFLOW_AVAILABLE_VERSION;
        else process.env.MEDIFLOW_AVAILABLE_VERSION = previousVersion;
    }
});

test('parseLatestChangelog extracts the first release section bullets', () => {
    const result = parseLatestChangelog(`
# Changelog

## [Unreleased] - 2026-05-01

- First change.
- Second change.

## [0.5.0] - 2026-03-29

- Old change.
`);

    assert.equal(result.title, '[Unreleased] - 2026-05-01');
    assert.deepEqual(result.notes, ['First change.', 'Second change.']);
});
