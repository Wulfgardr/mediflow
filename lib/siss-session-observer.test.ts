/* @Codex */
import assert from 'node:assert/strict';
/* @Codex */
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
/* @Codex */
import {
    buildSissSessionStatusFromHistory,
    resolveSissObservedModuleFromUrl,
    readSissSessionStatusFromAtlasHistory,
} from './siss-session-observer';

test('resolveSissObservedModuleFromUrl maps Atlas-observed operator paths to stable modules', () => {
    assert.equal(resolveSissObservedModuleFromUrl('https://operatorisiss.servizirl.it/menusiss/#/menusiss'), 'menu');
    assert.equal(resolveSissObservedModuleFromUrl('https://operatorisiss.servizirl.it/menusiss/'), 'menu');
    assert.equal(resolveSissObservedModuleFromUrl('https://operatorisiss.servizirl.it/prescrizione/'), 'prescription');
    assert.equal(resolveSissObservedModuleFromUrl('https://operatorisiss.servizirl.it/prescrittivoRegionale/pages/dashboard'), 'prescription');
    assert.equal(resolveSissObservedModuleFromUrl('https://operatorisiss.servizirl.it/assistantrl/home/'), 'prosthetics');
    assert.equal(resolveSissObservedModuleFromUrl('https://operatorisiss.servizirl.it/opefseie/#/app-fascicolo'), 'fse');
    assert.equal(resolveSissObservedModuleFromUrl('https://operatorisiss.servizirl.it/fse/'), 'fse');
    assert.equal(resolveSissObservedModuleFromUrl('https://operatorisiss.servizirl.it/gaia/#assistiti/iscrizione'), 'registry');
    assert.equal(resolveSissObservedModuleFromUrl('https://operatorisiss.servizirl.it/anagrafe/'), 'registry');
    assert.equal(resolveSissObservedModuleFromUrl('https://operatorisiss.servizirl.it/ddcl/'), null);
});

test('buildSissSessionStatusFromHistory summarizes remote-sign and last module without exposing raw URLs', () => {
    const status = buildSissSessionStatusFromHistory(
        [
            {
                url: 'https://operatorisiss.servizirl.it/opefseie/#/app-fascicolo',
                title: 'OpeFseIE',
                visitedAt: '2026-04-15T07:27:00.000Z',
            },
            {
                url: 'https://idpcrlmain.crs.lombardia.it/ssoauth/ConfirmSelectedRole',
                title: 'IdPC - pagina di redirect',
                visitedAt: '2026-04-15T07:26:30.000Z',
            },
            {
                url: 'https://idpcrlmain.crs.lombardia.it/ssoauth/LoginRemoteSign',
                title: 'IdPC Regione Lombardia - Seleziona Ruolo',
                visitedAt: '2026-04-15T07:26:00.000Z',
            },
            {
                url: 'https://operatorisiss.servizirl.it/assistantrl/home/#/p15',
                title: 'Assistente RL',
                visitedAt: '2026-04-15T06:30:00.000Z',
            },
            {
                url: 'https://operatorisiss.servizirl.it/gaia/#assistiti/iscrizione/seleziona/SLNRRT97D61F065X',
                title: 'Gaia',
                visitedAt: '2026-04-15T06:00:00.000Z',
            },
        ],
        {
            browserProfile: 'Default',
            now: new Date('2026-04-15T08:00:00.000Z'),
        },
    );

    assert.equal(status.status, 'available');
    assert.equal(status.browserProfile, 'Default');
    assert.equal(status.sessionHealth, 'recent');
    assert.equal(status.lastModule, 'fse');
    assert.equal(status.lastModuleLabel, 'FSE OpeFseIE');

    const remoteSignature = status.checkpoints.find((checkpoint) => checkpoint.key === 'remote-signature');
    const prosthetics = status.checkpoints.find((checkpoint) => checkpoint.key === 'prosthetics');
    const prescription = status.checkpoints.find((checkpoint) => checkpoint.key === 'prescription');
    const registry = status.checkpoints.find((checkpoint) => checkpoint.key === 'registry');

    assert.equal(remoteSignature?.health, 'recent');
    assert.equal(remoteSignature?.observedAt, '2026-04-15T07:26:00.000Z');
    assert.equal(prosthetics?.health, 'recent');
    assert.equal(prosthetics?.label, 'Protesica-RL');
    assert.equal(prescription?.label, 'Prescrittivo Regionale (PRREG)');
    assert.equal(registry?.health, 'recent');
    assert.equal(registry?.label, 'Anagrafe Gaia');
});

test('buildSissSessionStatusFromHistory returns unavailable when Atlas rows are missing', () => {
    const status = buildSissSessionStatusFromHistory([], {
        warning: 'Cronologia Atlas non disponibile su questa macchina.',
        now: new Date('2026-04-15T08:00:00.000Z'),
    });

    assert.equal(status.status, 'unavailable');
    assert.equal(status.sessionHealth, 'none');
    assert.equal(status.warning, 'Cronologia Atlas non disponibile su questa macchina.');
    assert.equal(status.lastModule, null);
});

test('failed history copy removes only its owned temporary root and preserves the error', (t) => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-siss-copy-test-')));
    const source = path.join(root, 'synthetic-history');
    const unrelated = path.join(root, 'unrelated');
    fs.writeFileSync(source, 'synthetic partial copy');
    fs.writeFileSync(unrelated, 'keep');
    const { mkdtempSync, copyFileSync, existsSync } = fs;
    const failure = new Error('synthetic copy failure');
    let copyRoot = '';
    try {
        // Discovery is synthetic: none of these calls reads the real Atlas history.
        t.mock.method(fs, 'existsSync', () => true);
        t.mock.method(fs, 'readdirSync', () => [{ name: 'synthetic-profile', isDirectory: () => true }]);
        t.mock.method(fs, 'statSync', () => ({ mtimeMs: 1 }));
        t.mock.method(fs, 'mkdtempSync', () => (copyRoot = mkdtempSync(path.join(root, 'owned-'))));
        t.mock.method(fs, 'copyFileSync', (_input: string, destination: string) => {
            copyFileSync(source, destination); // Leave a real partial file before failure.
            throw failure;
        });
        assert.throws(() => readSissSessionStatusFromAtlasHistory(), (error: unknown) => error === failure);
        assert.notEqual(copyRoot, '');
        assert.equal(existsSync(copyRoot), false);
        assert.equal(existsSync(source), true);
        assert.equal(fs.readFileSync(unrelated, 'utf8'), 'keep');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
