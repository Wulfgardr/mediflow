/* @Codex: ordinary onboarding and real file hashing with synthetic Docker only. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, existsSync, mkdirSync, rmSync, statSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { onboardWho, prepareManifest, readReleaseLock, friendlySetupMessage } from './who-local-onboarding.mjs';
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
    assert.ok(process.env.MEDIFLOW_DATA_DIR, 'Set an explicit synthetic MEDIFLOW_DATA_DIR');
    mkdirSync(process.env.MEDIFLOW_DATA_DIR, { recursive: true, mode: 0o700 });
    const directory = mkdtempSync(path.join(realpathSync(process.env.MEDIFLOW_DATA_DIR), 'mediflow-who-onboarding-test-'));
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
                networks: { [network]: { NetworkID: network === 'bridge' ? id('d') : n?.id ?? id('c') } } });
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
            if (c.running) { starts++; c.startedAt = new Date(Date.parse('2026-09-08T00:00:00Z') + starts * 1000).toISOString(); c.pid = 100 + starts; }
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
        if (options.macAccess && ![...containers.values()].some(c => c.running && c.ports['80/tcp']?.[0]?.HostPort === String(port)))
            return readWhoProbe(port, kind, signal);
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
function fixture(t, opts = {}) {
    opts.macAccess = true;
    const directory = sandbox(t), docker = fakeDocker(opts);
    const prompts = [], reports = [];
    const deps = { directory, ...docker, host: { platform: 'darwin', arch: 'arm64' }, portFree: async () => {}, wait: async () => {},
        now: () => '2026-09-07T12:00:00.000Z', ask: async prompt => { prompts.push(prompt); return prompt.includes('ACCETTO') ? 'ACCETTO' : 'n'; }, report: x => reports.push(x) };
    return { deps, docker, prompts, reports, directory };
}
const read = (directory, name) => JSON.parse(readFileSync(path.join(directory, name), 'utf8'));
const noMutation = calls => assert.equal(calls.some(a => a.includes('pull') || a.includes('create') || a.includes('start') || a.includes('stop') || a.includes('cp')), false);

test('distributed official lock verifies the three primary evidence hashes and carries no deployment qualification', () => {
    assert.equal(lock.imageDigest, 'sha256:7555e43478202d3f9a25eeb2914cc5053414c9464ec6a9a7628c01375d5b0a5e');
    assert.equal(lock.registryEvidenceSha256, 'sha256:f88419655c10f2e43061c282a79aebf32579f07a5a416b3f5be4fb3b0421ada3');
    assert.equal(lock.datasetFiles.length, 5);
    assert.equal(lock.snapshotId, undefined); assert.equal(lock.acceptedAt, undefined);
    const m = prepareManifest(lock, 'synthetic-operator-gesture', '2026-09-07T12:00:00.000Z');
    assert.equal(m.dataset.restoreVerified, false); assert.equal(m.dataset.snapshotId, null);
});

test('ordinary single procedure creates manifest, computes snapshot and restore proof, configures without hash inputs', async t => {
    const { deps, directory, docker, prompts } = fixture(t);
    const result = await onboardWho('setup', deps);
    assert.equal(result.state, 'ready'); assert.equal(prompts.length, 2);
    const m = read(directory, 'manifest.json'), state = read(directory, 'installation.json');
    assert.equal(m.dataset.restoreVerified, true); assert.equal(m.dataset.offlineRestartVerified, true);
    assert.notEqual(m.dataset.snapshotId, 'sha256:ecf3b894425d5cfb7514868d554eb086a7b5e7284ef212d2bb230a84b523b825');
    const inventoryPath = path.join(directory, state.qualificationAttempt.snapshot.directory, 'inventory.json');
    assert.equal(sha256(readFileSync(inventoryPath)), m.dataset.snapshotInventorySha256);
    assert.equal(state.qualificationAttempt.installationId, state.installationId);
    assert.equal(state.qualificationAttempt.originalContainerId, id('a')); assert.equal(state.qualificationAttempt.restoredContainerId, id('b'));
    assert.equal(docker.containers.get(id('a')).running, true); assert.deepEqual(Object.keys(docker.containers.get(id('a')).networks), [state.offlineNetwork.name]);
    assert.equal(docker.containers.get(id('b')).running, false);
    assert.equal(statSync(path.join(directory, 'who.env')).mode & 0o777, 0o600);
    assert.equal(statSync(result.launcher).mode & 0o777, 0o700);
    assert.match(readFileSync(path.join(directory, 'who.env'), 'utf8'), /MEDIFLOW_ICD_WHO_ENABLED=1/u);
    assert.equal(existsSync(path.join(directory, '.setup-active')), false);
    const creations = docker.calls.filter(a => a[2] === 'container' && a[3] === 'create');
    assert.equal(creations.length, 2);
    assert.equal(creations.some(args => args.includes('--publish')), false, 'Mac uses the owned Node listener, not Docker publication');
    assert.equal(state.qualificationAttempt.accessTopology, 'mac-host-exec-loopback-v1');
    for (const key of ['acquisition', 'offlineRestart', 'restore', 'originalRecoveredProbe']) {
        assert.equal(state.qualificationAttempt[key].transport, 'node-http-docker-exec-busybox-v2');
        assert.match(state.qualificationAttempt[key].instanceId, /^[a-f0-9-]{36}$/u);
    }
    assert.deepEqual(docker.requests.map(r => r.kind), ['acquisition', 'offline_restart', 'restored', 'original_recovered']);
    assert.equal(docker.calls.some(a => a.includes('curl')), false);
    for (const a of creations) {
        assert.equal(a.at(-1), `whoicd/icd-api@${lock.imageDigest}`);
        for (const expected of ['SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt', 'acceptLicense=true', 'include=2026-01_en', 'saveAnalytics=false', 'enableDoris=false', 'fhirSupport=false']) assert.ok(a.includes(expected));
        assert.equal(a.includes('--mount'), false); assert.equal(a.includes('--privileged'), false);
    }
    assert.doesNotMatch(JSON.stringify(docker.calls), /Config\.Env|"logs"|"rm"|"prune"|"sh"/u);
});

test('declined license or occupied port creates no installation and performs no mutation', async t => {
    for (const mode of ['decline', 'occupied']) {
        const { deps, directory, docker } = fixture(t);
        deps.ask = async () => 'no';
        if (mode === 'occupied') deps.portFree = async () => { throw Object.assign(new Error('busy'), { code: 'port_in_use' }); };
        await assert.rejects(onboardWho('setup', deps), error => ['cancelled', 'port_in_use'].includes(error.code));
        noMutation(docker.calls); assert.equal(existsSync(path.join(directory, 'installation.json')), false);
    }
});

// WHO-TRIOS D1: unsupported OS remains denied; Linux ARM64 is tested in the portability table.
test('unsupported host boundary and missing Docker do not start a VM or use another platform', async t => {
    const f = fixture(t); f.deps.host = { platform: 'freebsd', arch: 'arm64' };
    await assert.rejects(onboardWho('setup', f.deps), { code: 'host_unsupported' }); assert.equal(f.docker.calls.length, 0);
    const other = fixture(t); other.deps.run = () => { throw new Error('missing'); };
    await assert.rejects(onboardWho('setup', other.deps), { code: 'docker_unavailable' });
});

test('restore byte mismatch preserves incomplete receipt and stops only owned resources without bridge recovery', async t => {
    const { deps, directory, docker } = fixture(t, { corruptRestore: true });
    await assert.rejects(onboardWho('setup', deps), { code: 'restore_hash_mismatch' });
    const state = read(directory, 'installation.json'), manifest = read(directory, 'manifest.json');
    assert.equal(state.phase, 'qualification_required'); assert.equal(state.qualificationAttempt.complete, false);
    assert.equal(manifest.dataset.restoreVerified, false); assert.equal(manifest.dataset.snapshotId, null);
    assert.equal(readFileSync(path.join(directory, 'who.env'), 'utf8'), 'MEDIFLOW_ICD_WHO_ENABLED=0\n');
    assert.equal(docker.containers.get(id('a')).running, false); assert.deepEqual(Object.keys(docker.containers.get(id('a')).networks), [state.offlineNetwork.name]);
    assert.equal(state.qualificationAttempt.originalStoppedOnFailure, true);
    assert.equal(docker.requests.some(r => r.kind === 'original_recovered'), false);
    assert.equal(existsSync(path.join(directory, state.qualificationAttempt.snapshot.directory, 'qualification.json')), true);
});

test('default route or non-internal network prevents offline qualification and activation', async t => {
    for (const problem of [{ defaultRoute: true }, { nonInternal: true }]) {
        const { deps, directory } = fixture(t, problem);
        await assert.rejects(onboardWho('setup', deps), e => ['external_route_present', 'offline_network_mismatch'].includes(e.code));
        assert.equal(read(directory, 'manifest.json').dataset.offlineRestartVerified, false);
        assert.equal(read(directory, 'installation.json').qualificationAttempt.complete, false);
    }
});

test('ownership failure stops before qualification mutations and never adopts existing service', async t => {
    const { deps, docker } = fixture(t, { wrongOwner: true });
    await assert.rejects(onboardWho('setup', deps), { code: 'container_ownership_invalid' });
    assert.equal(docker.calls.some(a => ['stop', 'exec', 'cp', 'disconnect'].some(word => a.includes(word))), false);
});

test('repeat ordinary setup reuses its own proven installation without redownload or requalification', async t => {
    const { deps, docker, directory } = fixture(t);
    await onboardWho('setup', deps); docker.calls.length = 0;
    assert.equal((await onboardWho('setup', deps)).state, 'ready'); noMutation(docker.calls);
    const manifest = read(directory, 'manifest.json'); manifest.dataset.snapshotId = `sha256:${id('f')}`;
    writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest), { mode: 0o600 });
    await assert.rejects(onboardWho('status', deps), { code: 'private_state_invalid' });
});

test('unqualified start never installs or qualifies, and active procedure lock prevents concurrency', async t => {
    const { deps, directory, docker } = fixture(t);
    await assert.rejects(onboardWho('start', deps), { code: 'qualification_required' }); noMutation(docker.calls);
    mkdirSync(path.join(directory, '.setup-active'));
    await assert.rejects(onboardWho('setup', deps), { code: 'setup_busy' });
});

test('named app start loads WHO config directly, without manual env editing or overwriting inherited unrelated settings', async t => {
    const { deps, directory, docker } = fixture(t);
    await onboardWho('setup', deps); docker.calls.length = 0;
    let launched = false;
    deps.appPortFree = async () => {};
    deps.launch = async environment => {
        launched = true;
        assert.equal(environment.MEDIFLOW_ICD_WHO_ENABLED, '1');
        assert.equal(environment.MEDIFLOW_ICD_WHO_LOCAL_DATASET_ID, read(directory, 'manifest.json').dataset.snapshotId);
        assert.equal(environment.MEDIFLOW_DATA_DIR, process.env.MEDIFLOW_DATA_DIR);
        assert.equal(existsSync(path.join(directory, '.setup-active')), true, 'Mac listener owns the setup mutex until app exits');
    };
    await onboardWho('start', deps); assert.equal(launched, true); noMutation(docker.calls);
    deps.appPortFree = async () => { throw Object.assign(new Error('busy'), { code: 'app_running' }); };
    launched = false; await assert.rejects(onboardWho('start', deps), { code: 'app_running' }); assert.equal(launched, false);
});

test('original bytes changing during recovery prevent ready and preserve the exact recovery blocker', async t => {
    const { deps, directory } = fixture(t, { corruptOriginal: true });
    await assert.rejects(onboardWho('setup', deps), { code: 'original_recovery_failed' });
    const state = read(directory, 'installation.json');
    assert.equal(state.qualificationAttempt.complete, false);
    assert.equal(state.qualificationAttempt.failure, 'original_recovery_failed');
    assert.equal(state.qualificationAttempt.originalStoppedOnFailure, true);
    assert.equal(readFileSync(path.join(directory, 'who.env'), 'utf8'), 'MEDIFLOW_ICD_WHO_ENABLED=0\n');
});

test('ordinary named launcher can start its own stopped WHO service without reinstallation', async t => {
    const { deps, docker } = fixture(t);
    await onboardWho('setup', deps);
    docker.containers.get(id('a')).running = false; docker.calls.length = 0;
    deps.appPortFree = async () => {}; deps.launch = async () => {};
    await onboardWho('start', deps);
    assert.equal(docker.containers.get(id('a')).running, true);
    assert.equal(docker.calls.filter(a => a[2] === 'container' && a[3] === 'start').length, 1);
    assert.equal(docker.calls.some(a => a.includes('pull') || a.includes('create') || a.includes('cp') || a.includes('stop')), false);
});

test('failed qualification resumes with newly calculated evidence and no second image download', async t => {
    const faults = { corruptRestore: true };
    const { deps, directory, docker } = fixture(t, faults);
    await assert.rejects(onboardWho('setup', deps), { code: 'restore_hash_mismatch' });
    const previousAttempt = read(directory, 'installation.json').qualificationAttempt.attemptId;
    faults.corruptRestore = false; docker.calls.length = 0;
    deps.ask = async prompt => prompt.includes('Riprendere') ? 's' : 'n';
    assert.equal((await onboardWho('setup', deps)).state, 'ready');
    const state = read(directory, 'installation.json');
    assert.notEqual(state.qualificationAttempt.attemptId, previousAttempt);
    assert.equal(state.qualificationAttempt.complete, true);
    assert.equal(docker.calls.some(a => a.includes('pull')), false);
    assert.equal(docker.calls.filter(a => a[2] === 'cp').length, 10);
});

test('status rejects a context changed to remote before inspecting any container', async t => {
    const { deps, docker } = fixture(t);
    await onboardWho('setup', deps); docker.calls.length = 0;
    const prior = deps.run;
    deps.run = args => args[0] === 'context' && args[1] === 'inspect' ? 'ssh://synthetic-remote' : prior(args);
    await assert.rejects(onboardWho('status', deps), { code: 'local_context_required' });
    assert.equal(docker.calls.length, 0);
});

/* @Codex round 2: bounded recovery diagnostics; synthetic Docker, never a live install. */
test('fresh setup always requests exact license acceptance; declining one profile never authorizes another', async t => {
    for (const answer of ['', 's', 'accetto', 'ACCETTO ']) {
        const { deps, directory, docker } = fixture(t); deps.ask = async () => answer;
        await assert.rejects(onboardWho('setup', deps), { code: 'cancelled' });
        noMutation(docker.calls);
        assert.equal(existsSync(path.join(directory, 'license.json')), false);
        assert.equal(existsSync(path.join(directory, '.setup-active')), false);
    }
});

