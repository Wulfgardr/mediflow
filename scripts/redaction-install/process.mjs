/* @Codex — bounded child lifecycle and installer-local Mac network denial. */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { InstallError, demand, exactKeys, equal, record, strictJson } from './guards.mjs';

const INSPECT = fileURLToPath(new URL('./inspect_runtime.py', import.meta.url));
export const SMOKE_TEXT = 'SYNTHETIC INSTALLER CHECK: Mario Rossi, Milano. Nessun dato clinico.';
const LABELS = new Set(['person', 'full_name', 'date_of_birth', 'email', 'phone_number', 'address', 'street_address', 'city', 'state_or_region', 'postal_code', 'government_id', 'national_id_number', 'tax_id', 'sensitive_account_id', 'sensitive_date', 'document_date']);
export function safeEnvironment(work) {
  // No inherited PYTHONPATH, pip config, token, proxy, virtualenv, cache or HOME.
  return {
    PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8',
    HOME: work, TMPDIR: work, XDG_CACHE_HOME: work,
    PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1',
    PIP_CONFIG_FILE: '/dev/null', PIP_NO_INDEX: '1', PIP_NO_CACHE_DIR: '1',
    PIP_DISABLE_PIP_VERSION_CHECK: '1', PIP_NO_INPUT: '1',
    HF_HOME: work, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1',
    HF_HUB_DISABLE_IMPLICIT_TOKEN: '1', HF_HUB_DISABLE_TELEMETRY: '1', TOKENIZERS_PARALLELISM: 'false',
  };
}
export function sandboxArguments(python, args, writable) {
  // This does not alter the app's C2/runner sandbox or its policies. The extra
  // write restriction applies ONLY to provisioning subprocesses.
  const literal = value => JSON.stringify(value);
  const policy = '(version 1)(allow default)(deny network*)(deny file-write*)'
    + '(allow file-write* (literal "/dev/null")'
    + (writable ? ` (subpath ${literal(writable)})` : '') + ')';
  return ['-p', policy, python, ...args];
}

