/* @Codex */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import Database from 'better-sqlite3';
import { WORK_PROFILE_SETTING_KEY, type WorkProfileCommand } from './work-profile.ts';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-work-profile-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
const databasePath = path.join(dataDir, 'medical.db');
const seed = new Database(databasePath);
for (const file of fs.readdirSync('drizzle').filter((name) => name.endsWith('.sql')).sort()) {
    seed.exec(fs.readFileSync(path.join('drizzle', file), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gmu, ''));
}
seed.prepare('INSERT INTO users (id, username, role, password_hash, encrypted_master_key, salt) VALUES (?, ?, ?, ?, ?, ?)')
    .run('synthetic-operator', 'synthetic-operator', 'user', 'synthetic-hash', 'synthetic-wrapped-key', 'synthetic-salt');
for (const [key, value] of [['network.mode', 'local-only'], ['aiPatientInsightKillSwitch', 'enabled'], ['clinicName', 'Synthetic clinic']]) {
    seed.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, value);
}
const baselineUsers = seed.prepare('SELECT * FROM users').all();
const baselineSettings = seed.prepare('SELECT * FROM settings ORDER BY key').all();
seed.close();
const { readWorkProfile, updateWorkProfile } = await import('./work-profile-service.ts');
test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

function command(action: WorkProfileCommand['action'], draft?: WorkProfileCommand['draft']): WorkProfileCommand {
    return { id: randomUUID(), expectedRevision: readWorkProfile().revision, action, ...(draft ? { draft } : {}) };
}

test('SQLite persists a resumable draft across a new process, confirms once and rolls back without changing setup', () => {
    const draft = { source: 'guided' as const, profile: 'interactive' as const, step: 1,
        answers: { activity: 'records' as const, interaction: null, platform: null } };
    const saved = updateWorkProfile(command('save-draft', draft));
    const script = path.join(dataDir, 'reread.mjs');
    fs.writeFileSync(script, `import {readWorkProfile} from ${JSON.stringify(path.join(process.cwd(), 'lib/work-profile-service.ts'))};\nprocess.stdout.write(JSON.stringify(readWorkProfile()));\n`);
    const child = spawnSync(process.execPath, ['scripts/run-strip-types.mjs', script], { encoding: 'utf8', env: process.env });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout.trim().split('\n').at(-1)!), saved);
    const stale = command('confirm');
    updateWorkProfile(command('save-draft', { ...draft, step: 3, answers: { ...draft.answers, interaction: 'screens', platform: 'macos' } }));
    assert.throws(() => updateWorkProfile(stale), /conflict/);
    const confirm = command('confirm');
    const confirmed = updateWorkProfile(confirm);
    assert.deepEqual(updateWorkProfile(confirm), confirmed);
    assert.equal(readWorkProfile().active?.profile, 'interactive');
    updateWorkProfile(command('save-draft', { ...draft, source: 'manual', profile: 'agent', step: 3 }));
    updateWorkProfile(command('confirm'));
    updateWorkProfile(command('rollback'));
    assert.equal(readWorkProfile().active?.profile, 'interactive');
    const disk = new Database(databasePath, { readonly: true });
    try {
        assert.deepEqual(JSON.parse((disk.prepare('SELECT value FROM settings WHERE key = ?').get(WORK_PROFILE_SETTING_KEY) as { value: string }).value), readWorkProfile());
        assert.deepEqual(disk.prepare('SELECT * FROM users').all(), baselineUsers);
        assert.deepEqual(disk.prepare('SELECT * FROM settings WHERE key != ? ORDER BY key').all(WORK_PROFILE_SETTING_KEY), baselineSettings);
    } finally { disk.close(); }
});

test('unreadable state is retained and cannot be replaced by a normal command', () => {
    const request = command('discard-draft');
    const disk = new Database(databasePath);
    try {
        disk.prepare('UPDATE settings SET value = ? WHERE key = ?').run('{broken', WORK_PROFILE_SETTING_KEY);
        assert.throws(() => readWorkProfile(), /state_invalid/);
        assert.throws(() => updateWorkProfile(request), /state_invalid/);
        assert.equal((disk.prepare('SELECT value FROM settings WHERE key = ?').get(WORK_PROFILE_SETTING_KEY) as { value: string }).value, '{broken');
    } finally { disk.close(); }
});