test('failed image acquisition preserves prepared records, gives a phase error and releases the lock', async t => {
    const { friendlySetupMessage } = await import('./who-local-onboarding.mjs');
    const faults = { fail: args => args.includes('pull') };
    const { deps, directory, docker } = fixture(t, faults);
    await assert.rejects(onboardWho('setup', deps), error => {
        assert.equal(error.code, 'pull_failed');
        assert.match(friendlySetupMessage(error), /consenso e lo stato preparato sono conservati/u);
        assert.doesNotMatch(friendlySetupMessage(error), /DO_NOT_PRINT/u); return true;
    });
    const saved = read(directory, 'installation.json'); assert.equal(saved.phase, 'prepared');
    assert.equal(existsSync(path.join(directory, '.setup-active')), false);
    docker.calls.length = 0; faults.fail = () => false;
    const status = await onboardWho('status', deps);
    assert.equal(status.state, 'qualification_required'); assert.match(status.message, /Preparazione WHO salvata/u);
    noMutation(docker.calls);
    deps.ask = async prompt => prompt.includes('Riprendere') ? 's' : 'n';
    assert.equal((await onboardWho('setup', deps)).state, 'ready');
    assert.equal(read(directory, 'installation.json').installationId, saved.installationId);
});

test('create and initial start failures name the phase without leaking Docker output or removing resources', async t => {
    const { friendlySetupMessage } = await import('./who-local-onboarding.mjs');
    for (const phase of ['create', 'start']) {
        const { deps, directory, docker } = fixture(t, { fail: args => args[2] === 'container' && args[3] === phase });
        await assert.rejects(onboardWho('setup', deps), error => {
            assert.equal(error.code, `${phase}_failed`);
            assert.doesNotMatch(friendlySetupMessage(error), /DO_NOT_PRINT/u); return true;
        });
        assert.equal(existsSync(path.join(directory, '.setup-active')), false);
        assert.equal(existsSync(path.join(directory, 'installation.json')), true);
        // D13: Mac start is now inside a persisted, disabled qualification attempt.
        if (phase === 'create') assert.equal(existsSync(path.join(directory, 'who.env')), false);
        else {
            assert.equal(readFileSync(path.join(directory, 'who.env'), 'utf8'), 'MEDIFLOW_ICD_WHO_ENABLED=0\n');
            const receipt = read(directory, 'installation.json').qualificationAttempt;
            assert.equal(receipt.complete, false); assert.equal(receipt.failure, 'start_failed');
            assert.equal(receipt.startup.startAttempted, true);
        }
        assert.equal(docker.calls.some(args => args.includes('rm') || args.includes('prune')), false);
    }
});

