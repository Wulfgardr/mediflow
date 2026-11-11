import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

// Rischio #2 (censimento macchine a stati, 11/11): il giornale dello swap
// SQLite salva solo il PID del processo che scambiava. Se dopo il crash il
// processo che riparte riceve lo stesso PID (container, launchd), il recupero
// scambia sé stesso per il proprietario vivo e resta in HOLD, anche se
// original.db è integro e il ripristino è dimostrabile. Il processo che
// esegue il recupero all'avvio non può essere lo swap in corso: deve
// recuperare.
const root = process.cwd();

function fixture(file: string, value: string) {
    const db = new Database(file);
    db.exec('CREATE TABLE synthetic_recovery (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    db.prepare('INSERT INTO synthetic_recovery VALUES (1, ?)').run(value);
    db.close();
}

function worker(dir: string, script: string, extraEnv: Record<string, string> = {}) {
    const result = spawnSync(process.execPath, ['scripts/run-strip-types.mjs', '--input-type=module', '-e', script], {
        cwd: root, encoding: 'utf8', timeout: 30_000,
        env: { ...process.env, MEDIFLOW_DATA_DIR: dir, MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1', ...extraEnv },
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null, result.stderr);
    return result;
}

const crashScript = `
    import Database from 'better-sqlite3';
    import path from 'node:path';
    import { replaceSqliteDatabase } from './lib/sqlite-repair.ts';
    const dir = process.env.MEDIFLOW_DATA_DIR;
    const destPath = path.join(dir, 'medical.db');
    const live = new Database(destPath);
    await replaceSqliteDatabase({ sourcePath: path.join(dir, 'replacement.db'), destPath, connection: live,
        reopenConnection: () => new Database(destPath),
        onPhaseForTest: phase => { if (phase === 'retired') process.exit(86); },
    });
`;

// Il processo che riparte ha lo stesso PID scritto nel giornale: lo si
// simula riscrivendo il PID del giornale con quello del processo di recupero.
const samePidRecoveryScript = `
    import Database from 'better-sqlite3';
    import fs from 'node:fs';
    import path from 'node:path';
    import { recoverSqliteSwapArtifacts } from './lib/sqlite-repair.ts';
    const target = path.join(process.env.MEDIFLOW_DATA_DIR, 'medical.db');
    const journalPath = target + '.swap-recovery/prepared.json';
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
    journal.pid = process.pid;
    fs.writeFileSync(journalPath, JSON.stringify(journal));
    const recovery = recoverSqliteSwapArtifacts(target);
    if (recovery.status === 'HOLD') { console.log(JSON.stringify({ status: 'HOLD' })); process.exit(3); }
    const db = new Database(target, { fileMustExist: true });
    try {
        const rows = db.prepare('SELECT * FROM synthetic_recovery').all();
        if (recovery.status === 'RECOVERED') recovery.complete();
        console.log(JSON.stringify({ status: recovery.status, rows }));
    } finally { db.close(); }
`;

test('crash dello swap e riavvio con lo stesso PID: il recupero ripristina l\'originale invece di restare in HOLD', () => {
    const dir = fs.mkdtempSync(path.join(process.env.MEDIFLOW_DATA_DIR!, 'swap-pid-reuse-'));
    try {
        fixture(path.join(dir, 'medical.db'), 'synthetic-original-A');
        fixture(path.join(dir, 'replacement.db'), 'synthetic-replacement-B');
        assert.equal(worker(dir, crashScript).status, 86);
        const result = worker(dir, samePidRecoveryScript);
        assert.equal(result.status, 0, `recupero: ${result.stdout.trim()} ${result.stderr.trim()}`);
        const recovered = JSON.parse(result.stdout.trim());
        assert.equal(recovered.status, 'RECOVERED');
        assert.equal(recovered.rows[0].value, 'synthetic-original-A');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