/** Tests inject only a process launcher in code. There is no CLI/env bypass. */
export function createProcessAdapter(launch) {
  function run({ python, args, input = '', work, writable, phase, signal, timeout = 180_000, exchange }) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new InstallError('interrupted', phase));
      let child, failure, timer, killTimer, stdout = Buffer.alloc(0), response, lineCount = 0;
      const fail = code => {
        failure ??= new InstallError(code, phase);
        if (!child?.pid) return;
        try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
        killTimer ??= setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } }, 500);
      };
      const abort = () => fail('interrupted');
      try { child = launch({ python, args, work, writable, env: safeEnvironment(work) }); }
      catch { reject(new InstallError('process_start_failed', phase)); return; }
      timer = setTimeout(() => fail('process_timeout'), timeout);
      signal?.addEventListener('abort', abort, { once: true });
      child.on('error', () => { failure ??= new InstallError('process_start_failed', phase); });
      child.stdin.on('error', () => { fail('process_input_failed'); });
      child.stderr.resume(); // Do not retain potentially sensitive library diagnostics.
      child.stdout.on('data', chunk => {
        if (failure) return;
        stdout = Buffer.concat([stdout, chunk]);
        if (stdout.length > 1024 * 1024) return fail('process_output_limit');
        if (exchange) {
          for (;;) {
            const nl = stdout.indexOf(10); if (nl < 0) break;
            const line = stdout.subarray(0, nl); stdout = stdout.subarray(nl + 1);
            try {
              const message = strictJson(line.toString('utf8'));
              lineCount++;
              if (lineCount === 1) { exchange.greeting(message); child.stdin.write(exchange.request + '\n'); }
              else if (lineCount === 2) { response = exchange.response(message); child.stdin.end(); }
              else fail('worker_protocol_invalid');
            } catch { fail('worker_protocol_invalid'); }
          }
        }
      });
      child.once('close', async (code, exitSignal) => {
        clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', abort);
        // A successful leader is not sufficient if a subprocess remains alive.
        // Kill the whole owned group before allowing rollback or publication.
        let groupPresent = false;
        if (child.pid) {
          try { process.kill(-child.pid, 0); groupPresent = true; } catch { /* gone */ }
        }
        if (groupPresent) {
          failure ??= new InstallError('process_descendants_remaining', phase);
          try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
          // The primary is reaped above. A killed descendant may remain a zombie
          // under another reaper; it cannot execute or mutate staging.
          await new Promise(done => setTimeout(done, 50));
        }
        if (failure) return reject(failure);
        if (code !== 0 || exitSignal) return reject(new InstallError('process_failed', phase));
        if (exchange && (lineCount !== 2 || stdout.length !== 0)) return reject(new InstallError('worker_protocol_invalid', phase));
        resolve(exchange ? response : stdout.toString('utf8'));
      });
      if (!exchange) child.stdin.end(input);
      if (signal?.aborted) abort();
    });
  }
  const inspect = async (mode, context, payload) => {
    const output = await run({ ...context, args: ['-I', '-B', INSPECT, mode], input: payload ? JSON.stringify(payload) : '' });
    try { const result = strictJson(output); demand(record(result) && !Object.hasOwn(result, 'error'), 'inspection_failed', context.phase); return result; }
    catch { throw new InstallError('inspection_failed', context.phase); }
  };
  const runModule = (name, args, context) => run({ ...context,
    args: ['-I', '-B', '-c', 'import os,runpy,sys; os.umask(0o077); name=sys.argv.pop(1); runpy.run_module(name,run_name="__main__",alter_sys=True)', name, ...args] });
  return Object.freeze({
    inspect, module: runModule,
    // Execute the explicitly hashed local pip wheel, not ensurepip or a user cache.
    pip: (wheel, args, context) => run({ ...context,
      args: ['-I', '-B', '-c', 'import os,runpy,sys; os.umask(0o077); sys.path.insert(0,sys.argv.pop(1)); runpy.run_module("pip",run_name="__main__",alter_sys=True)', wheel, ...args] }),
    entryPoint: (executable, args, context) => run({ ...context, python: executable, args }),
    async smoke(context, identity, worker, model) {
      await run({ ...context, args: ['-I', '-B', worker, model], exchange: {
        greeting(message) {
          exactKeys(message, ['ready', 'runtimeIdentity'], 'worker_observation_missing');
          demand(message.ready === identity.revision && equal(message.runtimeIdentity, identity), 'worker_observation_mismatch');
        },
        request: JSON.stringify({ id: 1, text: SMOKE_TEXT }),
        response(message) {
          exactKeys(message, ['id', 'entities'], 'worker_response_invalid');
          demand(message.id === 1 && record(message.entities), 'worker_response_invalid');
          const points = Array.from(SMOKE_TEXT); let count = 0;
          for (const [label, entries] of Object.entries(message.entities)) {
            demand(LABELS.has(label) && Array.isArray(entries), 'worker_response_invalid');
            for (const e of entries) {
              demand(record(e) && Number.isInteger(e.start) && Number.isInteger(e.end) && e.start >= 0 && e.end > e.start
                && e.end <= points.length && typeof e.confidence === 'number' && Number.isFinite(e.confidence)
                && e.confidence >= 0 && e.confidence <= 1 && points.slice(e.start, e.end).join('') === e.text && ++count <= 512,
              'worker_response_invalid');
            }
          }
          return { technicalSmoke: 'passed', qualification: 'not_assessed' };
        },
      } });
    },
  });
}
export function createMacAdapter() {
  demand(process.platform === 'darwin', 'macos_required');
  demand(fs.existsSync('/usr/bin/sandbox-exec'), 'mac_sandbox_required');
  return createProcessAdapter(({ python, args, work, writable, env }) => spawn('/usr/bin/sandbox-exec', sandboxArguments(python, args, writable), {
    cwd: work, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
  }));
}
export function pipArguments(slot, mode) {
  demand(mode === 'plan' || mode === 'install', 'pip_mode_invalid');
  return ['--isolated', '--disable-pip-version-check', '--no-cache-dir', '--no-input',
    'install', '--no-index', '--find-links', path.join(slot, 'wheels'), '--require-hashes', '--only-binary=:all:',
    '--no-build-isolation', '--no-compile', '--progress-bar', 'off',
    ...(mode === 'plan' ? ['--dry-run', '--ignore-installed'] : ['--force-reinstall']),
    '--report', path.join(slot, 'work', `${mode}.json`), '-r', path.join(slot, 'requirements.lock')];
}