test('resume revalidates existing manifest prerequisites before any Docker call', async t => {
    const { deps, directory, docker } = fixture(t);
    await onboardWho('setup', deps); docker.calls.length = 0;
    const manifest = read(directory, 'manifest.json'); manifest.license.url = 'https://example.invalid/not-the-license';
    writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest), { mode: 0o600 });
    await assert.rejects(onboardWho('status', deps), { code: 'private_state_invalid' });
    assert.equal(docker.calls.length, 0);
});

test('a failed or signalled app launch is not reported as successful and does not reinstall WHO', async t => {
    const { deps, directory, docker } = fixture(t); await onboardWho('setup', deps);
    const before = readFileSync(path.join(directory, 'manifest.json'), 'utf8');
    deps.appPortFree = async () => {};
    for (const result of [1, null, 'throw']) {
        docker.calls.length = 0;
        deps.launch = async () => { if (result === 'throw') throw new Error('synthetic private launch detail'); return result; };
        await assert.rejects(onboardWho('start', deps), { code: 'app_launch_failed' });
        assert.equal(readFileSync(path.join(directory, 'manifest.json'), 'utf8'), before);
        assert.equal(existsSync(path.join(directory, '.setup-active')), false); noMutation(docker.calls);
    }
    deps.launch = async () => 0;
    assert.equal((await onboardWho('start', deps)).state, 'ready');
});

test('status of a qualified running container does not claim a fresh search', async t => {
    const { deps, docker } = fixture(t); await onboardWho('setup', deps); docker.calls.length = 0;
    const result = await onboardWho('status', deps);
    assert.equal(result.state, 'qualified'); assert.match(result.message, /non esegue una ricerca/u);
    assert.equal(docker.calls.some(args => args.includes('curl')), false); noMutation(docker.calls);
});

test('followup2 exit127 prerequisite is terminal at the first search attempt; disabled and cause retained', async t => {
    const { deps, docker, directory } = fixture(t);
    let attempts = 0, waits = 0;
    const missing = () => {
        attempts++;
        return Object.assign(new Error('synthetic exec127: do not log raw output'), {
            code: 'docker_executable_missing', exitCode: 127,
            details: { code: 'docker_executable_missing', exitCode: 127, executable: 'curl' },
        });
    };
    // Same fault contract on the old exec transport and the new host dependency seam.
    // No WHO response is simulated in this regression, and no Docker process is invoked.
    docker.options.fail = args => args[2] === 'exec' && args[4] === 'curl' ? missing() : false;
    deps.request = async () => { throw missing(); };
    deps.wait = async () => { waits++; };
    let error;
    try { await onboardWho('setup', deps); } catch (caught) { error = caught; }
    t.diagnostic(JSON.stringify({ code: error?.code, searchAttempts: attempts, pollingWaits: waits }));
    assert.equal(error?.code, 'docker_executable_missing');
    assert.equal(attempts, 1); assert.equal(waits, 0);
    const receipt = read(directory, 'installation.json').qualificationAttempt;
    assert.equal(receipt.complete, false); assert.equal(receipt.failure, 'docker_executable_missing');
    assert.equal(receipt.failureCause.exitCode, 127);
    assert.equal(receipt.probeFailures.length, 1);
    assert.equal(receipt.probeFailures[0].cause.executable, 'curl');
    assert.equal(receipt.originalStoppedOnFailure, true);
    assert.equal(docker.containers.get(id('a')).running, false);
    assert.equal(readFileSync(path.join(directory, 'who.env'), 'utf8'), 'MEDIFLOW_ICD_WHO_ENABLED=0\n');
    assert.equal(docker.calls.some(a => a.includes('cp') || a.includes('disconnect') || a.includes('prune') || a.includes('rm')), false);
    assert.ok(docker.calls.filter(a => a[2] === 'container' && a[3] === 'stop').every(a => a.at(-1) === id('a')));
});

// @Codex: synthetic Docker29 stdout regression; no live container or qualification evidence.
test('owned stop uses current timeout option, verifies state and rejects unrelated stdout', async t => {
    const f = fixture(t); const run = f.deps.run;
    f.deps.run = (args, timeout) => {
        const result = run(args, timeout);
        return args[2] === 'container' && args[3] === 'stop' && args.includes('--time')
            ? `Flag --time has been deprecated, use --timeout instead\n${result}` : result;
    };
    assert.equal((await onboardWho('setup', f.deps)).state, 'ready');
    const stops = f.docker.calls.filter(a => a[2] === 'container' && a[3] === 'stop');
    assert.ok(stops.length > 0);
    for (const args of stops) {
        assert.deepEqual(args.slice(4, -1), ['--timeout', '30']);
        const next = f.docker.calls.slice(f.docker.calls.indexOf(args) + 1).find(a => a[2] === 'container');
        assert.equal(next[3], 'inspect'); assert.equal(next[4], args.at(-1));
    }
    const invalid = fixture(t); const invalidRun = invalid.deps.run;
    invalid.deps.run = (args, timeout) => {
        const result = invalidRun(args, timeout);
        return args[2] === 'container' && args[3] === 'stop' ? `unrelated output\n${result}` : result;
    };
    await assert.rejects(onboardWho('setup', invalid.deps), { code: 'container_stop_unconfirmed' });
});

