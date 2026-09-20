/* @Codex WUL-676: fresh synthetic data by default, no private environment copy. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';

const root = fileURLToPath(new URL('../../', import.meta.url));
if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Use Node 24.x');
if (fs.readdirSync(root).some(name => /^\.env(?:\.(?:local|development|production)(?:\.local)?)?$/.test(name))) {
    throw new Error('This prototype requires a worktree without private .env files.');
}
const onboarding = process.argv.includes('--onboarding');
const args = process.argv.slice(2).filter(arg => arg !== '--onboarding');
const port = Number(args[0] || 3291);
if (!Number.isInteger(port) || port < 3200 || port >= 3400) throw new Error('Choose a prototype port between 3200 and 3399.');
const dataDir = args[1] ? path.resolve(args[1]) : fs.mkdtempSync(path.join(os.tmpdir(), 'mf086-'));
const marker = path.join(dataDir, 'SYNTHETIC-PROTOTYPE');
if (args[1] && !fs.existsSync(marker)) throw new Error('Refusing an unmarked data directory. Omit it to create a fresh fixture.');
if (!args[1]) fs.writeFileSync(marker, 'MediFlow 0.8.6 synthetic prototype only\n', { mode: 0o600 });
// First setup needs the canonical schema but no operator. Apply the same SQL
// migration files as prepare-e2e-db, only to a brand-new marked directory.
if (onboarding && !fs.existsSync(path.join(dataDir, 'medical.db'))) {
    const database = new Database(path.join(dataDir, 'medical.db'));
    try {
        database.pragma('foreign_keys = OFF');
        const migrations = path.join(root, 'drizzle');
        for (const name of fs.readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) {
            database.exec(fs.readFileSync(path.join(migrations, name), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gm, ''));
        }
    } finally { database.close(); }
}
const env = Object.fromEntries(['HOME', 'USER', 'TMPDIR', 'LANG', 'LC_ALL'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
Object.assign(env, { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
    MEDIFLOW_DATA_DIR: dataDir, NEXT_TELEMETRY_DISABLED: '1', MEDIFLOW_RUNTIME_TWIN: '1',
    ...(onboarding ? { MEDIFLOW_NEXT_DIST_DIR: '.next-twin-onboarding' } : {}),
});
if (!onboarding && !fs.existsSync(path.join(dataDir, 'medical.db'))) {
    const setup = spawnSync(process.execPath, ['scripts/prepare-e2e-db.mjs'], { cwd: root, stdio: 'inherit', env: {
        ...env, MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1', E2E_USERNAME: 'demo086', E2E_PASSWORD: '086086',
        E2E_PIN: '086086', E2E_DISPLAY_NAME: 'Medico Demo · sintetico', E2E_AMBULATORY_NAME: 'Ambulatorio dimostrativo 0.8.6',
    } });
    if (setup.status !== 0) throw new Error('Synthetic setup failed');
}
fs.mkdirSync(path.join(root, 'tmp-086-twin'), { recursive: true });
fs.writeFileSync(path.join(root, `tmp-086-twin/${onboarding ? 'onboarding' : 'runtime'}.json`), JSON.stringify({ dataDir, port, synthetic: true }, null, 2), { mode: 0o600 });
console.log(`Synthetic twin: http://127.0.0.1:${port} | ${onboarding ? 'First setup' : 'PIN 086086'} | data ${dataDir}`);
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: root, env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => { process.exitCode = code ?? 0; });
