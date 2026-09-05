/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createPatientSmartImportHostKillSwitch } from './patient-smart-import-host-kill-switch';

test('reads the host Smart Import kill switch once and enables only an explicit enabled value', async () => {
    let reads = 0;
    const killSwitch = createPatientSmartImportHostKillSwitch({
        readSetting: async () => {
            reads += 1;
            return 'enabled';
        },
    });

    const result = await killSwitch.read();

    assert.deepEqual(result, { status: 'enabled' });
    assert.equal(reads, 1);
    assert.equal(Object.isFrozen(result), true);
});

test('fails closed for absent, false, and malformed settings', async () => {
    const throwingAccessor = Object.defineProperty({}, 'raw', {
        get: () => { throw new Error('synthetic accessor marker'); },
    });

    for (const value of [undefined, null, false, 'false', 'disabled', '', 'malformed', throwingAccessor]) {
        const result = await createPatientSmartImportHostKillSwitch({
            readSetting: async () => value,
        }).read();

        assert.deepEqual(result, { status: 'denied', code: 'disabled' });
        assert.equal(Object.isFrozen(result), true);
    }
});

test('maps an unavailable setting read to a fixed PHI-safe denial', async () => {
    const result = await createPatientSmartImportHostKillSwitch({
        readSetting: async () => { throw new Error('synthetic raw database marker'); },
    }).read();

    assert.deepEqual(result, { status: 'denied', code: 'unavailable' });
    assert.equal(Object.isFrozen(result), true);
    assert.equal(JSON.stringify(result).includes('synthetic raw database marker'), false);
});