// Follow-up3 shared/Mac correction: Node sockets are real; Docker/WHO payloads remain synthetic.
test('F-WHO4 Mac with effective port null and old requested loopback completes independent offline/recovery observations', async t => {
    const { deps, directory, docker } = fixture(t, { noInternalPorts: true, legacyRequest: true });
    await onboardWho('setup', deps);
    const state = read(directory, 'installation.json'), q = state.qualificationAttempt;
    assert.equal(q.schemaVersion, 'mediflow.who-owned-qualification.v4'); assert.equal(q.complete, true);
    assert.equal(q.execPrerequisites.image, state.image);
    assert.equal(q.offlineRestart.transport, 'node-http-docker-exec-busybox-v2');
    const observations = [q.acquisition, q.offlineRestart, q.restore, q.originalRecoveredProbe];
    assert.equal(new Set(observations.map(p => p.instanceId)).size, 4);
    assert.equal(new Set(observations.map(p => p.responseSha256)).size, 4);
    assert.equal(new Set([q.acquisition.startedAt, q.offlineRestart.startedAt, q.originalRecoveredProbe.startedAt]).size, 3);
    for (const p of observations.slice(1)) {
        assert.equal(p.isolation.internal, true); assert.equal(p.isolation.noRoutedEgress, true);
        assert.equal(p.isolation.noDefaultRoute, true); assert.equal(p.isolation.networkId, state.offlineNetwork.id);
    }
    assert.equal(q.restore.containerId, id('b')); assert.equal(q.originalRecoveredProbe.containerId, id('a'));
    assert.equal(docker.containers.get(id('b')).running, false); assert.equal(docker.containers.get(id('a')).running, true);
    assert.equal(docker.calls.some(a => a[2] === 'network' && a[3] === 'connect' && a[4] === 'bridge'), false);
    assert.equal(docker.calls.some(a => a.includes('--publish') || a.includes('--privileged') || a.includes('rm') || a.includes('prune')), false);
    // The relay is process-owned, not a detached daemon or a claim of live availability after setup.
    const { readWhoProbe } = await import('./who-local-probe.mjs');
    await assert.rejects(readWhoProbe(8382, 'original_recovered'), { code: 'probe_connect_pending' });
});
test('Mac v3 metadata cannot silently become v4; a new explicit gesture and fresh snapshot are required', async t => {
    const f = fixture(t); await onboardWho('setup', f.deps);
    const saved = read(f.directory, 'installation.json'), oldAttempt = saved.qualificationAttempt.attemptId;
    saved.qualificationAttempt.schemaVersion = 'mediflow.who-owned-qualification.v3';
    writeFileSync(path.join(f.directory, 'installation.json'), JSON.stringify(saved), { mode: 0o600 });
    f.docker.calls.length = 0;
    await assert.rejects(onboardWho('start', f.deps), { code: 'qualification_required' }); noMutation(f.docker.calls);
    assert.equal((await onboardWho('status', f.deps)).state, 'qualification_required');
    f.deps.ask = async () => 'n'; await assert.rejects(onboardWho('setup', f.deps), { code: 'cancelled' });
    f.deps.ask = async prompt => prompt.includes('Riprendere') ? 's' : 'n';
    await onboardWho('setup', f.deps);
    const next = read(f.directory, 'installation.json');
    assert.equal(next.qualificationAttempt.schemaVersion, 'mediflow.who-owned-qualification.v4');
    assert.notEqual(next.qualificationAttempt.attemptId, oldAttempt);
    assert.equal(existsSync(path.join(f.directory, saved.qualificationAttempt.snapshot.directory, 'qualification.json')), true);
    assert.equal(f.docker.calls.some(a => a.includes('pull')), false);
});
test('Mac required exec tool missing is terminal before snapshot: exact missing code retained, no fallback image or tool install', async t => {
    const error = Object.assign(new Error('DO_NOT_PRINT_SYNTHETIC_SECRET'), { code: 'docker_executable_missing', details: { exitCode: 127, executable: 'timeout' } });
    const f = fixture(t, { execError: error }); let waits = 0;
    f.deps.wait = async () => { waits++; };
    await assert.rejects(onboardWho('setup', f.deps), { code: 'docker_executable_missing' });
    const state = read(f.directory, 'installation.json'), receipt = state.qualificationAttempt;
    assert.equal(receipt.complete, false); assert.equal(receipt.failureCause.exitCode, 127);
    assert.equal(receipt.failureCause.executable, 'timeout'); assert.equal(waits, 0);
    assert.equal(receipt.snapshot, undefined); assert.equal(f.docker.requests.length, 0);
    assert.equal(f.docker.calls.some(a => a.includes('cp') || a.includes('install') || a.includes('rm')), false);
    assert.equal(f.docker.containers.get(id('a')).running, false);
    assert.equal(readFileSync(path.join(f.directory, 'who.env'), 'utf8'), 'MEDIFLOW_ICD_WHO_ENABLED=0\n');
});
test('Mac synthetic readiness body cannot bypass the real owned-listener exchange', async t => {
    const f = fixture(t);
    f.deps.request = async () => JSON.stringify({ destinationEntities: [{ id: 'http://id.who.int/icd/release/11/2026-01/mms/1000000001', title: 'Synthetic', theCode: 'AA00' }] });
    await assert.rejects(onboardWho('setup', f.deps), { code: 'probe_binding_invalid' });
    assert.equal(f.docker.execCalls.filter(a => isExecProgram(a, EXEC_HTTP_PROGRAM)).length, 0);
    assert.equal(read(f.directory, 'installation.json').qualificationAttempt.complete, false);
    assert.equal(f.docker.calls.some(a => a.includes('cp')), false);
});
for (const change of ['epoch', 'owner', 'egress', 'daemon', 'endpoint']) {
    test(`Mac offline response is rejected when ${change} changes across the actual listener request`, async t => {
        const options = { noInternalPorts: true }; const f = fixture(t, options);
        options.onExec = args => {
            if (!isExecProgram(args, EXEC_HTTP_PROGRAM) || f.docker.containers.get(id('a')).networks.bridge) return;
            if (change === 'epoch') f.docker.containers.get(id('a')).startedAt = '2026-09-08T00:01:00.000Z';
            if (change === 'owner') options.wrongOwner = true;
            if (change === 'egress') options.defaultRoute = true;
            if (change === 'daemon') options.daemonId = 'synthetic-daemon-changed';
            if (change === 'endpoint') options.endpoint = 'unix:///synthetic/changed.sock';
        };
        await assert.rejects(onboardWho('setup', f.deps), error => ['probe_binding_changed', 'container_ownership_invalid', 'external_route_present', 'engine_identity_changed'].includes(error.code));
        const q = read(f.directory, 'installation.json').qualificationAttempt;
        assert.equal(q.complete, false); assert.equal(q.offlineRestart, undefined); assert.equal(q.restore, undefined);
        assert.equal(readFileSync(path.join(f.directory, 'who.env'), 'utf8'), 'MEDIFLOW_ICD_WHO_ENABLED=0\n');
        assert.equal(f.docker.calls.some(a => a.includes('rm') || a.includes('prune')), false);
        // If ownership/engine drift prevents safe cleanup, the original error remains primary.
        if (['owner', 'daemon', 'endpoint'].includes(change)) assert.equal(q.recoveryFailure, 'owned_stop_failed');
    });
}
test('Mac added capabilities deny the executor before the first query', async t => {
    const f = fixture(t, { capAdd: ['NET_ADMIN'] });
    await assert.rejects(onboardWho('setup', f.deps), { code: 'container_ownership_invalid' });
    assert.equal(f.docker.execCalls.some(a => isExecProgram(a, EXEC_HTTP_PROGRAM)), false);
    assert.equal(f.docker.calls.some(a => a.includes('cp')), false);
});
test('Mac foreground shared/headless serve owns listener and mutex until cancellation without stopping the backend/container', async t => {
    const f = fixture(t); await onboardWho('setup', f.deps);
    f.docker.calls.length = 0;
    const controller = new AbortController(); let serving;
    const started = new Promise(resolve => { serving = resolve; });
    f.deps.signal = controller.signal; f.deps.launch = async () => assert.fail('serve must not launch or control the app');
    f.deps.report = message => { if (message.startsWith('WHO locale risponde sul ponte')) serving(); };
    const task = onboardWho('serve', f.deps);
    await started;
    assert.equal(existsSync(path.join(f.directory, '.setup-active')), true);
    assert.equal(JSON.parse(await readWhoProbe(8382, 'original_recovered')).destinationEntities.length, 1);
    await assert.rejects(onboardWho('qualify', { ...f.deps, signal: undefined }), { code: 'setup_busy' });
    controller.abort(); assert.equal((await task).state, 'stopped');
    assert.equal(existsSync(path.join(f.directory, '.setup-active')), false);
    assert.equal(f.docker.containers.get(id('a')).running, true);
    assert.equal(f.docker.calls.some(a => a.includes('stop') || a.includes('start') || a.includes('create') || a.includes('cp')), false);
    await assert.rejects(readWhoProbe(8382, 'original_recovered'), { code: 'probe_connect_pending' });
});
test('Mac app launch sees real live bridge; app exit releases only bridge and mutex, and later serve requires a fresh probe', async t => {
    const f = fixture(t); await onboardWho('setup', f.deps);
    f.deps.appPortFree = async () => {};
    f.deps.launch = async environment => {
        assert.equal(environment.MEDIFLOW_ICD_WHO_ENABLED, '1');
        assert.equal(JSON.parse(await readWhoProbe(8382, 'original_recovered')).destinationEntities.length, 1);
        return 0;
    };
    await onboardWho('start', f.deps);
    await assert.rejects(readWhoProbe(8382, 'original_recovered'), { code: 'probe_connect_pending' });
    assert.equal(existsSync(path.join(f.directory, '.setup-active')), false);
    f.docker.options.execError = Object.assign(new Error('synthetic'), { code: 'docker_executable_missing' });
    let launched = false; f.deps.launch = async () => { launched = true; };
    await assert.rejects(onboardWho('start', f.deps), { code: 'docker_executable_missing' });
    assert.equal(launched, false); assert.equal(f.docker.containers.get(id('a')).running, true);
    assert.equal(readFileSync(path.join(f.directory, 'who.env'), 'utf8'), 'MEDIFLOW_ICD_WHO_ENABLED=0\n');
});
test('Mac v4 receipt cannot accept reused query path or recovery start epoch', async t => {
    const { validQualification } = await import('./who-local-onboarding.mjs');
    const f = fixture(t); await onboardWho('setup', f.deps);
    const state = read(f.directory, 'installation.json'), manifest = read(f.directory, 'manifest.json');
    assert.equal(validQualification(state, manifest), true);
    for (const mutate of [
        q => { q.offlineRestart.requestPathSha256 = q.acquisition.requestPathSha256; },
        q => { q.originalRecoveredProbe.startedAt = q.offlineRestart.startedAt; },
        q => { q.restore.targetBindingSha256 = q.acquisition.targetBindingSha256; },
        q => { q.offlineRestart.isolation.internal = false; },
        q => { q.execPrerequisites.image = 'whoicd/icd-api:latest'; },
    ]) {
        const changed = structuredClone(state); mutate(changed.qualificationAttempt);
        assert.equal(validQualification(changed, manifest), false);
    }
});

