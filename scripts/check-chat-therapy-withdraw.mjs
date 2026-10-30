import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
const output = mkdtempSync(join(tmpdir(), 'mf-chat-withdraw-'));
console.log(`Evidence: ${output}`);
for (const scenario of (process.env.MEDIFLOW_CHAT_WITHDRAW_ONLY ? [process.env.MEDIFLOW_CHAT_WITHDRAW_ONLY] : ['before-commit', 'unavailable', 'after-commit'])) {
    const dir = join(output, scenario); mkdirSync(dir);
    const env = { ...process.env, MEDIFLOW_DATA_DIR: dir, MEDIFLOW_CHAT_WITHDRAW_SCENARIO: scenario,
        REVIEW_CONFIG: join(dir, 'config.json'), REVIEW_PIN_BARRIER: join(dir, 'pin-pending'),
        REVIEW_PIN_RELEASE: join(dir, 'pin-release'), REVIEW_REVOKE_RESULT: join(dir, 'revoke.json'), REVIEW_RESULT: join(dir, 'effects.json') };
    const hostLog = openSync(join(dir, 'host.log'), 'wx');
    const host = spawn(process.execPath, ['--import', './scripts/register-strip-types-loader.mjs', 'scripts/chat-therapy-withdraw-host.ts'], { env, stdio: ['ignore', hostLog, hostLog] });
    const hostExit = once(host, 'exit');
    try {
        const deadline = Date.now() + 20000;
        while (!existsSync(env.REVIEW_CONFIG)) { assert.equal(host.exitCode, null, 'host failed'); assert.ok(Date.now() < deadline, 'host timeout'); await delay(25); }
        const log = openSync(join(dir, 'rust.log'), 'wx');
        try {
            const rust = spawn(process.env.CARGO ?? `${process.env.HOME}/.cargo/bin/cargo`, ['test', '--manifest-path', 'experiments/gpui-patient-pilot/Cargo.toml', '-p', 'mediflow-gpui-patient-pilot', '--features', 'gpui_platform/runtime_shaders', '--locked', 'real_route_withdraw_during_pin', '--', '--ignored', '--nocapture'], { env, stdio: ['ignore', log, log] });
            const [code] = await once(rust, 'exit');
            assert.equal(code, 0, `${scenario}: see ${dir}/rust.log`);
        } finally { closeSync(log); }
        console.log(`${scenario}: PASS`);
    } finally { host.kill('SIGTERM'); await hostExit; closeSync(hostLog); }
}
