import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { backupDestinationIdentity } from '../scripts/backup-destination-policy.mjs';

test('runner-attacks: direct cloud, symlink retarget, missing volume, revoked acknowledgement, ENOSPC and failed readback preserve config and earlier copies', () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'backup-attacks-')));
    const data = path.join(root, 'data');
    fs.mkdirSync(data);
    const db = new Database(path.join(data, 'medical.db'));
    db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY,value TEXT); CREATE TABLE patients (id TEXT, first_name TEXT, last_name TEXT, tax_code TEXT);');
    db.prepare('INSERT INTO patients VALUES (?,?,?,?)').run('synthetic', 'SYNTHETIC', 'SENTINEL', 'SYNTHETIC_TAX_SENTINEL');
    const cloud = path.join(root, 'Library', 'Mobile Documents', 'com~apple~CloudDocs');
    const safe = path.join(root, 'safe');
    fs.mkdirSync(cloud, { recursive: true }); fs.mkdirSync(safe);
    const alias = path.join(root, 'ordinary');
    fs.symlinkSync(cloud, alias, 'junction');
    const preload = path.join(root, 'probe-and-fault.mjs');
    fs.writeFileSync(preload, `import fs from 'node:fs'; import cp from 'node:child_process'; import {createRequire} from 'node:module'; import {syncBuiltinESMExports} from 'node:module';
const spawn=cp.spawnSync,link=fs.linkSync,read=fs.readFileSync,open=fs.openSync;
fs.openSync=(file,...args)=>{if(process.env.FAULT==='exchange'&&String(file).endsWith('.mediflow.tmp')){fs.renameSync(process.env.EXCHANGE_DEST,process.env.EXCHANGE_DEST+'.original');fs.symlinkSync(process.env.EXCHANGE_CLOUD,process.env.EXCHANGE_DEST,'junction');fs.writeFileSync(process.env.EXCHANGE_DEST+'/.mediflow-backup.lock','unrelated lock');}return open(file,...args);};
cp.spawnSync=(file,args,options)=> {
 const volumeProbe=['/bin/df','/usr/sbin/diskutil','/usr/bin/plutil','findmnt','lsblk'].includes(file)||(file==='powershell.exe'&&args.some(arg=>String(arg).includes('Get-BitLockerVolume')));
 if(process.env.FAULT==='unverified'&&volumeProbe) return {status:1,stdout:'',stderr:'Access denied'};
 if(file==='/bin/df') return {status:0,stdout:'Filesystem Blocks Used Available Capacity Mounted on\\n/dev/disk9s1 1 1 1 1% /synthetic',stderr:''};
 if(file==='/usr/sbin/diskutil') return {status:0,stdout:'<plist/>',stderr:''};
 if(file==='/usr/bin/plutil') return {status:0,stdout:JSON.stringify({FileVault:process.env.FAULT!=='unencrypted'}),stderr:''};
 if(file==='powershell.exe'&&volumeProbe) return {status:0,stdout:JSON.stringify({VolumeStatus:process.env.FAULT==='unencrypted'?0:1,ProtectionStatus:1}),stderr:''};
 if(file==='findmnt') return {status:0,stdout:JSON.stringify({filesystems:[{source:'/dev/synthetic',fstype:'ext4'}]}),stderr:''};
 if(file==='lsblk') return {status:0,stdout:JSON.stringify({blockdevices:[{type:process.env.FAULT==='unencrypted'?'disk':'crypt'}]}),stderr:''};
 return spawn(file,args,options);
};
fs.linkSync=(...args)=>{if(process.env.FAULT==='enospc'){const error=new Error('Synthetic ENOSPC');error.code='ENOSPC';throw error;}const result=link(...args); if(process.env.FAULT==='concurrent-config'){const Database=createRequire(process.cwd()+'/package.json')('better-sqlite3'); const other=new Database(process.env.MEDIFLOW_DATA_DIR+'/medical.db');try{const state=JSON.parse(other.prepare('SELECT value FROM settings').get().value);state.config.hour=7;state.revision='concurrent-confirmed';other.prepare('UPDATE settings SET value=?').run(JSON.stringify(state));}finally{other.close();}}return result;};
fs.readFileSync=(file,...args)=>{if(process.env.FAULT==='readback'&&String(file).endsWith('.mediflow'))return 'synthetic corrupt readback';return read(file,...args);};
syncBuiltinESMExports();`);
    const run = (destination: string, fault = '', acknowledged = true) => {
        const config = { enabled: true, hour: 2, minute: 0, destinationDir: destination, retentionKeepArtifacts: 1, volumeProtectionAcknowledged: acknowledged, volumeProtectionIdentity: fs.existsSync(destination) ? backupDestinationIdentity(fs.realpathSync(destination)) : '' };
        db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('backupScheduler', JSON.stringify({ version: 1, config, run: { lastArtifactPath: 'preserved-previous-artifact' } }));
        const child = spawnSync(process.execPath, ['--import', preload, 'scripts/run-scheduled-backup.mjs'], { encoding: 'utf8', env: { ...process.env, MEDIFLOW_DATA_DIR: data, MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1', MEDIFLOW_BACKUP_FORCE: '0', MEDIFLOW_BACKUP_DEST_DIR: '', FAULT: fault, EXCHANGE_DEST: destination, EXCHANGE_CLOUD: cloud } });
        assert.ifError(child.error);
        const result = JSON.parse(child.stdout);
        const state = JSON.parse((db.prepare('SELECT value FROM settings').get() as { value: string }).value);
        assert.deepEqual(state.config, fault === 'concurrent-config' ? { ...config, hour: 7 } : config);
        if (fault === 'concurrent-config') assert.equal(state.revision, 'concurrent-confirmed');
        return { result, state, status: child.status };
    };
    try {
        const control = run(safe);
        assert.equal(control.status, 0); assert.equal(control.state.run.lastRunStatus, 'success');
        assert.match(fs.readFileSync(control.result.artifactPath, 'utf8'), /SYNTHETIC_TAX_SENTINEL/);
        const old = fs.readFileSync(control.result.artifactPath);
        assert.equal(run(safe, 'concurrent-config').state.run.lastRunStatus, 'success');
        assert.equal(run(safe, 'unverified', false).state.run.lastRunStatus, 'error');
        assert.equal(run(safe, 'unverified', true).state.run.lastRunStatus, 'success');
        for (const destination of [cloud, alias, path.join(root, 'Volumes', 'AbsentDisk', 'backups')]) {
            const failed = run(destination);
            assert.equal(failed.status, 1); assert.equal(failed.result.ok, false); assert.equal(failed.state.run.lastRunStatus, 'error');
            assert.equal(failed.state.run.lastArtifactPath, 'preserved-previous-artifact');
        }
        for (const fault of ['enospc', 'readback', 'unencrypted']) {
            const failed = run(safe, fault);
            assert.equal(failed.status, 1, fault); assert.equal(failed.state.run.lastRunStatus, 'error');
        }
        const exchanged = path.join(root, 'exchanged'); fs.mkdirSync(exchanged);
        const failed = run(exchanged, 'exchange');
        assert.equal(failed.status, 1); assert.equal(failed.state.run.lastRunStatus, 'error');
        assert.equal(failed.state.run.lastArtifactPath, 'preserved-previous-artifact');
        assert.equal(fs.readFileSync(path.join(cloud, '.mediflow-backup.lock'), 'utf8'), 'unrelated lock');
        const cloudFiles = fs.readdirSync(cloud).filter(name => name !== '.mediflow-backup.lock');
        assert.equal(cloudFiles.length, 1); assert.ok(cloudFiles[0].endsWith('.mediflow.tmp'));
        assert.equal(fs.statSync(path.join(cloud, cloudFiles[0])).size, 0);
        fs.unlinkSync(path.join(cloud, cloudFiles[0])); fs.unlinkSync(path.join(cloud, '.mediflow-backup.lock'));
        assert.deepEqual(fs.readFileSync(control.result.artifactPath), old);
        assert.deepEqual(fs.readdirSync(cloud), []);
        assert.equal(fs.existsSync(path.join(root, 'Volumes')), false);
    } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); }
});