// F4 prerequisite error gates: synthetic Docker only, no new availability evidence.
for (const [code, executable] of [['relay_timeout_unsupported', 'busybox_timeout'],
    ['relay_nc_unsupported', 'busybox_nc'], ['relay_deadline_unverified', 'busybox_timeout']]) {
    test(`F4 ${code} is terminal before snapshot and preserves cause without stdout`, async t => {
        const f = fixture(t, { execError: Object.assign(new Error('DO_NOT_PRINT_SYNTHETIC_SECRET'), { code, details: { exitCode: 1, executable } }) });
        let waits = 0; f.deps.wait = async () => { waits++; };
        await assert.rejects(onboardWho('setup', f.deps), { code });
        const state = read(f.directory, 'installation.json'), q = state.qualificationAttempt;
        assert.equal(q.complete, false); assert.equal(q.failureCause.code, code); assert.equal(q.failureCause.executable, executable);
        assert.equal(q.snapshot, undefined); assert.equal(waits, 0);
        assert.equal(f.docker.execCalls.some(a => isExecProgram(a, EXEC_HTTP_PROGRAM)), false);
        assert.equal(f.docker.calls.some(a => a.includes('cp') || a.includes('install') || a.includes('rm')), false);
        assert.equal(readFileSync(path.join(f.directory, 'who.env'), 'utf8'), 'MEDIFLOW_ICD_WHO_ENABLED=0\n');
        assert.doesNotMatch(JSON.stringify(state), /DO_NOT_PRINT_SYNTHETIC_SECRET/u);
        const message = friendlySetupMessage({ code }, 'darwin');
        assert.notEqual(message, friendlySetupMessage({ code: 'unknown' }, 'darwin'));
        assert.doesNotMatch(message, /\/bin\/bash|\/usr\/bin\/timeout|GNU|docker_unavailable/u);
    });
}
test('F4 preflight currentness drift is rejected before any HTTP or snapshot', async t => {
    const options = {}, f = fixture(t, options);
    options.onExec = args => { if (isExecProgram(args, EXEC_DEADLINE_PROGRAM)) f.docker.containers.get(id('a')).startedAt = '2026-09-08T01:00:00.000Z'; };
    await assert.rejects(onboardWho('setup', f.deps), { code: 'probe_binding_changed' });
    const q = read(f.directory, 'installation.json').qualificationAttempt;
    assert.equal(q.complete, false); assert.equal(q.execPrerequisites, undefined); assert.equal(q.snapshot, undefined);
    assert.equal(f.docker.execCalls.some(a => isExecProgram(a, EXEC_HTTP_PROGRAM)), false);
});
for (const old of ['prerequisite', 'transport']) {
    test(`F4 never promotes the previous F3 ${old} inside a Mac v4 receipt`, async t => {
        const f = fixture(t); await onboardWho('setup', f.deps);
        const saved = read(f.directory, 'installation.json');
        if (old === 'prerequisite') saved.qualificationAttempt.execPrerequisites.contract = 'mediflow-who-exec-tools-v1';
        else for (const key of ['acquisition', 'offlineRestart', 'restore', 'originalRecoveredProbe']) saved.qualificationAttempt[key].transport = 'node-http-docker-exec-loopback-v1';
        const bytes = JSON.stringify(saved), file = path.join(f.directory, 'installation.json');
        writeFileSync(file, bytes, { mode: 0o600 }); f.docker.calls.length = 0;
        await assert.rejects(onboardWho('start', f.deps), { code: 'private_state_invalid' }); noMutation(f.docker.calls);
        await assert.rejects(onboardWho('status', f.deps), { code: 'private_state_invalid' });
        assert.equal(readFileSync(file, 'utf8'), bytes);
        f.deps.ask = async () => 'n'; await assert.rejects(onboardWho('qualify', f.deps), { code: 'private_state_invalid' });
        assert.equal(readFileSync(file, 'utf8'), bytes);
    });
}

