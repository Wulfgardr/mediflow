import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SYNC_DIRECTORY_NAMES, isSynchronizedBackupPath, resolveBackupDestination, probeBackupVolume, validateBackupDestination } from '../scripts/backup-destination-policy.mjs';

test('path-validation: declared cloud directory roster, variants and Documents/Desktop on all platforms', () => {
    for (const platform of ['darwin', 'linux', 'win32']) {
        const api = platform === 'win32' ? path.win32 : path.posix;
        const homeDir = platform === 'win32' ? 'C:\\Users\\synthetic' : '/home/synthetic';
        for (const name of SYNC_DIRECTORY_NAMES) {
            for (const variant of [name, `${name} - Organization`, `${name}-Organization`]) {
                assert.equal(isSynchronizedBackupPath(api.join(homeDir, variant, 'backups'), { platform, homeDir }), true, `${platform}:${variant}`);
            }
        }
        for (const name of ['Documents', 'Desktop']) assert.equal(isSynchronizedBackupPath(api.join(homeDir, name, 'backups'), { platform, homeDir }), true);
        assert.equal(isSynchronizedBackupPath(api.join(homeDir, 'local-backups'), { platform, homeDir }), false);
    }
});

test('path-validation: real symlinks, missing directories and mount roots are rejected without writes', () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'backup-policy-')));
    try {
        const cloud = path.join(root, 'Library', 'Mobile Documents', 'com~apple~CloudDocs');
        fs.mkdirSync(cloud, { recursive: true });
        const alias = path.join(root, 'ordinary-backups');
        fs.symlinkSync(cloud, alias, 'junction');
        for (const destination of [cloud, alias]) assert.throws(() => resolveBackupDestination(destination), /sincronizzata/);
        const missing = path.join(root, 'absent-volume', 'backups');
        assert.throws(() => validateBackupDestination(missing, true), /non è disponibile/);
        assert.equal(fs.existsSync(path.dirname(missing)), false);
        const local = path.join(root, 'local');
        fs.mkdirSync(local);
        assert.equal(resolveBackupDestination(local), local);
        fs.symlinkSync(local, path.join(root, 'safe-alias'), 'junction');
        assert.equal(resolveBackupDestination(path.join(root, 'safe-alias')), local);
        assert.deepEqual(fs.readdirSync(cloud), []);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('volume protection distinguishes verified, known unencrypted and inaccessible probes without privilege escalation', () => {
    for (const encrypted of [true, false]) {
        const calls: string[] = [];
        const result = probeBackupVolume('/synthetic', { platform: 'darwin', run(file) {
            calls.push(file); if (file === '/bin/df') return 'Filesystem Blocks Used Available Capacity Mounted on\n/dev/disk9s1 1 1 1 1% /synthetic'; return file.endsWith('diskutil') ? '<plist/>' : JSON.stringify({ FileVault: encrypted });
        } });
        assert.equal(result, encrypted ? 'verified' : 'unencrypted');
        assert.deepEqual(calls, ['/bin/df', '/usr/sbin/diskutil', '/usr/bin/plutil']);
    }
    assert.equal(probeBackupVolume('C:\\synthetic', { platform: 'win32', run: () => JSON.stringify({ VolumeStatus: 1, ProtectionStatus: 1 }) }), 'verified');
    assert.equal(probeBackupVolume('C:\\synthetic', { platform: 'win32', run: () => JSON.stringify({ VolumeStatus: 0, ProtectionStatus: 0 }) }), 'unencrypted');
    for (const platform of ['darwin', 'win32', 'linux', 'unknown']) assert.equal(probeBackupVolume('/synthetic', { platform, run: () => { throw new Error('Access denied'); } }), 'unverified');
    for (const crypt of [true, false]) assert.equal(probeBackupVolume('/synthetic', { platform: 'linux', run: file => file === 'findmnt' ? JSON.stringify({ filesystems: [{ source: '/dev/mapper/synthetic', fstype: 'ext4' }] }) : JSON.stringify({ blockdevices: [{ type: 'lvm', children: [{ type: crypt ? 'crypt' : 'disk' }] }] }) }), crypt ? 'verified' : 'unencrypted');
});


test('path-validation: an existing ordinary folder cannot substitute for an unmounted volume', t => {
    t.mock.method(fs, 'realpathSync', (value: fs.PathLike) => String(value));
    t.mock.method(fs, 'lstatSync', () => ({ isSymbolicLink: () => false }));
    t.mock.method(fs, 'statSync', () => ({ dev: 42, isDirectory: () => true }));
    for (const destination of ['/Volumes/AbsentDisk/backups', '/mnt/AbsentDisk/backups', '/media/synthetic/AbsentDisk/backups', '/run/media/synthetic/AbsentDisk/backups']) {
        assert.throws(() => resolveBackupDestination(destination), /non risulta montato/);
    }
});


test('Linux mixed storage chains never treat one encrypted leg as protection of the whole volume', () => {
    assert.equal(probeBackupVolume('/synthetic', { platform: 'linux', run: file => file === 'findmnt' ? JSON.stringify({ filesystems: [{ source: '/dev/mapper/synthetic', fstype: 'ext4' }] }) : JSON.stringify({ blockdevices: [{ type: 'raid1', children: [{ type: 'crypt' }, { type: 'disk' }] }] }) }), 'unverified');
});


test('Windows suspended protection and partial encryption are rejected; Linux multi-device filesystems require explicit acknowledgement', () => {
    for (const info of [{ VolumeStatus: 1, ProtectionStatus: 0 }, { VolumeStatus: 2, ProtectionStatus: 1 }]) {
        assert.equal(probeBackupVolume('C:\\synthetic', { platform: 'win32', run: () => JSON.stringify(info) }), 'unencrypted');
    }
    assert.equal(probeBackupVolume('/synthetic', { platform: 'linux', run: file => file === 'findmnt' ? JSON.stringify({ filesystems: [{ source: '/dev/mapper/synthetic', fstype: 'btrfs' }] }) : JSON.stringify({ blockdevices: [{ type: 'crypt' }] }) }), 'unverified');
});