for (const phase of ['before-open', 'after-open', 'before-link', 'after-link', 'readback', 'published-inode', 'temporary-inode']) {
    test(`runner-attacks: directory or file exchange at ${phase} never confirms publication`, async t => {
        const { publishScheduledBackup } = await import(new URL('../scripts/run-scheduled-backup.mjs', import.meta.url).href);
        const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'backup-exchange-')));
        const destination = path.join(root, 'safe');
        const cloud = path.join(root, 'OneDrive - Synthetic');
        fs.mkdirSync(destination); fs.mkdirSync(cloud);
        const identity = fs.statSync(destination);
        const finalPath = path.join(destination, 'synthetic.mediflow');
        const tempPath = `${finalPath}.tmp`;
        const artifact = 'SYNTHETIC_TAX_SENTINEL';
        const open = fs.openSync, link = fs.linkSync, read = fs.readFileSync;
        const exchangeDirectory = () => {
            fs.renameSync(destination, path.join(root, 'original'));
            fs.symlinkSync(cloud, destination, 'junction');
            fs.writeFileSync(tempPath, 'unrelated temporary');
            if (phase !== 'before-open') fs.writeFileSync(finalPath, 'unrelated artifact');
        };
        let exchanged = false;
        t.mock.method(fs, 'openSync', (...args: Parameters<typeof fs.openSync>) => {
            if (String(args[0]) === tempPath && phase === 'before-open') { exchanged = true; exchangeDirectory(); fs.unlinkSync(tempPath); }
            const fd = open(...args);
            if (String(args[0]) === tempPath && phase === 'after-open') { exchanged = true; exchangeDirectory(); }
            return fd;
        });
        t.mock.method(fs, 'linkSync', (...args: Parameters<typeof fs.linkSync>) => {
            if (phase === 'before-link') { exchanged = true; exchangeDirectory(); fs.unlinkSync(finalPath); }
            if (phase === 'temporary-inode') { exchanged = true; fs.renameSync(tempPath, `${tempPath}.original`); fs.writeFileSync(tempPath, artifact); }
            const result = link(...args);
            if (phase === 'after-link') { exchanged = true; exchangeDirectory(); }
            if (phase === 'published-inode') { exchanged = true; fs.renameSync(finalPath, `${finalPath}.original`); fs.writeFileSync(finalPath, artifact); }
            return result;
        });
        t.mock.method(fs, 'readFileSync', (...args: Parameters<typeof fs.readFileSync>) => {
            const result = read(...args);
            if (String(args[0]) === finalPath && phase === 'readback') { exchanged = true; exchangeDirectory(); }
            return result;
        });
        try {
            assert.throws(() => publishScheduledBackup(finalPath, artifact, identity));
            assert.equal(exchanged, true);
            if (['before-open', 'after-open'].includes(phase)) {
                assert.equal(fs.readFileSync(path.join(cloud, 'synthetic.mediflow.tmp'), 'utf8'), phase === 'before-open' ? '' : 'unrelated temporary');
                if (phase === 'before-open') assert.equal(fs.existsSync(path.join(cloud, 'synthetic.mediflow')), false);
                else assert.equal(fs.readFileSync(path.join(cloud, 'synthetic.mediflow'), 'utf8'), 'unrelated artifact');
            }
            if (['after-open', 'before-link', 'after-link', 'readback'].includes(phase)) {
                assert.equal(fs.readFileSync(path.join(cloud, 'synthetic.mediflow.tmp'), 'utf8'), 'unrelated temporary');
            }
            if (phase === 'after-open') assert.equal(fs.statSync(path.join(root, 'original', 'synthetic.mediflow.tmp')).size, 0);
            if (phase === 'temporary-inode') assert.equal(fs.readFileSync(tempPath, 'utf8'), artifact);
        } finally { t.mock.restoreAll(); fs.rmSync(root, { recursive: true, force: true }); }
    });
}