// F5 fixtures are deliberately synthetic. They do not execute the WHO service.
function f5Exit(c, exitCode = 134) {
    Object.assign(c, { running: false, status: 'exited', pid: 0, exitCode, oomKilled: false,
        runtimeError: false, finishedAt: '2026-09-08T02:00:00.000Z' });
}
const f5DeadlineError = () => Object.assign(new Error('DO_NOT_PRINT https://private.invalid/?token=SECRET'),
    { code: 'relay_deadline_unverified', details: { exitCode: 137, executable: 'busybox_timeout' } });

test('F5 regression: independent WHO exit134 during preflight is not a timeout137 diagnosis', async t => {
    const options = {}, f = fixture(t, options); let waits = 0;
    f.deps.wait = async () => { waits++; };
    options.onExec = args => {
        if (isExecProgram(args, EXEC_DEADLINE_PROGRAM)) {
            f5Exit(f.docker.containers.get(id('a'))); throw f5DeadlineError();
        }
    };
    await assert.rejects(onboardWho('setup', f.deps), { code: 'who_runtime_exited' });
    const r = read(f.directory, 'installation.json').qualificationAttempt;
    assert.equal(r.failureCause.exitCode, 134); assert.equal(r.failureCause.oomKilled, false);
    assert.equal(r.lastProbeCause.code, 'relay_deadline_unverified'); assert.equal(r.lastProbeCause.exitCode, 137);
    assert.equal(r.runtimeFailure.running, false); assert.equal(r.runtimeFailure.status, 'exited');
    assert.equal(r.runtimeFailure.runtimeCause, 'undetermined');
    assert.equal(r.complete, false); assert.equal(r.acquisition, undefined); assert.equal(r.snapshot, undefined);
    assert.equal(r.originalStoppedOnFailure, true); assert.equal(waits, 0);
    assert.equal(f.docker.calls.filter(a => a.includes('start')).length, 1);
    assert.equal(f.docker.calls.some(a => a.includes('cp') || a.includes('rm') || a.includes('logs')), false);
    assert.doesNotMatch(JSON.stringify(r), /SECRET|private\.invalid|DO_NOT_PRINT/u);
    assert.equal(readFileSync(path.join(f.directory, 'who.env'), 'utf8'), 'MEDIFLOW_ICD_WHO_ENABLED=0\n');
});

test('F5 regression: WHO exits before first EXEC; retained owned container is not reported foreign', async t => {
    const options = {}, f = fixture(t, options);
    options.onCall = args => {
        const c = f.docker.containers.get(id('a'));
        if (c?.running && args.includes('inspect') && args.includes('container')) f5Exit(c);
    };
    await assert.rejects(onboardWho('setup', f.deps), { code: 'who_runtime_exited' });
    const r = read(f.directory, 'installation.json').qualificationAttempt;
    assert.equal(r.failureCause.exitCode, 134); assert.equal(r.runtimeFailure.runtimeCause, 'undetermined');
    assert.equal(f.docker.execCalls.some(a => a.includes('/bin/busybox')), false);
    assert.equal(r.complete, false); assert.equal(r.originalStoppedOnFailure, true);
    assert.equal(f.docker.calls.filter(a => a.includes('start')).length, 1);
});

test('F5 live unchanged WHO cannot turn an unverified deadline137 into verified capability or runtime crash', async t => {
    const options = {}, f = fixture(t, options);
    options.onExec = args => { if (isExecProgram(args, EXEC_DEADLINE_PROGRAM)) throw f5DeadlineError(); };
    await assert.rejects(onboardWho('setup', f.deps), { code: 'relay_deadline_unverified' });
    const r = read(f.directory, 'installation.json').qualificationAttempt;
    assert.equal(r.failureCause.exitCode, 137); assert.equal(r.runtimeFailure, undefined);
    assert.equal(r.execPrerequisites, undefined); assert.equal(r.snapshot, undefined); assert.equal(r.complete, false);
    assert.equal(r.originalStoppedOnFailure, true);
    assert.equal(f.docker.containers.get(id('a')).running, false);
});

test('F5 cold acquisition polls only while the same WHO process is live, then performs all four independent searches', async t => {
    const options = {}, f = fixture(t, options); let pending = 0, waits = 0;
    options.onExec = args => {
        if (isExecProgram(args, EXEC_HTTP_PROGRAM) && pending++ < 3) {
            assert.equal(f.docker.calls.filter(a => a.includes('start')).length, 1, 'no restart while waiting');
            throw Object.assign(new Error('synthetic loading'), { code: 'probe_connect_pending' });
        }
    };
    f.deps.wait = async ms => { assert.equal(ms, 10000); waits++; };
    await onboardWho('setup', f.deps);
    const r = read(f.directory, 'installation.json').qualificationAttempt;
    assert.equal(waits, 3); assert.equal(r.probeFailures.length, 3); assert.equal(r.complete, true);
    for (const key of ['acquisition', 'offlineRestart', 'restore', 'originalRecoveredProbe']) assert.ok(r[key].responseSha256);
    assert.equal(new Set(['acquisition', 'offlineRestart', 'restore', 'originalRecoveredProbe'].map(k => r[k].bindingSha256)).size, 4);
    assert.equal(read(f.directory, 'manifest.json').dataset.restoreVerified, true);
});

test('F5 WHO exits during readiness: no further polling or blind restart and pre-cleanup exit is retained', async t => {
    const options = {}, f = fixture(t, options); let calls = 0, waits = 0;
    options.onExec = args => {
        if (isExecProgram(args, EXEC_HTTP_PROGRAM)) {
            if (++calls === 2) f5Exit(f.docker.containers.get(id('a')));
            throw Object.assign(new Error('synthetic refused'), { code: 'probe_connect_pending' });
        }
    };
    f.deps.wait = async () => { waits++; };
    await assert.rejects(onboardWho('setup', f.deps), { code: 'who_runtime_exited' });
    const r = read(f.directory, 'installation.json').qualificationAttempt;
    assert.equal(calls, 2); assert.equal(waits, 1); assert.equal(r.failureCause.exitCode, 134);
    assert.equal(r.runtimeFailure.kind, 'acquisition'); assert.equal(r.originalStoppedOnFailure, true);
    assert.equal(r.snapshot, undefined); assert.equal(f.docker.calls.filter(a => a.includes('start')).length, 1);
});

