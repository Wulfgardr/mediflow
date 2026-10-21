import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTerritorialPackCommand, projectTerritorialPacks, TERRITORIAL_PACK_SCHEMA } from './territorial-packs';

for (const preset of ['core', 'core+it', 'core+it+lom']) {
    test(`valid territorial preset ${preset}`, () => {
        const state = projectTerritorialPacks(JSON.stringify({ schemaVersion: TERRITORIAL_PACK_SCHEMA, revision: 2, preset }));
        assert.equal(state.preset, preset);
        assert.equal(state.status, 'ready');
        assert.equal(state.revision, 2);
    });
}
test('absent configuration is core; malformed and unknown configuration stays visibly invalid and core', () => {
    assert.equal(projectTerritorialPacks(undefined).preset, 'core');
    assert.equal(projectTerritorialPacks(undefined).status, 'ready');
    for (const value of ['{', 'null', '{}', ...['core+lom', 'unknown', 'LOM'].map(preset => JSON.stringify({ schemaVersion: TERRITORIAL_PACK_SCHEMA, revision: 1, preset })),
        JSON.stringify({ schemaVersion: 'future', revision: 1, preset: 'core+it+lom' }),
        JSON.stringify({ schemaVersion: TERRITORIAL_PACK_SCHEMA, revision: -1, preset: 'core+it+lom' })]) {
        assert.deepEqual(projectTerritorialPacks(value), { schemaVersion: TERRITORIAL_PACK_SCHEMA, revision: null, preset: 'core', status: 'configuration_error' });
    }
});
test('commands require an exact versioned explicit confirmation and revision', () => {
    const command = { schemaVersion: TERRITORIAL_PACK_SCHEMA, expectedRevision: 0, preset: 'core+it+lom', confirmed: true };
    assert.deepEqual(parseTerritorialPackCommand(command), command);
    for (const invalid of [{ ...command, confirmed: false }, { ...command, preset: 'core+lom' }, { ...command, channel: 'supervisor' }, { ...command, expectedRevision: -1 }, { ...command, schemaVersion: 'unknown' }]) {
        assert.throws(() => parseTerritorialPackCommand(invalid));
    }
});
