/* @Codex: synthetic engine matrix, NOT clean-install/NTFS/runtime evidence. Never invokes Docker. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, copyFileSync, appendFileSync, unlinkSync, existsSync, mkdirSync, rmSync, realpathSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { onboardWho, readReleaseLock, friendlySetupMessage } from './who-local-onboarding.mjs';
import { sha256 } from './who-local-qualification.mjs';
import { readWhoProbe, PROBE_TERMS } from './who-local-probe.mjs';
import { EXEC_HTTP_PROGRAM, EXEC_PREREQUISITE_PROGRAM, EXEC_NC_HELP_PROGRAM, EXEC_DEADLINE_PROGRAM, EXEC_PREREQUISITE, execProgramArgs } from './who-local-loopback.mjs';

const id = letter => letter.repeat(64);
const isExecProgram = (args, program) => {
    const offset = args.indexOf('exec'), cid = args[offset + 6];
    if (offset < 0 || !/^[a-f0-9]{64}$/u.test(cid ?? '')) return false;
    const expected = execProgramArgs(cid, program);
    return args.length - offset === expected.length && expected.every((arg, i) => args[offset + i] === arg);
};
const lock = readReleaseLock();
function sandbox(t) {
    assert.ok(process.env.MEDIFLOW_DATA_DIR, 'Set an explicit synthetic MEDIFLOW_DATA_DIR before running tests');
    mkdirSync(process.env.MEDIFLOW_DATA_DIR, { recursive: true, mode: 0o700 });
    const directory = mkdtempSync(path.join(realpathSync(process.env.MEDIFLOW_DATA_DIR), "WHO path with spaces O'Brien-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    return directory;
}
function fakeDocker(options = {}) {
    // Explicit synthetic protocol adapter. It neither invokes Docker nor qualifies WHO.
    const target = readReleaseLock(`linux/${options.engineArch ?? 'arm64'}`);
    const calls = [], requests = [], containers = new Map(), networks = new Map(), payloads = new Map();
    const sourceFiles = new Map(lock.datasetFiles.map((name, i) => [name, Buffer.from(`Synthetic ${target.platform} dataset ${i}: no WHO data or patient data\n`)]));
    let owner, creates = 0, networkCreates = 0, starts = 0;
    const run = args => {
        calls.push(args); options.onCall?.(args);
        const fault = options.fail?.(args);
        if (fault) throw fault instanceof Error ? fault : Object.assign(new Error('DO_NOT_PRINT_SYNTHETIC_SECRET'), { code: 'docker_unavailable' });
        if (args[0] === 'context' && args[1] === 'ls') return 'synthetic-context';
        if (args[0] === 'context' && args[1] === 'inspect') return options.endpoint ?? 'unix:///synthetic/docker.sock';
        assert.deepEqual(args.slice(0, 2), ['--context', 'synthetic-context']);
        const a = args.slice(2);
        if (a[0] === 'info') return JSON.stringify({ os: 'linux', arch: options.engineArch ?? 'arm64', id: options.daemonId ?? 'synthetic-daemon-0001' });
        if (a[0] === 'version') return options.serverVersion ?? '29.7.2';
        if (a[0] === 'image' && a[1] === 'pull') return '';
        if (a[0] === 'image' && a[1] === 'inspect') return JSON.stringify({ digests: options.digests ?? [`whoicd/icd-api@${target.imageDigest}`], os: 'linux', arch: options.engineArch ?? 'arm64' });
        if (a[0] === 'container' && a[1] === 'ls') {
            const filter = a[a.indexOf('--filter') + 1];
            return [...containers.values()].filter(c => filter === `name=^/${c.name}$`).map(c => c.name).join('\n');
        }
        if (a[0] === 'container' && a[1] === 'create') {
            const cid = creates === 0 ? id('a') : creates === 1 ? id('b') : sha256(`synthetic-container-${creates}`).slice(7);
            creates++;
            owner = a[a.indexOf('--label') + 1].split('=')[1];
            const network = a[a.indexOf('--network') + 1];
            const n = [...networks.values()].find(n => n.name === network);
            const publish = a.includes('--publish') ? a[a.indexOf('--publish') + 1] : undefined;
            const port = cid === id('a') ? '8382' : String(18000 + creates);
            containers.set(cid, { id: cid, name: a[a.indexOf('--name') + 1], owner, running: false, pid: 0, status: 'created', exitCode: 0, oomKilled: false, runtimeError: false, finishedAt: '0001-01-01T00:00:00Z',
                startedAt: '0001-01-01T00:00:00Z', restartCount: 0,
                ports: publish ? { '80/tcp': [{ HostIp: '127.0.0.1', HostPort: port }] } : {},
                requestedPorts: publish ? { '80/tcp': [{ HostIp: '127.0.0.1', HostPort: cid === id('a') ? '8382' : '' }] } : {},
                networks: { [network]: { NetworkID: network === 'bridge' && options.bridgeIdAssignedOnStart ? '' : network === 'bridge' ? id('d') : n?.id ?? id('c') } } });
            payloads.set(cid, cid === id('a') ? new Map(sourceFiles) : new Map()); return cid;
        }
        if (a[0] === 'container' && a[1] === 'inspect') {
            const c = containers.get(a[2]) ?? [...containers.values()].find(c => c.name === a[2]);
            if (!c) throw Object.assign(new Error('absent'), { code: 'docker_unavailable' });
            if (a.at(-1).includes('Config.Labels')) return JSON.stringify({ ...c,
                ports: options.noInternalPorts && !c.networks.bridge ? { '80/tcp': null } : c.ports,
                requestedPorts: options.legacyRequest && !c.networks.bridge && c.id === id('a')
                    ? { '80/tcp': [{ HostIp: '127.0.0.1', HostPort: '8382' }] } : c.requestedPorts,
                owner: options.wrongOwner ? 'different-installation' : c.owner,
                image: `whoicd/icd-api@${target.imageDigest}`, mounts: 0, privileged: false, capAdd: options.capAdd ?? null, restart: 'no' });
            return JSON.stringify({ running: c.running, status: c.running ? 'running' : 'exited', imageId: `sha256:${id('e')}`,
                ports: c.ports, mountCount: 0, privileged: false, network: 'bridge', restart: 'no' });
        }
        if (a[0] === 'container' && ['start', 'stop'].includes(a[1])) {
            const c = containers.get(a.at(-1)); c.running = a[1] === 'start';
            if (c.running) {
                starts++; c.startedAt = new Date(Date.parse('2026-09-08T00:00:00Z') + starts * 1000).toISOString(); c.pid = 100 + starts;
                if (options.bridgeIdAssignedOnStart && c.networks.bridge?.NetworkID === '') c.networks.bridge.NetworkID = id('d');
            }
            else c.pid = 0;
            c.status = c.running ? 'running' : 'exited'; c.exitCode = 0;
            c.finishedAt = c.running ? '0001-01-01T00:00:00Z' : '2026-09-08T02:00:00.000Z';
            return a.at(-1);
        }
        if (a[0] === 'network' && a[1] === 'ls') {
            const filter = a[a.indexOf('--filter') + 1];
            return [...networks.values()].filter(n => filter === `name=^${n.name}$`).map(n => n.id).join('\n');
        }
        if (a[0] === 'network' && a[1] === 'create') {
            const nid = networkCreates++ === 0 ? id('c') : sha256(`synthetic-network-${networkCreates}`).slice(7);
            const opts = {};
            for (let i = 0; i < a.length; i++) if (a[i] === '--opt') { const [key, value] = a[i + 1].split('='); opts[key] = value; }
            networks.set(nid, { id: nid, name: a.at(-1), internal: a.includes('--internal'), ipv6: false, owner,
                driver: 'bridge', scope: 'local', options: opts }); return nid;
        }
        if (a[0] === 'network' && a[1] === 'inspect') {
            const n = networks.get(a[2]); assert.ok(n, 'inspect only the registered synthetic network');
            const members = Object.fromEntries([...containers.values()].filter(c => c.running && Object.values(c.networks).some(x => x.NetworkID === n.id)).map(c => [c.id, {}]));
            if (options.foreignNetworkMember) members[id('f')] = {};
            return JSON.stringify({ ...n, internal: options.nonInternal ? false : n.internal, containers: members });
        }
        if (a[0] === 'network' && a[1] === 'disconnect') {
            const c = containers.get(a[3]); assert.equal(c.running, true);
            for (const [key, network] of Object.entries(c.networks)) if (key === a[2] || network.NetworkID === a[2]) delete c.networks[key];
            return '';
        }
        if (a[0] === 'network' && a[1] === 'connect') {
            const n = networks.get(a[2]);
            containers.get(a[3]).networks[n?.name ?? a[2]] = { NetworkID: a[2] === 'bridge' ? id('d') : n?.id ?? a[2] }; return '';
        }
        if (a[0] === 'cp') {
            if (a[1].includes(':/tmp/')) {
                const [cid, file] = a[1].split(':/tmp/'); writeFileSync(a[2], payloads.get(cid).get(file), { mode: 0o644 }); chmodSync(a[2], 0o644);
            } else { const [cid, file] = a[2].split(':/tmp/'); payloads.get(cid).set(file, readFileSync(a[1])); }
            return '';
        }
        if (a[0] === 'exec') {
            const cid = a[1], command = a[2];
            // Missing in the observed image. No positive curl/wget/python response fixture.
            if (command === 'curl') throw Object.assign(new Error('docker_executable_missing'), { code: 'docker_executable_missing', exitCode: 127, details: { code: 'docker_executable_missing', exitCode: 127, executable: 'curl' } });
            if (command === 'stat') { const bytes = payloads.get(cid).get(path.basename(a.at(-1))).length; return `0 0 644 ${bytes} regular file`; }
            if (command === 'sha256sum') return `${(options.corruptRestore && cid !== id('a')) || (options.corruptOriginal && cid === id('a')) ? id('f') : sha256(payloads.get(cid).get(path.basename(a.at(-1)))).slice(7)}  ${a.at(-1)}`;
            if (['chown', 'chmod'].includes(command)) { assert.notEqual(cid, id('a')); return ''; }
            if (command === 'cat' && a.at(-1) === '/proc/net/ipv6_route') return options.ipv6Routes ?? '';
            if (command === 'cat' && a.at(-1) === '/proc/net/route') return `Iface Destination Gateway Flags RefCnt Use Metric Mask\neth0 ${options.defaultRoute ? '00000000' : '000012AC'} 00000000 0001 0 0 0 ${options.defaultRoute ? '00000000' : '0000FFFF'}\n`;
        }
        throw new Error(`Unexpected fake Docker operation: ${a[0]} ${a[1]}`);
    };
    const request = async (port, kind, signal) => {
        requests.push({ port, kind }); options.onRequest?.({ port, kind, signal });
        if (options.requestError) throw options.requestError;
        if (options.macAccess) return readWhoProbe(port, kind, signal);
        const cid = [...containers.values()].find(c => c.running && c.ports['80/tcp']?.[0]?.HostPort === String(port))?.id;
        assert.ok(cid, 'request bound to a synthetic running container');
        assert.equal(kind === 'restored' ? cid !== id('a') : cid === id('a'), true);
        const ordinal = ['acquisition', 'offline_restart', 'restored', 'original_recovered'].indexOf(kind); assert.notEqual(ordinal, -1);
        return JSON.stringify(options.invalidResponse ? {} : { destinationEntities: [{ id: `http://id.who.int/icd/release/11/2026-01/mms/${1000000001 + ordinal}`,
            title: `Synthetic ${kind} fixture, not WHO evidence`, theCode: 'AA00' }] });
    };
    // The real Node listener exchanges bounded HTTP over local sockets. ONLY this Docker
    // adapter is synthetic; it executes no Docker process and proves no WHO/Mac runtime.
    const execCalls = [];
    const execDocker = async (args, operation = {}) => {
        execCalls.push(args);
        if (args[0] === 'context') return Buffer.from(run(args));
        assert.deepEqual(args.slice(0, 2), ['--host', options.endpoint ?? 'unix:///synthetic/docker.sock']);
        if (!args.includes('/bin/busybox')) return Buffer.from(run(['--context', 'synthetic-context', ...args.slice(2)]));
        options.onExec?.(args, operation);
        if (options.execError) throw options.execError;
        const cid = args[args.indexOf('/bin/busybox') - 1];
        assert.ok(containers.get(cid)?.running, 'EXEC bound to the exact running synthetic container');
        if (isExecProgram(args, EXEC_PREREQUISITE_PROGRAM)) {
            assert.equal(operation.input.toString(), `${EXEC_PREREQUISITE}\n`);
            return Buffer.from(`${EXEC_PREREQUISITE}\n`);
        }
        // Synthetic adapters exercise composition, NOT real applet or deadline evidence.
        if (isExecProgram(args, EXEC_NC_HELP_PROGRAM)) return Buffer.from(`${EXEC_PREREQUISITE}:nc-help\n`);
        if (isExecProgram(args, EXEC_DEADLINE_PROGRAM)) return Buffer.from(`${EXEC_PREREQUISITE}:deadline\n`);
        assert.equal(isExecProgram(args, EXEC_HTTP_PROGRAM), true);
        const raw = operation.input.toString('ascii');
        const requestPath = /^GET (\S+) HTTP\/1\.1\r\n/u.exec(raw)?.[1];
        assert.ok(requestPath, 'HTTP request travels on stdin, not in command arguments');
        const query = new URL(requestPath, 'http://127.0.0.1').searchParams.get('q');
        const kind = Object.entries(PROBE_TERMS).find(([, q]) => query === q)?.[0];
        const ordinal = ['acquisition', 'offline_restart', 'restored', 'original_recovered'].indexOf(kind);
        assert.notEqual(ordinal, -1, 'fixture only recognizes the fixed public qualification searches');
        assert.equal(kind === 'restored' ? cid !== id('a') : cid === id('a'), true);
        const body = JSON.stringify(options.invalidResponse ? {} : { destinationEntities: [{
            id: `http://id.who.int/icd/release/11/2026-01/mms/${1000000001 + ordinal}`,
            title: `Synthetic ${kind} fixture, not WHO evidence`, theCode: 'AA00' }] });
        return Buffer.from(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
    };
    return { calls, requests, containers, networks, payloads, run, request, execDocker, execCalls, options };
}

test('new macOS container reads its default bridge identity after start before offline connect', async t => {
    // @Codex: real Docker reports an empty NetworkID until the freshly created container starts.
    const f = fixture(t, 'darwin', { bridgeIdAssignedOnStart: true }, 'arm64');
    const result = await onboardWho('setup', f.deps);
    assert.equal(result.state, 'ready');
    assert.equal(read(f, 'installation.json').qualificationAttempt.complete, true);
    assert.equal(f.docker.containers.get(id('a')).networks.bridge, undefined);
    assert.equal(f.docker.containers.get(id('a')).networks[read(f, 'installation.json').offlineNetwork.name].NetworkID, id('c'));
});

test('bridge identity drift after the pre-connect read is rejected', async t => {
    const f = fixture(t, 'darwin', { bridgeIdAssignedOnStart: true }, 'arm64');
    f.options.onCall = args => {
        if (args[2] === 'network' && args[3] === 'connect') f.docker.containers.get(id('a')).networks.bridge.NetworkID = id('e');
    };
    await assert.rejects(onboardWho('setup', f.deps), { code: 'original_network_mismatch' });
    disabled(f);
    assert.equal(f.docker.calls.some(args => args[2] === 'network' && args[3] === 'disconnect'), false);
});
function fixture(t, platform = 'linux', options = {}, arch = 'x64') {
    const directory = sandbox(t);
    options.endpoint ??= platform === 'win32' ? 'npipe:////./pipe/dockerDesktopLinuxEngine' : 'unix:///synthetic/docker.sock';
    options.macAccess = platform === 'darwin';
    const docker = fakeDocker(options), prompts = [], reports = [];
    const deps = { directory, run: docker.run, request: docker.request, execDocker: docker.execDocker, host: { platform, arch }, portFree: async () => {}, wait: async () => {},
        now: () => '2026-09-08T00:00:00.000Z',
        ask: async prompt => { prompts.push(prompt); return prompt.includes('ACCETTO') ? 'ACCETTO' : prompt.includes('Riprendere') ? 's' : 'n'; },
        report: line => reports.push(line) };
    return { directory, docker, prompts, reports, deps, options };
}
const read = (f, name) => JSON.parse(readFileSync(path.join(f.directory, name), 'utf8'));
const save = (f, name, value) => writeFileSync(path.join(f.directory, name), JSON.stringify(value), { mode: 0o600 });
const mutations = calls => calls.filter(a => a.includes('pull') || a.includes('create') || a.includes('start') || a.includes('stop') || a.includes('cp') || a.includes('disconnect') || a.includes('connect'));
const disabled = f => assert.doesNotMatch(existsSync(path.join(f.directory, 'who.env')) ? readFileSync(path.join(f.directory, 'who.env'), 'utf8') : '', /MEDIFLOW_ICD_WHO_ENABLED=1/u);

for (const platform of ['darwin', 'linux', 'win32']) for (const arch of ['x64', 'arm64']) for (const engineArch of ['arm64', 'amd64']) {
    test(`synthetic onboarding ${platform}/${arch}, Linux ${engineArch} (host filesystem is the test runner OS)`, async t => {
        const f = fixture(t, platform, { engineArch }, arch);
        const result = await onboardWho('setup', f.deps);
        assert.equal(result.state, 'ready');
        const state = read(f, 'installation.json'), manifest = read(f, 'manifest.json');
        assert.equal(state.engineBinding.hostPlatform, platform); assert.equal(state.engineBinding.hostArch, arch);
        assert.equal(state.platform, `linux/${engineArch}`); assert.equal(state.qualificationAttempt.complete, true);
        const target = readReleaseLock(state.platform);
        assert.equal(manifest.image.digest, target.imageDigest);
        assert.equal(manifest.image.registryEvidenceSha256, target.registryEvidenceSha256);
        const pulls = f.docker.calls.filter(a => a[2] === 'image' && a[3] === 'pull');
        assert.equal(pulls.length, 1);
        assert.equal(pulls[0][pulls[0].indexOf('--platform') + 1], state.platform);
        assert.equal(pulls[0].at(-1), `${target.repository}@${target.imageDigest}`);
        assert.ok(f.prompts.some(prompt => prompt.includes('ACCETTO')));
        for (const a of f.docker.calls.filter(a => a[2] === 'container' && a[3] === 'create')) {
            assert.equal(a[a.indexOf('--platform') + 1], state.platform);
            assert.equal(a.at(-1), `${target.repository}@${target.imageDigest}`);
        }
        assert.deepEqual(state.qualificationAttempt.engineBinding, state.engineBinding);
        assert.equal(manifest.dataset.offlineRestartVerified, true); assert.equal(manifest.dataset.restoreVerified, true);
        assert.equal(state.qualificationAttempt.snapshot.fileCount, 5);
        assert.equal(manifest.dataset.snapshotInventorySha256, sha256(readFileSync(path.join(f.directory, state.qualificationAttempt.snapshot.directory, 'inventory.json'))));
        assert.match(result.launcher, platform === 'win32' ? /\.ps1$/u : platform === 'darwin' ? /\.command$/u : /\.sh$/u);
        const text = readFileSync(result.launcher, 'utf8'); assert.match(text, /Setup_WHO\.(command|sh|ps1)/u); assert.match(text, /start/u);
        assert.match(result.message, /non significa nuova risposta/u);
        assert.equal(f.reports.some(x => x.includes('Download immagine')), true);
        assert.equal(f.reports.some(x => x.includes('Qualifica in corso')), true);
        const corrections = f.docker.calls.filter(a => a.includes('chown') || a.includes('chmod'));
        // @Codex: Docker Desktop preserves host metadata on both Mac and Windows copies.
        assert.equal(corrections.length, ['win32', 'darwin'].includes(platform) ? 10 : 0);
        for (const a of corrections) assert.equal(a[3], id('b'));
        f.docker.calls.length = 0;
        const status = await onboardWho('status', f.deps);
        assert.equal(status.state, platform === 'darwin' ? 'qualified' : 'ready'); assert.match(status.message, /non esegue una ricerca/u);
        assert.equal(mutations(f.docker.calls).length, 0);
    });
}

test('missing and remote Docker give bounded OS-specific prerequisites without consent or mutation', async t => {
    for (const platform of ['darwin', 'linux', 'win32']) {
        const f = fixture(t, platform); f.deps.run = () => { throw new Error('synthetic raw diagnostic not for display'); };
        await assert.rejects(onboardWho('setup', f.deps), e => e.code === 'docker_unavailable' && !friendlySetupMessage(e, platform).includes('raw diagnostic'));
        assert.match(friendlySetupMessage({ code: 'docker_unavailable' }, platform), new RegExp(platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : 'Linux', 'u'));
        assert.equal(f.prompts.length, 0); disabled(f);
        const remote = fixture(t, platform, { endpoint: 'tcp://127.0.0.1:2375' });
        await assert.rejects(onboardWho('setup', remote.deps), { code: 'local_context_required' });
        assert.equal(mutations(remote.docker.calls).length, 0); assert.equal(remote.prompts.length, 0);
    }
});

test('interrupted image pull preserves explicit consent and resumes with a new gesture, no fallback image', async t => {
    const f = fixture(t, 'linux', { fail: a => a.includes('pull') });
    await assert.rejects(onboardWho('setup', f.deps), { code: 'pull_failed' });
    const state = read(f, 'installation.json'), license = read(f, 'license.json');
    assert.equal(state.phase, 'prepared'); assert.equal(state.containerId, undefined); disabled(f);
    assert.equal(existsSync(path.join(f.directory, '.setup-active')), false);
    f.options.fail = undefined;
    assert.equal((await onboardWho('setup', f.deps)).state, 'ready');
    assert.equal(read(f, 'installation.json').installationId, state.installationId);
    assert.deepEqual(read(f, 'license.json'), license);
    assert.equal(f.prompts.filter(x => x.includes('ACCETTO')).length, 1);
    assert.equal(f.prompts.filter(x => x.includes('Riprendere')).length, 1);
    const pulls = f.docker.calls.filter(a => a.includes('pull')); assert.equal(pulls.length, 2);
    for (const a of pulls) assert.equal(a.at(-1), `whoicd/icd-api@${lock.imageDigest}`);
});

test('cooperative cancellation after pull prevents create; explicit resume can qualify the same prepared installation', async t => {
    const controller = new AbortController(), f = fixture(t);
    f.deps.signal = controller.signal;
    f.options.onCall = a => { if (a.includes('pull')) controller.abort(); };
    await assert.rejects(onboardWho('setup', f.deps), { code: 'cancelled' });
    assert.equal(f.docker.calls.some(a => a.includes('create')), false); disabled(f);
    assert.equal(read(f, 'installation.json').phase, 'prepared');
    f.deps.signal = new AbortController().signal; f.options.onCall = undefined;
    assert.equal((await onboardWho('setup', f.deps)).state, 'ready');
});

test('cancel before consent creates neither license nor installation', async t => {
    const f = fixture(t), controller = new AbortController(); f.deps.signal = controller.signal;
    f.deps.ask = async () => { controller.abort(); return 'ACCETTO'; };
    await assert.rejects(onboardWho('setup', f.deps), { code: 'cancelled' });
    assert.equal(existsSync(path.join(f.directory, 'license.json')), false); assert.equal(mutations(f.docker.calls).length, 0);
});

test('cancel during snapshot preserves incomplete receipt and stops only the owned source before explicit retry', async t => {
    const f = fixture(t), controller = new AbortController(); f.deps.signal = controller.signal;
    f.options.onCall = a => { if (a.includes('cp')) controller.abort(); };
    await assert.rejects(onboardWho('setup', f.deps), { code: 'cancelled' }); disabled(f);
    const attempt = read(f, 'installation.json').qualificationAttempt;
    assert.equal(attempt.complete, false); assert.equal(attempt.failure, 'cancelled');
    assert.equal(attempt.originalStoppedOnFailure, true); assert.equal(attempt.originalRecovered, undefined); assert.equal(f.docker.containers.get(id('a')).running, false);
    const snapshots = readdirSync(f.directory).filter(n => n.startsWith('snapshot-')); assert.equal(snapshots.length, 1);
    f.deps.signal = new AbortController().signal; f.options.onCall = undefined;
    await onboardWho('setup', f.deps);
    assert.equal(read(f, 'installation.json').qualificationAttempt.complete, true);
    assert.equal(readdirSync(f.directory).filter(n => n.startsWith('snapshot-')).length, 2);
    assert.equal(existsSync(path.join(f.directory, snapshots[0], 'qualification.json')), true);
});

test('changed daemon after consent or before app launch invalidates authority without using the new target', async t => {
    const early = fixture(t), ask = early.deps.ask;
    early.deps.ask = async q => { const answer = await ask(q); early.options.daemonId = 'different-engine-0002'; return answer; };
    await assert.rejects(onboardWho('setup', early.deps), { code: 'engine_identity_changed' });
    assert.equal(mutations(early.docker.calls).length, 0); assert.equal(existsSync(path.join(early.directory, 'license.json')), false);
    const late = fixture(t); await onboardWho('setup', late.deps); late.docker.calls.length = 0;
    let launched = false; late.deps.launch = async () => { launched = true; };
    late.deps.appPortFree = async () => { late.options.daemonId = 'different-engine-0002'; };
    await assert.rejects(onboardWho('start', late.deps), { code: 'engine_identity_changed' });
    assert.equal(launched, false); assert.equal(mutations(late.docker.calls).length, 0); disabled(late);
    assert.equal(read(late, 'installation.json').qualificationAttempt.complete, true, 'old receipt preserved, not authority for new daemon');
});

test('changed persisted host or engine prevents reuse, status does not mutate old installation', async t => {
    for (const change of ['host', 'daemon', 'endpoint']) {
        const f = fixture(t); await onboardWho('setup', f.deps); f.docker.calls.length = 0;
        const before = readFileSync(path.join(f.directory, 'installation.json'));
        if (change === 'host') f.deps.host.arch = 'arm64';
        if (change === 'daemon') f.options.daemonId = 'replacement-engine-0002';
        if (change === 'endpoint') f.options.endpoint = 'unix:///another/docker.sock';
        await assert.rejects(onboardWho('status', f.deps), { code: 'engine_identity_changed' });
        assert.deepEqual(readFileSync(path.join(f.directory, 'installation.json')), before);
        assert.equal(mutations(f.docker.calls).length, 0);
    }
});

test('wrong/absent local image digest never yields enabled configuration despite valid catalog pin', async t => {
    for (const digests of [[], [`whoicd/icd-api@sha256:${id('f')}`]]) {
        const f = fixture(t, 'linux', { digests });
        await assert.rejects(onboardWho('setup', f.deps), { code: 'image_binding_mismatch' }); disabled(f);
        assert.equal(f.docker.calls.some(a => a.includes('create')), false);
        assert.equal(existsSync(path.join(f.directory, '.setup-active')), false);
    }
});

test('failed offline restart and failed restore preserve snapshots and no activation', async t => {
    for (const options of [{ onRequest: ({ kind }) => { if (kind === 'offline_restart') throw Object.assign(new Error('synthetic startup timeout'), { code: 'probe_timeout' }); } }, { corruptRestore: true }]) {
        const f = fixture(t, 'linux', options);
        await assert.rejects(onboardWho('setup', f.deps), e => ['dataset_not_ready', 'restore_hash_mismatch'].includes(e.code)); disabled(f);
        const attempt = read(f, 'installation.json').qualificationAttempt;
        assert.equal(attempt.complete, false); assert.equal(attempt.originalRecovered, undefined); assert.equal(attempt.originalStoppedOnFailure, true);
        assert.equal(existsSync(path.join(f.directory, attempt.snapshot.directory, 'inventory.json')), true);
        assert.equal(existsSync(path.join(f.directory, attempt.snapshot.directory, 'qualification.json')), true);
        assert.equal(f.docker.calls.some(a => a.includes('rm') || a.includes('prune')), false);
    }
});

test('occupied port and foreign service never trigger resource takeover', async t => {
    const occupied = fixture(t); occupied.deps.portFree = async () => { throw Object.assign(new Error('occupied'), { code: 'port_in_use' }); };
    await assert.rejects(onboardWho('setup', occupied.deps), { code: 'port_in_use' }); assert.equal(mutations(occupied.docker.calls).length, 0);
    const foreign = fixture(t); foreign.docker.containers.set(id('f'), { id: id('f'), name: 'mediflow-who-2026-01-guided' });
    await assert.rejects(onboardWho('setup', foreign.deps), { code: 'container_ownership_invalid' });
    assert.equal(mutations(foreign.docker.calls).length, 0); assert.equal(foreign.prompts.length, 0);
});

test('legacy v1 status remains read-only; start denied; confirmed migration requalifies and preserves old snapshot', async t => {
    const f = fixture(t, 'darwin', {}, 'arm64'); await onboardWho('setup', f.deps);
    const state = read(f, 'installation.json'), manifest = read(f, 'manifest.json');
    const oldSnapshot = state.qualificationAttempt.snapshot.directory;
    state.schemaVersion = 'mediflow.who-installation.v1'; delete state.engineBinding; delete state.platform;
    state.qualificationAttempt.schemaVersion = 'mediflow.who-owned-qualification.v1'; delete state.qualificationAttempt.engineBinding;
    manifest.schemaVersion = 'mediflow.who-local-sidecar.manifest.v1';
    save(f, 'installation.json', state); save(f, 'manifest.json', manifest); f.docker.calls.length = 0;
    assert.equal((await onboardWho('status', f.deps)).state, 'qualification_required'); assert.equal(mutations(f.docker.calls).length, 0);
    await assert.rejects(onboardWho('start', f.deps), { code: 'qualification_required' }); disabled(f);
    assert.equal((await onboardWho('qualify', f.deps)).state, 'ready');
    const migrated = read(f, 'installation.json'); assert.equal(migrated.schemaVersion, 'mediflow.who-installation.v2');
    assert.equal(migrated.containerId, state.containerId); assert.equal(migrated.qualificationAttempt.complete, true);
    assert.notEqual(migrated.qualificationAttempt.snapshot.directory, oldSnapshot);
    assert.equal(existsSync(path.join(f.directory, oldSnapshot, 'qualification.json')), true);
    assert.equal(f.docker.calls.some(a => a.includes('pull')), false);
});


test('cancel immediately after confirmed create records its exact ID for an owned resume without another original container', async t => {
    const f = fixture(t), controller = new AbortController(); f.deps.signal = controller.signal;
    f.options.onCall = a => { if (a.includes('container') && a.includes('create')) controller.abort(); };
    await assert.rejects(onboardWho('setup', f.deps), { code: 'cancelled' });
    const state = read(f, 'installation.json');
    assert.equal(state.containerId, id('a')); assert.equal(state.phase, 'created'); disabled(f);
    assert.equal(f.docker.containers.get(id('a')).running, false);
    f.deps.signal = new AbortController().signal; f.options.onCall = undefined; f.docker.calls.length = 0;
    assert.equal((await onboardWho('setup', f.deps)).state, 'ready');
    assert.equal(read(f, 'installation.json').containerId, id('a'));
    assert.equal(f.docker.calls.some(a => a.includes('pull')), false);
    assert.equal(f.docker.calls.filter(a => a.includes('container') && a.includes('create')).length, 1, 'only the isolated restore copy');
});


test('daemon drift inside read-only final status cannot authorize the old receipt', async t => {
    const f = fixture(t); await onboardWho('setup', f.deps); f.docker.calls.length = 0;
    // Controlled fake change after the ownership check, at the first final status name lookup.
    f.options.onCall = a => { if (a.includes('container') && a.includes('ls')) f.options.daemonId = 'changed-during-status-0002'; };
    await assert.rejects(onboardWho('status', f.deps), { code: 'engine_identity_changed' });
    assert.equal(mutations(f.docker.calls).length, 0);
});

// Isolate copied module/evidence bytes under the run-owned scratch directory. No canonical
// file is changed, no injected production evidence override is added, and Docker stays fake.
async function evidenceFixture(t, scenario) {
    const code = path.join(sandbox(t), 'synthetic-evidence-checkout');
    const sourceRoot = fileURLToPath(new URL('..', import.meta.url));
    const files = ['scripts/who-local-onboarding.mjs', 'scripts/who-local-setup.mjs',
        'scripts/who-local-platform.mjs', 'scripts/who-local-qualification.mjs', 'scripts/who-local-probe.mjs', 'scripts/who-local-loopback.mjs',
        'scripts/check-who-local-sidecar-manifest.mjs', 'docs/who-local-release-lock.json',
        'docs/who-local-sidecar.manifest.json', 'docs/who-lock-evidence/2.6.0-index.json',
        'docs/who-lock-evidence/2.6.0-arm64.json', 'docs/who-lock-evidence/2.6.0-readback.json',
        'docs/who-lock-evidence/2.6.0-amd64.json', 'docs/who-lock-evidence/2.6.0-amd64-readback.json'];
    for (const file of files) {
        const target = path.join(code, file); mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
        copyFileSync(path.join(sourceRoot, file), target);
    }
    if (scenario.missing) unlinkSync(path.join(code, scenario.missing));
    if (scenario.tampered) appendFileSync(path.join(code, scenario.tampered), ' ');
    if (scenario.unbound) {
        const filename = path.join(code, 'docs/who-local-release-lock.json');
        const fixtureLock = JSON.parse(readFileSync(filename));
        fixtureLock.targets['linux/amd64'].registryEvidenceSha256 = null;
        fixtureLock.targets['linux/amd64'].registryVerifiedAt = null;
        writeFileSync(filename, JSON.stringify(fixtureLock));
    }
    return import(pathToFileURL(path.join(code, 'scripts/who-local-onboarding.mjs')).href);
}
for (const scenario of [
    { name: 'child missing', missing: 'docs/who-lock-evidence/2.6.0-amd64.json' },
    { name: 'readback missing', missing: 'docs/who-lock-evidence/2.6.0-amd64-readback.json' },
    { name: 'lock binding missing', unbound: true },
    { name: 'child tampered', tampered: 'docs/who-lock-evidence/2.6.0-amd64.json' },
    { name: 'readback tampered', tampered: 'docs/who-lock-evidence/2.6.0-amd64-readback.json' },
]) {
    test(`AMD64 ${scenario.name}: copied evidence fixture denies before consent/pull/create`, async t => {
        const f = fixture(t, 'win32', { engineArch: 'amd64' });
        const isolated = await evidenceFixture(t, scenario);
        await assert.rejects(isolated.onboardWho('setup', f.deps), error => {
            assert.equal(error.code, scenario.tampered ? 'release_lock_invalid' : 'image_evidence_missing');
            if (scenario.missing) assert.ok(error.missing.includes(scenario.missing));
            if (scenario.unbound) assert.ok(error.missing.includes('docs/who-local-release-lock.json#targets/linux/amd64'));
            return true;
        });
        assert.equal(mutations(f.docker.calls).length, 0); assert.equal(f.prompts.length, 0);
        assert.equal(existsSync(path.join(f.directory, 'license.json')), false);
        assert.equal(existsSync(path.join(f.directory, 'installation.json')), false); disabled(f);
    });
}
test('AMD64 verified metadata still requires fresh consent and grants no implicit app start', async t => {
    const f = fixture(t, 'win32', { engineArch: 'amd64' });
    f.deps.ask = async prompt => { f.prompts.push(prompt); return 'n'; };
    await assert.rejects(onboardWho('setup', f.deps), { code: 'cancelled' });
    assert.ok(f.prompts.some(prompt => prompt.includes('ACCETTO')));
    assert.equal(mutations(f.docker.calls).length, 0);
    assert.equal(existsSync(path.join(f.directory, 'license.json')), false); disabled(f);
});
test('AMD64 interrupted pull/cancel/qualification failure cannot activate; explicit resume keeps the same pin', async t => {
    const f = fixture(t, 'linux', { engineArch: 'amd64', fail: a => a.includes('pull') });
    await assert.rejects(onboardWho('setup', f.deps), { code: 'pull_failed' }); disabled(f);
    const license = read(f, 'license.json'), state = read(f, 'installation.json');
    f.options.fail = undefined;
    const controller = new AbortController(); f.deps.signal = controller.signal;
    f.options.onCall = args => { if (args.includes('pull')) controller.abort(); };
    await assert.rejects(onboardWho('setup', f.deps), { code: 'cancelled' }); disabled(f);
    assert.equal(f.docker.calls.some(args => args.includes('create')), false);
    f.deps.signal = new AbortController().signal; f.options.onCall = undefined;
    f.options.corruptRestore = true;
    await assert.rejects(onboardWho('setup', f.deps)); disabled(f);
    assert.equal(read(f, 'installation.json').qualificationAttempt.complete, false);
    assert.equal(read(f, 'manifest.json').dataset.restoreVerified, false);
    assert.deepEqual(read(f, 'license.json'), license);
    assert.equal(read(f, 'installation.json').installationId, state.installationId);
    assert.equal(f.prompts.filter(prompt => prompt.includes('ACCETTO')).length, 1);
    assert.equal(f.prompts.filter(prompt => prompt.includes('Riprendere')).length, 2);
    for (const args of f.docker.calls.filter(args => args.includes('pull'))) {
        assert.equal(args[args.indexOf('--platform') + 1], 'linux/amd64');
        assert.equal(args.at(-1), `whoicd/icd-api@${readReleaseLock('linux/amd64').imageDigest}`);
    }
});
test('per-install synthetic inventories are measured, never reused across engine architectures', async t => {
    const inventories = [];
    for (const engineArch of ['arm64', 'amd64']) {
        const f = fixture(t, 'linux', { engineArch });
        assert.equal((await onboardWho('setup', f.deps)).state, 'ready');
        const state = read(f, 'installation.json');
        const inventory = read(f, path.join(state.qualificationAttempt.snapshot.directory, 'inventory.json'));
        inventories.push(inventory);
        assert.equal(state.qualificationAttempt.complete, true);
    }
    // The two data sets are intentionally different synthetic bytes, not an assertion about WHO data.
    assert.notDeepEqual(inventories[0], inventories[1]);
});

// Follow-up2 contract assertions. All request/engine seams here are explicitly synthetic.
test('v3 final service remains on the owned internal network; restored copy is stopped and all four observations are distinct', async t => {
    const f = fixture(t); await onboardWho('setup', f.deps);
    const s = read(f, 'installation.json'), r = s.qualificationAttempt;
    assert.equal(r.schemaVersion, 'mediflow.who-owned-qualification.v3');
    assert.deepEqual(f.docker.requests.map(p => p.kind), ['acquisition', 'offline_restart', 'restored', 'original_recovered']);
    assert.equal(new Set([r.acquisition, r.offlineRestart, r.restore, r.originalRecoveredProbe].map(p => p.bindingSha256)).size, 4);
    assert.equal(new Set([r.acquisition, r.offlineRestart, r.restore, r.originalRecoveredProbe].map(p => p.responseSha256)).size, 4, 'distinct synthetic bodies, not cached proofs');
    assert.notEqual(r.restore.port, 8382); assert.equal(r.originalRecoveredProbe.port, 8382);
    assert.deepEqual(Object.keys(f.docker.containers.get(id('a')).networks), [s.offlineNetwork.name]);
    assert.equal(f.docker.containers.get(id('b')).running, false);
    assert.equal(f.docker.calls.some(a => a[2] === 'network' && a[3] === 'connect' && a[4] === 'bridge'), false);
    for (const p of [r.offlineBefore, r.offlineAfter, r.restoreOfflineBefore, r.restoreOfflineAfter, r.originalOfflineBefore, r.originalOfflineAfter]) {
        assert.equal(p.networkId, s.offlineNetwork.id); assert.equal(p.noRoutedEgress, true);
        assert.match(p.routesSha256, /^sha256:[a-f0-9]{64}$/u); assert.match(p.ipv6RoutesSha256, /^sha256:[a-f0-9]{64}$/u);
    }
});
test('internal endpoint not actually published is a terminal gate, never success from network metadata', async t => {
    const f = fixture(t, 'linux', { noInternalPorts: true }); let waits = 0; f.deps.wait = async () => { waits++; };
    await assert.rejects(onboardWho('setup', f.deps), { code: 'probe_endpoint_unavailable' }); disabled(f);
    assert.equal(waits, 0); assert.deepEqual(f.docker.requests.map(p => p.kind), ['acquisition']);
    const s = read(f, 'installation.json'); assert.equal(s.qualificationAttempt.complete, false);
    assert.equal(s.qualificationAttempt.originalStoppedOnFailure, true); assert.equal(s.qualificationAttempt.offlineRestart, undefined);
    assert.equal(existsSync(path.join(f.directory, s.qualificationAttempt.snapshot.directory, 'inventory.json')), true);
    assert.equal(f.docker.containers.get(id('a')).running, false);
});
for (const kind of ['acquisition', 'offline_restart', 'restored', 'original_recovered']) {
    test(`${kind} terminal failure cannot be replaced by another stage or cleanup success`, async t => {
        const f = fixture(t); let waits = 0; f.deps.wait = async () => { waits++; };
        f.options.onRequest = request => { if (request.kind === kind) throw Object.assign(new Error('synthetic wrong response'), { code: 'probe_response_invalid' }); };
        await assert.rejects(onboardWho('setup', f.deps), { code: 'probe_response_invalid' }); disabled(f);
        const r = read(f, 'installation.json').qualificationAttempt;
        assert.equal(r.complete, false); assert.equal(r.failureCause.code, 'probe_response_invalid');
        assert.equal(r.probeFailures.at(-1).kind, kind); assert.equal(r.probeFailures.at(-1).attempt, 1);
        assert.equal(r.originalRecovered, undefined); assert.equal(r.originalStoppedOnFailure, true); assert.equal(waits, 0);
        const stages = ['acquisition', 'offline_restart', 'restored', 'original_recovered'];
        assert.deepEqual(f.docker.requests.map(p => p.kind), stages.slice(0, stages.indexOf(kind) + 1));
        if (r.restoredContainerId) assert.equal(f.docker.containers.get(r.restoredContainerId).running, false);
    });
}
for (const code of ['docker_cli_missing', 'docker_executable_missing', 'docker_executable_denied', 'docker_command_timeout',
    'probe_redirect_refused', 'probe_response_incomplete', 'probe_http_status', 'probe_transport_failed', 'unexpected_synthetic_error']) {
    test(`closed retry allowlist: ${code} is terminal at one request`, async t => {
        const f = fixture(t, 'linux', { requestError: Object.assign(new Error('synthetic private diagnostic'), { code }) });
        let waits = 0; f.deps.wait = async () => { waits++; };
        await assert.rejects(onboardWho('setup', f.deps), { code }); disabled(f);
        assert.equal(f.docker.requests.length, 1); assert.equal(waits, 0);
        assert.equal(read(f, 'installation.json').qualificationAttempt.failure, code);
    });
}
test('only explicit startup failures are retried; each failed attempt is preserved and later stages remain independent', async t => {
    const f = fixture(t); const request = f.deps.request; let waits = 0, attempts = 0;
    f.deps.request = async (...args) => {
        attempts++; if (attempts <= 3) throw Object.assign(new Error('synthetic startup'), { code: 'probe_service_starting', details: { status: 503 } });
        return request(...args);
    };
    f.deps.wait = async ms => { assert.equal(ms, 10000); waits++; };
    await onboardWho('setup', f.deps);
    const r = read(f, 'installation.json').qualificationAttempt;
    assert.equal(waits, 3); assert.equal(attempts, 7); assert.equal(r.probeFailures.length, 3); assert.equal(r.complete, true);
    assert.ok(r.probeFailures.every(p => p.kind === 'acquisition' && p.cause.status === 503));
});
test('startup deadline is still bounded at 60 observations and 59 waits, with the last cause retained', async t => {
    const f = fixture(t, 'linux', { requestError: Object.assign(new Error('synthetic timeout'), { code: 'probe_timeout', details: { timeoutMs: 5000 } }) });
    let waits = 0; f.deps.wait = async () => { waits++; };
    await assert.rejects(onboardWho('setup', f.deps), { code: 'dataset_not_ready' }); disabled(f);
    const r = read(f, 'installation.json').qualificationAttempt;
    assert.equal(f.docker.requests.length, 60); assert.equal(waits, 59); assert.equal(r.probeFailures.length, 60);
    assert.equal(r.lastProbeCause.code, 'probe_timeout'); assert.equal(r.lastProbeCause.timeoutMs, 5000);
});
for (const drift of ['daemon', 'owner', 'epoch', 'port']) {
    test(`HTTP response discarded when ${drift} changes across the read`, async t => {
        const f = fixture(t); f.options.onRequest = () => {
            const c = f.docker.containers.get(id('a'));
            if (drift === 'daemon') f.options.daemonId = 'synthetic-changed-after-http';
            if (drift === 'owner') f.options.wrongOwner = true;
            if (drift === 'epoch') c.startedAt = '2026-09-09T00:00:00Z';
            if (drift === 'port') c.requestedPorts['80/tcp'][0].HostIp = '0.0.0.0';
        };
        await assert.rejects(onboardWho('setup', f.deps), { code: ({ daemon: 'engine_identity_changed', owner: 'container_ownership_invalid', epoch: 'probe_binding_changed', port: 'probe_endpoint_unavailable' })[drift] });
        disabled(f); const r = read(f, 'installation.json').qualificationAttempt;
        assert.equal(r.complete, false); assert.equal(r.acquisition, undefined); assert.equal(r.probeFailures.length, 1);
        assert.equal(f.docker.calls.some(a => a[2] === 'cp'), false);
        if (drift === 'daemon' || drift === 'owner') assert.equal(r.cleanupFailures.length, 1);
    });
}
test('missing metadata tool exit127 is also terminal; no fallback executable is assumed', async t => {
    const f = fixture(t); f.options.fail = a => a[2] === 'exec' && a[4] === 'stat'
        ? Object.assign(new Error('synthetic missing stat'), { code: 'docker_executable_missing', exitCode: 127, details: { executable: 'stat', exitCode: 127 } }) : false;
    await assert.rejects(onboardWho('setup', f.deps), { code: 'docker_executable_missing' }); disabled(f);
    const r = read(f, 'installation.json').qualificationAttempt;
    assert.equal(r.failureCause.executable, 'stat'); assert.equal(r.failureCause.exitCode, 127); assert.equal(r.complete, false);
    assert.equal(f.docker.calls.filter(a => a[2] === 'exec' && a[4] === 'stat').length, 1);
    assert.equal(f.docker.calls.some(a => a.includes('cp') || a.includes('wget') || a.includes('python')), false);
});
test('failed owned stop is secondary evidence, never a replacement for the original prerequisite failure', async t => {
    const f = fixture(t, 'linux', { requestError: Object.assign(new Error('synthetic missing tool'), { code: 'docker_executable_missing', exitCode: 127 }) });
    f.options.fail = a => a[2] === 'container' && a[3] === 'stop';
    await assert.rejects(onboardWho('setup', f.deps), { code: 'docker_executable_missing' }); disabled(f);
    const r = read(f, 'installation.json').qualificationAttempt;
    assert.equal(r.failure, 'docker_executable_missing'); assert.equal(r.failureCause.exitCode, 127);
    assert.equal(r.recoveryFailure, 'owned_stop_failed'); assert.equal(r.cleanupFailures[0].cause.code, 'docker_unavailable');
    assert.equal(r.complete, false); assert.equal(r.originalRecovered, undefined); assert.doesNotMatch(JSON.stringify(r), /DO_NOT_PRINT/u);
});
test('new v3 proposal refuses a foreign network member and an old Docker loopback prerequisite without fallback', async t => {
    const foreign = fixture(t, 'linux', { foreignNetworkMember: true });
    await assert.rejects(onboardWho('setup', foreign.deps), { code: 'network_foreign_member' }); disabled(foreign);
    assert.equal(foreign.docker.calls.some(a => a[2] === 'network' && a[3] === 'connect'), false);
    const old = fixture(t, 'linux', { serverVersion: '27.5.1' });
    await assert.rejects(onboardWho('setup', old.deps), { code: 'docker_loopback_prerequisite' }); disabled(old);
    assert.equal(mutations(old.docker.calls).length, 0);
});
test('v2 ready receipt cannot start; read-only status requests requalification, whose new v3 receipt preserves the previous history', async t => {
    const f = fixture(t); await onboardWho('setup', f.deps);
    const s = read(f, 'installation.json'), previousDirectory = s.qualificationAttempt.snapshot.directory;
    s.qualificationAttempt.schemaVersion = 'mediflow.who-owned-qualification.v2'; save(f, 'installation.json', s);
    f.docker.calls.length = 0;
    assert.equal((await onboardWho('status', f.deps)).state, 'qualification_required'); assert.equal(mutations(f.docker.calls).length, 0);
    await assert.rejects(onboardWho('start', f.deps), { code: 'qualification_required' }); disabled(f);
    assert.equal((await onboardWho('qualify', f.deps)).state, 'ready');
    const next = read(f, 'installation.json'); assert.equal(next.qualificationAttempt.schemaVersion, 'mediflow.who-owned-qualification.v3');
    assert.notEqual(next.qualificationAttempt.snapshot.directory, previousDirectory);
    assert.equal(existsSync(path.join(f.directory, previousDirectory, 'qualification.json')), true);
});
test('cancellation during host read preserves cancelled receipt and stops only the owned source, without further probes', async t => {
    const f = fixture(t), controller = new AbortController(); f.deps.signal = controller.signal;
    f.options.onRequest = () => controller.abort();
    await assert.rejects(onboardWho('setup', f.deps), { code: 'cancelled' }); disabled(f);
    const r = read(f, 'installation.json').qualificationAttempt;
    assert.equal(r.failure, 'cancelled'); assert.equal(r.complete, false); assert.equal(r.originalStoppedOnFailure, true);
    assert.equal(f.docker.requests.length, 1); assert.equal(r.acquisition, undefined);
    assert.equal(f.docker.calls.some(a => a.includes('cp') || a.includes('rm') || a.includes('prune')), false);
});