test('F5 complete buffered HTTP from a subsequently exited WHO is discarded, not counted as acquisition', async t => {
    const options = {}, f = fixture(t, options), exec = f.deps.execDocker;
    f.deps.execDocker = async (...args) => {
        const value = await exec(...args);
        if (isExecProgram(args[0], EXEC_HTTP_PROGRAM)) f5Exit(f.docker.containers.get(id('a')));
        return value;
    };
    await assert.rejects(onboardWho('setup', f.deps), { code: 'who_runtime_exited' });
    const r = read(f.directory, 'installation.json').qualificationAttempt;
    assert.equal(r.acquisition, undefined); assert.equal(r.snapshot, undefined); assert.equal(r.complete, false);
});

for (const drift of ['owner', 'daemon', 'epoch']) {
    test(`F5 ${drift} drift concurrent with runtime exit stays an authority/currentness failure`, async t => {
        const options = {}, f = fixture(t, options);
        options.onExec = args => {
            if (!isExecProgram(args, EXEC_DEADLINE_PROGRAM)) return;
            const c = f.docker.containers.get(id('a')); f5Exit(c);
            if (drift === 'owner') options.wrongOwner = true;
            if (drift === 'daemon') options.daemonId = 'synthetic-drifted-engine-9999';
            if (drift === 'epoch') c.startedAt = '2026-09-08T01:00:00.000Z';
            throw f5DeadlineError();
        };
        await assert.rejects(onboardWho('setup', f.deps), { code: ({ owner: 'container_ownership_invalid', daemon: 'engine_identity_changed', epoch: 'probe_binding_changed' })[drift] });
        const r = read(f.directory, 'installation.json').qualificationAttempt;
        assert.equal(r.runtimeFailure, undefined); assert.equal(r.complete, false); assert.equal(r.snapshot, undefined);
        if (drift !== 'epoch') assert.equal(r.originalStoppedOnFailure, undefined, 'cannot claim cleanup under lost authority');
    });
}

test('F5 epoch drift between readiness attempts is terminal, even if the replacement process is live', async t => {
    const options = {}, f = fixture(t, options); let httpCalls = 0;
    options.onExec = args => {
        if (isExecProgram(args, EXEC_HTTP_PROGRAM)) { httpCalls++; throw Object.assign(new Error('synthetic loading'), { code: 'probe_connect_pending' }); }
    };
    f.deps.wait = async () => { f.docker.containers.get(id('a')).startedAt = '2026-09-08T01:00:00.000Z'; };
    await assert.rejects(onboardWho('setup', f.deps), { code: 'probe_binding_changed' });
    assert.equal(httpCalls, 1); assert.equal(read(f.directory, 'installation.json').qualificationAttempt.acquisition, undefined);
});

test('F5 cancellation during failed preflight stays cancellation; it cannot grant a runtime or transport pass', async t => {
    const options = {}, f = fixture(t, options), controller = new AbortController(); f.deps.signal = controller.signal;
    options.onExec = args => {
        if (isExecProgram(args, EXEC_DEADLINE_PROGRAM)) {
            f5Exit(f.docker.containers.get(id('a'))); controller.abort(); throw f5DeadlineError();
        }
    };
    await assert.rejects(onboardWho('setup', f.deps), { code: 'cancelled' });
    const r = read(f.directory, 'installation.json').qualificationAttempt;
    assert.equal(r.complete, false); assert.equal(r.execPrerequisites, undefined); assert.equal(r.snapshot, undefined);
    assert.equal(f.docker.calls.filter(a => a.includes('start')).length, 1);
});

test('F5 Mac readiness has a finite 60-attempt bound, preserves the final pending cause and stops the owned original', async t => {
    const options = {}, f = fixture(t, options); let httpCalls = 0, waits = 0;
    options.onExec = args => {
        if (isExecProgram(args, EXEC_HTTP_PROGRAM)) { httpCalls++; throw Object.assign(new Error('synthetic loading'), { code: 'probe_connect_pending' }); }
    };
    f.deps.wait = async () => { waits++; };
    await assert.rejects(onboardWho('setup', f.deps), { code: 'who_startup_budget_exhausted' });
    const r = read(f.directory, 'installation.json').qualificationAttempt;
    assert.equal(httpCalls, 60); assert.equal(waits, 59); assert.equal(r.probeFailures.length, 60);
    assert.equal(r.lastProbeCause.code, 'probe_connect_pending'); assert.equal(r.failureCause.attempts, 60);
    assert.equal(r.complete, false); assert.equal(r.originalStoppedOnFailure, true);
});

test('F5 Mac monotonic budget cannot be extended by a running process or repeated transient failure', async t => {
    const { STARTUP_BUDGET_MS } = await import('./who-local-qualification.mjs');
    const options = {}, f = fixture(t, options); let clock = 0, httpCalls = 0;
    f.deps.monotonicNow = () => clock;
    options.onExec = args => {
        if (isExecProgram(args, EXEC_HTTP_PROGRAM)) { httpCalls++; throw Object.assign(new Error('synthetic loading'), { code: 'probe_timeout' }); }
    };
    f.deps.wait = async () => { clock = STARTUP_BUDGET_MS; };
    await assert.rejects(onboardWho('setup', f.deps), { code: 'who_startup_budget_exhausted' });
    const r = read(f.directory, 'installation.json').qualificationAttempt;
    assert.equal(httpCalls, 1); assert.equal(r.failureCause.budgetMs, 900000); assert.equal(r.failureCause.attempts, 1);
    assert.equal(r.lastProbeCause.code, 'probe_timeout'); assert.equal(r.originalStoppedOnFailure, true);
});

test('F5 cancellation at the readiness wait never reopens acquisition or loops into recovery', async t => {
    const options = {}, f = fixture(t, options), controller = new AbortController(); let calls = 0;
    f.deps.signal = controller.signal;
    options.onExec = args => {
        if (isExecProgram(args, EXEC_HTTP_PROGRAM)) { calls++; throw Object.assign(new Error('synthetic loading'), { code: 'probe_connect_pending' }); }
    };
    f.deps.wait = async () => { controller.abort(); };
    await assert.rejects(onboardWho('setup', f.deps), { code: 'cancelled' });
    assert.equal(calls, 1); assert.equal(f.docker.calls.filter(a => a.includes('start')).length, 1);
    assert.equal(read(f.directory, 'installation.json').qualificationAttempt.originalStoppedOnFailure, true);
});

for (const field of ['exitCode', 'oomKilled', 'runtimeError', 'startedAt', 'status']) {
    test(`F5 missing or malformed ${field} evidence cannot be interpreted as a healthy startup`, async t => {
        const f = fixture(t), original = f.deps.run;
        f.deps.run = args => {
            const output = original(args);
            if (args.includes('container') && args.includes('inspect') && args.at(-1).includes('Config.Labels')) {
                const value = JSON.parse(output); delete value[field]; return JSON.stringify(value);
            }
            return output;
        };
        await assert.rejects(onboardWho('setup', f.deps), { code: 'runtime_evidence_invalid' });
        const r = read(f.directory, 'installation.json').qualificationAttempt;
        assert.equal(r.complete, false); assert.equal(r.execPrerequisites, undefined);
        assert.equal(f.docker.execCalls.some(a => a.includes('/bin/busybox')), false);
    });
}

test('F5 start return must be the exact recorded ID; an unrelated stdout ID is never adopted', async t => {
    const f = fixture(t), original = f.deps.run;
    f.deps.run = args => { const out = original(args); return args.includes('container') && args.includes('start') ? id('f') : out; };
    await assert.rejects(onboardWho('setup', f.deps), { code: 'start_unconfirmed' });
    const state = read(f.directory, 'installation.json');
    assert.equal(state.containerId, id('a')); assert.equal(state.qualificationAttempt.complete, false);
    assert.equal(state.qualificationAttempt.originalStoppedOnFailure, true);
    assert.equal(f.docker.calls.some(a => a.includes('start') && a.includes(id('f'))), false);
});

test('F5 diagnose of the retained failed owned container is read-only, minimized and does not adopt another port/service', async t => {
    const options = {}, f = fixture(t, options);
    options.onExec = args => { if (isExecProgram(args, EXEC_DEADLINE_PROGRAM)) { f5Exit(f.docker.containers.get(id('a'))); throw f5DeadlineError(); } };
    await assert.rejects(onboardWho('setup', f.deps), { code: 'who_runtime_exited' });
    const saved = read(f.directory, 'installation.json');
    const files = ['installation.json', 'license.json', 'manifest.json', 'who.env', `snapshot-${saved.qualificationAttempt.attemptId}/qualification.json`];
    const before = files.map(name => readFileSync(path.join(f.directory, name)));
    f.deps.ask = async () => { assert.fail('diagnose must not request consent or start anything'); };
    f.docker.calls.length = 0; f.docker.execCalls.length = 0;
    const result = await onboardWho('diagnose', f.deps);
    assert.equal(result.state, 'qualification_required'); assert.equal(result.diagnostic.exitCode, 134);
    assert.equal(result.diagnostic.previousFailure.code, 'who_runtime_exited');
    assert.equal(result.diagnostic.qualifiedReceipt, false); assert.equal(result.diagnostic.runtimeCause, 'undetermined');
    assert.doesNotMatch(JSON.stringify(result), /SECRET|private\.invalid|docker\.sock|installationId|containerId|epochSha256|8888/u);
    for (const [i, name] of files.entries()) assert.deepEqual(readFileSync(path.join(f.directory, name)), before[i]);
    noMutation(f.docker.calls); assert.equal(f.docker.calls.some(a => a.includes('exec') || a.includes('logs') || a.includes('diff')), false);
    assert.equal(f.docker.execCalls.length, 0); assert.equal(existsSync(path.join(f.directory, '.setup-active')), false);
});

test('F5 diagnose refuses an active procedure and does not create a mutex or state for a missing installation', async t => {
    const f = fixture(t);
    assert.equal((await onboardWho('diagnose', f.deps)).state, 'not_installed');
    assert.equal(existsSync(path.join(f.directory, 'installation.json')), false);
    assert.equal(f.docker.calls.length, 0);
    mkdirSync(path.join(f.directory, '.setup-active'), { mode: 0o700 });
    await assert.rejects(onboardWho('diagnose', f.deps), { code: 'setup_busy' });
    assert.equal(existsSync(path.join(f.directory, '.setup-active')), true);
});

test('F5 explicit resume reuses owned UUID/container/license and preserves preceding failed receipt bytes', async t => {
    const options = {}, f = fixture(t, options);
    options.onExec = args => { if (isExecProgram(args, EXEC_DEADLINE_PROGRAM)) { f5Exit(f.docker.containers.get(id('a'))); throw f5DeadlineError(); } };
    await assert.rejects(onboardWho('setup', f.deps), { code: 'who_runtime_exited' });
    const previous = read(f.directory, 'installation.json'), license = readFileSync(path.join(f.directory, 'license.json'));
    const evidence = path.join(f.directory, `snapshot-${previous.qualificationAttempt.attemptId}`, 'qualification.json');
    const previousBytes = readFileSync(evidence);
    // Model retained F4 v4 incomplete state: no fabricated runtime diagnosis is required to resume.
    previous.qualificationAttempt.failure = 'relay_deadline_unverified';
    previous.qualificationAttempt.failureCause = { code: 'relay_deadline_unverified', exitCode: 137, executable: 'busybox_timeout' };
    delete previous.qualificationAttempt.runtimeFailure;
    writeFileSync(path.join(f.directory, 'installation.json'), JSON.stringify(previous), { mode: 0o600 });
    options.onExec = undefined; f.docker.calls.length = 0;
    f.deps.ask = async prompt => { assert.match(prompt, /Riprendere/u); return 's'; };
    await onboardWho('qualify', f.deps);
    const next = read(f.directory, 'installation.json');
    assert.equal(next.installationId, previous.installationId); assert.equal(next.containerId, previous.containerId);
    assert.equal(next.image, previous.image); assert.equal(next.qualificationAttempt.previousAttemptId, previous.qualificationAttempt.attemptId);
    assert.notEqual(next.qualificationAttempt.attemptId, previous.qualificationAttempt.attemptId);
    assert.equal(next.qualificationAttempt.complete, true); assert.equal(next.qualificationAttempt.runtimeFailure, undefined);
    assert.deepEqual(readFileSync(path.join(f.directory, 'license.json')), license); assert.deepEqual(readFileSync(evidence), previousBytes);
    assert.equal(f.docker.calls.some(a => a.includes('pull') || a.includes('rm') || a.includes('prune')), false);
    const creates = f.docker.calls.filter(a => a.includes('container') && a.includes('create'));
    assert.equal(creates.length, 1); assert.match(creates[0][creates[0].indexOf('--name') + 1], /^mediflow-who-restore-/u);
    assert.equal(Object.keys(next.qualificationAttempt).includes('previousFailure'), false, 'no recursive history expansion');
});

test('F5 repeated unchanged external crash is one explicit retry, not an automatic restart loop or a new installation', async t => {
    const options = {}, f = fixture(t, options);
    options.onExec = args => { if (isExecProgram(args, EXEC_DEADLINE_PROGRAM)) { f5Exit(f.docker.containers.get(id('a'))); throw f5DeadlineError(); } };
    await assert.rejects(onboardWho('setup', f.deps), { code: 'who_runtime_exited' });
    const previous = read(f.directory, 'installation.json'); f.docker.calls.length = 0;
    f.deps.ask = async () => 's';
    await assert.rejects(onboardWho('qualify', f.deps), { code: 'who_runtime_exited' });
    const next = read(f.directory, 'installation.json');
    assert.equal(next.installationId, previous.installationId); assert.equal(next.containerId, previous.containerId);
    assert.equal(next.qualificationAttempt.previousAttemptId, previous.qualificationAttempt.attemptId);
    assert.equal(f.docker.calls.filter(a => a.includes('start')).length, 1);
    assert.equal(f.docker.calls.some(a => a.includes('pull') || a.includes('create') || a.includes('cp') || a.includes('rm')), false);
    assert.equal(next.qualificationAttempt.snapshot, undefined); assert.equal(next.qualificationAttempt.complete, false);
});

test('F5 unresolved interrupted resource references are preserved and require review before a new attempt', async t => {
    const options = { execError: f5DeadlineError() }, f = fixture(t, options);
    await assert.rejects(onboardWho('setup', f.deps), { code: 'relay_deadline_unverified' });
    const saved = read(f.directory, 'installation.json');
    saved.qualificationAttempt.restoredContainerId = id('f'); // Explicit synthetic unresolved reference; never adopted.
    writeFileSync(path.join(f.directory, 'installation.json'), JSON.stringify(saved), { mode: 0o600 });
    f.docker.calls.length = 0; f.deps.ask = async () => 's';
    await assert.rejects(onboardWho('qualify', f.deps), { code: 'incomplete_attempt_requires_review' });
    assert.deepEqual(read(f.directory, 'installation.json').qualificationAttempt, saved.qualificationAttempt);
    noMutation(f.docker.calls);
});
