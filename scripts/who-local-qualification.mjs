/* @Codex: fixed host-only qualification of resources created by this installer. */
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, chmodSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { assertPrivateFile, assertSameEngine, checkCancelled, engineArchitecture, ensurePrivateDirectory, inspectLocalEngine, localDockerEndpoint, safeDatasetName, validEngineBinding } from './who-local-platform.mjs';
import { runDocker } from './who-local-setup.mjs';
import { PROBE_TERMS, probePath, readWhoProbe, validateProbeBody } from './who-local-probe.mjs';
import { MAC_ACCESS_TOPOLOGY, MAC_QUALIFICATION_SCHEMA, EXEC_TRANSPORT, EXEC_PREREQUISITE,
    checkWhoExecTools, exchangeWhoExec, openWhoLoopback, runDockerAsync } from './who-local-loopback.mjs';

export const OWNER_LABEL = 'org.mediflow.who-installation';
const idPattern = /^[0-9a-f]{64}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
export function qualificationError(code, cause) { const e = new Error(code); e.code = code; if (cause) e.cause = cause; return e; }
export const QUALIFICATION_SCHEMA = 'mediflow.who-owned-qualification.v3';
export const isMacAccess = state => state.engineBinding?.hostPlatform === 'darwin';
export const qualificationSchemaFor = state => isMacAccess(state) ? MAC_QUALIFICATION_SCHEMA : QUALIFICATION_SCHEMA;
export function failureCause(error) {
    const result = { code: /^[a-z_]{1,64}$/u.test(error?.code ?? '') ? error.code : 'qualification_failed' };
    const details = error?.details ?? error ?? {};
    if (Number.isInteger(details.exitCode ?? error?.exitCode)) result.exitCode = details.exitCode ?? error.exitCode;
    if (Number.isInteger(details.status)) result.status = details.status;
    if (Number.isInteger(details.timeoutMs)) result.timeoutMs = details.timeoutMs;
    // F5: closed scalar projection only. No raw State.Error, logs, URLs or env.
    for (const key of ['oomKilled', 'runtimeError']) if (typeof details[key] === 'boolean') result[key] = details[key];
    for (const key of ['restartCount', 'attempts', 'budgetMs']) if (Number.isSafeInteger(details[key]) && details[key] >= 0) result[key] = details[key];
    if (['created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead'].includes(details.runtimeStatus)) result.runtimeStatus = details.runtimeStatus;
    if (details.runtimeCause === 'undetermined') result.runtimeCause = 'undetermined';
    if (/^[a-zA-Z0-9_.-]{1,64}$/u.test(details.executable ?? '')) result.executable = details.executable;
    if (/^[A-Z0-9_]{1,48}$/u.test(details.systemCode ?? '')) result.systemCode = details.systemCode;
    return result;
}
const deny = code => { throw qualificationError(code); };
export const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
export async function hashFile(filename) {
    const h = createHash('sha256');
    for await (const bytes of createReadStream(filename)) h.update(bytes);
    return `sha256:${h.digest('hex')}`;
}
export function parseMetadata(raw) {
    try { return JSON.parse(raw); } catch { deny('metadata_unreadable'); }
}
export function scopedDocker(state, run = runDocker) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/u.test(state.context) || !uuidPattern.test(state.installationId)) deny('installation_invalid');
    if (state.schemaVersion === 'mediflow.who-installation.v2' && !validEngineBinding(state.engineBinding)) deny('installation_invalid');
    return (args, timeout) => {
        if (state.engineBinding) {
            const host = { platform: state.engineBinding.hostPlatform, arch: state.engineBinding.hostArch };
            assertSameEngine(state.engineBinding, inspectLocalEngine(state.context, run, host));
        }
        return run(['--context', state.context, ...args], timeout);
    };
}
export const OWNED_CONTAINER_FORMAT = `{"id":{{json .Id}},"owner":{{json (index .Config.Labels "${OWNER_LABEL}")}},"image":{{json .Config.Image}},"running":{{json .State.Running}},"mounts":{{len .Mounts}},"privileged":{{json .HostConfig.Privileged}},"restart":{{json .HostConfig.RestartPolicy.Name}},"networks":{{json .NetworkSettings.Networks}},"ports":{{json .NetworkSettings.Ports}},"requestedPorts":{{json .HostConfig.PortBindings}},"startedAt":{{json .State.StartedAt}},"restartCount":{{json .RestartCount}},"pid":{{json .State.Pid}},"capAdd":{{json .HostConfig.CapAdd}},"status":{{json .State.Status}},"exitCode":{{json .State.ExitCode}},"oomKilled":{{json .State.OOMKilled}},"finishedAt":{{json .State.FinishedAt}},"runtimeError":{{ne .State.Error ""}}}`;
export function validateOwnedContainer(state, id, c, expectedRunning) {
    if (!idPattern.test(id)) deny('container_ownership_invalid');
    if (!c || typeof c !== 'object' || c.id !== id || c.owner !== state.installationId || c.image !== state.image
        || c.mounts !== 0 || c.privileged !== false || c.restart !== 'no'
        || (expectedRunning !== undefined && c.running !== expectedRunning)
        || !c.networks || typeof c.networks !== 'object' || Array.isArray(c.networks)) deny('container_ownership_invalid');
    return c;
}
export function assertOwnedContainer(state, id, command, expectedRunning) {
    if (!idPattern.test(id)) deny('container_ownership_invalid');
    return validateOwnedContainer(state, id, parseMetadata(command(['container', 'inspect', id, '--format', OWNED_CONTAINER_FORMAT])), expectedRunning);
}
// Check locally observed image metadata before creating or requalifying owned resources.
export function assertPinnedImage(state, command) {
    const image = parseMetadata(command(['image', 'inspect', state.image, '--format', '{"digests":{{json .RepoDigests}},"os":{{json .Os}},"arch":{{json .Architecture}}}']));
    if (image.os !== 'linux' || `linux/${engineArchitecture(image.arch)}` !== (state.platform ?? 'linux/arm64')
        || !Array.isArray(image.digests) || !image.digests.includes(state.image)) deny('image_binding_mismatch');
}
export function createOwnedContainerArgs(state, name, network, publish) {
    if (!uuidPattern.test(state.installationId) || !/^mediflow-who-[a-z0-9-]+$/u.test(name)
        || !(network === 'bridge' || /^mediflow-who-check-[a-f0-9-]+$/u.test(network))
        || !/^whoicd\/icd-api@sha256:[a-f0-9]{64}$/u.test(state.image)) deny('installation_invalid');
    const platform = state.platform ?? 'linux/arm64';
    if (!['linux/arm64', 'linux/amd64'].includes(platform)
        || (state.engineBinding && state.engineBinding.platform !== platform)
        || (platform !== 'linux/arm64' && state.schemaVersion !== 'mediflow.who-installation.v2')) deny('installation_invalid');
    const effectivePublish = isMacAccess(state) ? false : publish;
    return ['container', 'create', '--name', name, '--platform', platform, '--network', network,
        '--label', `${OWNER_LABEL}=${state.installationId}`, '--restart', 'no',
        ...(effectivePublish === true ? ['--publish', '127.0.0.1:8382:80'] : effectivePublish === 'ephemeral' ? ['--publish', '127.0.0.1::80'] : []), '--env', 'acceptLicense=true',
        '--env', 'include=2026-01_en', '--env', 'saveAnalytics=false', '--env', 'enableDoris=false',
        '--env', 'fhirSupport=false', state.image];
}
export function assertProbeEngine(command) {
    // Older engines have documented loopback port-publishing limitations. No upgrade is attempted.
    const version = command(['version', '--format', '{{.Server.Version}}']);
    if (!/^(?:[2-9][0-9]|[1-9][0-9]{2,})\.[0-9]+\.[0-9]+(?:[-+][a-zA-Z0-9._-]+)?$/u.test(version)
        || Number(version.split('.')[0]) < 28) deny('docker_loopback_prerequisite');
    return version;
}
const networkOptions = Object.freeze({
    'com.docker.network.bridge.gateway_mode_ipv4': 'nat',
    'com.docker.network.bridge.host_binding_ipv4': '127.0.0.1',
});
export function validOwnedNetwork(record) {
    return record && idPattern.test(record.id) && /^mediflow-who-check-[a-f0-9-]{36}$/u.test(record.name)
        && Object.keys(record).length === 2;
}
export const OWNED_NETWORK_FORMAT = `{"id":{{json .Id}},"name":{{json .Name}},"driver":{{json .Driver}},"scope":{{json .Scope}},"internal":{{json .Internal}},"ipv6":{{json .EnableIPv6}},"owner":{{json (index .Labels "${OWNER_LABEL}")}},"options":{{json .Options}},"containers":{{json .Containers}}}`;
export function validateOwnedNetwork(state, record, n) {
    if (!validOwnedNetwork(record)) deny('offline_network_mismatch');
    if (!n || typeof n !== 'object' || n.id !== record.id || n.name !== record.name || n.driver !== 'bridge' || n.scope !== 'local'
        || n.internal !== true || n.ipv6 !== false || n.owner !== state.installationId
        || !n.options || Object.keys(n.options).length !== Object.keys(networkOptions).length
        || Object.entries(networkOptions).some(([key, value]) => n.options[key] !== value)
        || !n.containers || typeof n.containers !== 'object' || Array.isArray(n.containers)) deny('offline_network_mismatch');
    const allowed = new Set([state.containerId, state.qualificationAttempt?.restoredContainerId]);
    if (Object.keys(n.containers).some(id => !idPattern.test(id) || !allowed.has(id))) deny('network_foreign_member');
    return n;
}
export function assertOwnedNetwork(state, record, command) {
    if (!validOwnedNetwork(record)) deny('offline_network_mismatch');
    return validateOwnedNetwork(state, record, parseMetadata(command(['network', 'inspect', record.id, '--format', OWNED_NETWORK_FORMAT])));
}
function recordedNetwork(state, id) {
    const records = [state.offlineNetwork, state.qualificationAttempt?.offlineNetwork, state.qualificationAttempt?.previousOfflineNetwork];
    return records.find(record => validOwnedNetwork(record) && record.id === id);
}
export function assertOwnedTopology(state, container, command, allowAcquisition = false) {
    const attached = Object.entries(container.networks);
    if (attached.length !== 1) deny('original_network_mismatch');
    if (allowAcquisition && container.id === state.containerId && attached[0][0] === 'bridge') return null;
    const record = recordedNetwork(state, attached[0][1]?.NetworkID);
    if (!record) deny('offline_network_mismatch');
    assertOwnedNetwork(state, record, command);
    return record;
}
// F5 diagnostic reads are not authority for EXEC or availability. Expected-running
// guards on every real operation remain unchanged. Never read raw logs or Env here.
export function observeOwnedRuntime(state, id, kind, command) {
    if (!isMacAccess(state) || !Object.hasOwn(PROBE_TERMS, kind)
        || (kind === 'restored' ? id !== state.qualificationAttempt?.restoredContainerId : id !== state.containerId)) deny('probe_binding_invalid');
    const c = assertOwnedContainer(state, id, command);
    assertOwnedTopology(state, c, command, kind === 'acquisition');
    if (c.capAdd !== null && (!Array.isArray(c.capAdd) || c.capAdd.length)) deny('container_ownership_invalid');
    if (!['created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead'].includes(c.status)
        || typeof c.running !== 'boolean' || typeof c.oomKilled !== 'boolean' || typeof c.runtimeError !== 'boolean'
        || !Number.isInteger(c.exitCode) || c.exitCode < 0 || c.exitCode > 255
        || !Number.isSafeInteger(c.restartCount) || c.restartCount < 0
        || !Number.isSafeInteger(c.pid) || c.pid < 0 || (c.running && c.pid === 0)
        || typeof c.startedAt !== 'string' || !Number.isFinite(Date.parse(c.startedAt))
        || typeof c.finishedAt !== 'string' || !Number.isFinite(Date.parse(c.finishedAt))
        || (c.status === 'running' && !c.running)
        || (['created', 'exited', 'dead'].includes(c.status) && c.running)
        || (c.running && Date.parse(c.startedAt) <= 0)
        || (['exited', 'dead'].includes(c.status) && Date.parse(c.finishedAt) < Date.parse(c.startedAt))) deny('runtime_evidence_invalid');
    return { status: c.status, running: c.running, exitCode: c.exitCode, oomKilled: c.oomKilled,
        runtimeError: c.runtimeError, restartCount: c.restartCount, pid: c.pid,
        startedAt: c.startedAt, finishedAt: c.finishedAt, runtimeCause: 'undetermined',
        epochSha256: sha256(JSON.stringify({ containerId: id, installationId: state.installationId,
            image: state.image, engineBinding: state.engineBinding, startedAt: c.startedAt, restartCount: c.restartCount })) };
}
function requireRuntimeRunning(observation, cause) {
    if (observation.running && observation.status === 'running') return;
    const code = ['exited', 'dead'].includes(observation.status) ? 'who_runtime_exited' : 'who_runtime_not_running';
    const error = qualificationError(code, cause);
    error.details = { exitCode: observation.exitCode, oomKilled: observation.oomKilled,
        runtimeError: observation.runtimeError, restartCount: observation.restartCount,
        runtimeStatus: observation.status, runtimeCause: 'undetermined' };
    error.runtimeObservation = observation;
    throw error;
}
async function withOwnedRuntime(state, id, kind, command, operation, signal, expected) {
    checkCancelled(signal);
    const before = observeOwnedRuntime(state, id, kind, command);
    if (expected && (expected.epochSha256 !== before.epochSha256 || (before.running && expected.pid !== before.pid))) deny('probe_binding_changed');
    requireRuntimeRunning(before);
    let result, operationError;
    try { result = await operation(); } catch (error) { operationError = error; }
    checkCancelled(signal);
    // Observe even after a failed capability/HTTP call. An unchanged live process
    // keeps that failure; a same-epoch exit explains why its EXEC got interrupted.
    const after = observeOwnedRuntime(state, id, kind, command);
    if (after.epochSha256 !== before.epochSha256 || (after.running && before.pid !== after.pid))
        throw qualificationError('probe_binding_changed', operationError);
    requireRuntimeRunning(after, operationError);
    if (operationError) throw operationError;
    return result;
}

export function inspectProbeBinding(state, id, kind, command) {
    if (!Object.hasOwn(PROBE_TERMS, kind)) deny('probe_invalid');
    if (kind === 'restored' ? id !== state.qualificationAttempt?.restoredContainerId : id !== state.containerId) deny('probe_binding_invalid');
    const c = assertOwnedContainer(state, id, command, true);
    assertOwnedTopology(state, c, command, kind === 'acquisition');
    const entries = c.ports?.['80/tcp'], requested = c.requestedPorts?.['80/tcp'];
    if (!Array.isArray(entries) || entries.length !== 1 || entries[0].HostIp !== '127.0.0.1'
        || !/^[1-9][0-9]{0,4}$/u.test(entries[0].HostPort) || Number(entries[0].HostPort) > 65535
        || Object.entries(c.ports).some(([key, value]) => key !== '80/tcp' && value !== null)
        || !Array.isArray(requested) || requested.length !== 1 || requested[0].HostIp !== '127.0.0.1'
        || Object.keys(c.requestedPorts).some(key => key !== '80/tcp')
        || (id === state.containerId && (entries[0].HostPort !== '8382' || requested[0].HostPort !== '8382'))
        || (id !== state.containerId && (entries[0].HostPort === '8382' || !['', '0', entries[0].HostPort].includes(requested[0].HostPort)))) {
        deny('probe_endpoint_unavailable');
    }
    if (typeof c.startedAt !== 'string' || c.startedAt.length > 64 || !Number.isFinite(Date.parse(c.startedAt))
        || Date.parse(c.startedAt) <= 0 || !Number.isInteger(c.restartCount) || c.restartCount < 0
        || !Number.isInteger(c.pid) || c.pid <= 0) deny('probe_binding_invalid');
    const networks = Object.entries(c.networks).sort(([a], [b]) => a.localeCompare(b));
    const port = Number(entries[0].HostPort);
    return { port, endpoint: `http://127.0.0.1:${port}`, startedAt: c.startedAt,
        bindingSha256: sha256(JSON.stringify({ installationId: state.installationId, containerId: id, image: state.image,
            engineBinding: state.engineBinding, port, startedAt: c.startedAt, restartCount: c.restartCount, pid: c.pid, networks })) };
}
// The async bridge uses an exact endpoint, not a mutable context, for every Docker operation.
// Pure validators above are shared with the existing synchronous mutation/cleanup gates.
export async function inspectMacLoopbackTarget(state, id, kind, run = runDockerAsync, signal, allowPublished = false) {
    checkCancelled(signal);
    if (!isMacAccess(state) || !validEngineBinding(state.engineBinding) || !uuidPattern.test(state.installationId)
        || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/u.test(state.context)
        || ![...Object.keys(PROBE_TERMS), 'application'].includes(kind)
        || (kind === 'restored' ? id !== state.qualificationAttempt?.restoredContainerId : id !== state.containerId)) deny('probe_binding_invalid');
    const text = async args => {
        const raw = await run(args, { signal, maxBytes: 65536 });
        checkCancelled(signal);
        return Buffer.isBuffer(raw) ? new TextDecoder('utf-8', { fatal: true }).decode(raw).trim() : String(raw).trim();
    };
    const endpoint = await text(['context', 'inspect', state.context, '--format', '{{.Endpoints.docker.Host}}']);
    if (!localDockerEndpoint(endpoint, 'darwin') || sha256(endpoint) !== state.engineBinding.endpointSha256) deny('engine_identity_changed');
    const command = args => text(['--host', endpoint, ...args]);
    const engine = parseMetadata(await command(['info', '--format', '{"os":{{json .OSType}},"arch":{{json .Architecture}},"id":{{json .ID}}}']));
    if (engine.os !== 'linux' || typeof engine.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9:._-]{7,127}$/u.test(engine.id)) deny('engine_identity_changed');
    assertSameEngine(state.engineBinding, { hostPlatform: 'darwin', hostArch: state.engineBinding.hostArch,
        platform: `linux/${engineArchitecture(engine.arch)}`, endpointSha256: sha256(endpoint), daemonIdSha256: sha256(engine.id) });
    const c = validateOwnedContainer(state, id, parseMetadata(await command(['container', 'inspect', id, '--format', OWNED_CONTAINER_FORMAT])), true);
    if (c.capAdd !== null && (!Array.isArray(c.capAdd) || c.capAdd.length)) deny('container_ownership_invalid');
    const attached = Object.entries(c.networks);
    if (attached.length !== 1) deny('original_network_mismatch');
    let isolation;
    if (!(kind === 'acquisition' && id === state.containerId && attached[0][0] === 'bridge')) {
        const record = recordedNetwork(state, attached[0][1]?.NetworkID);
        if (!record) deny('offline_network_mismatch');
        validateOwnedNetwork(state, record, parseMetadata(await command(['network', 'inspect', record.id, '--format', OWNED_NETWORK_FORMAT])));
        const routes = await command(['exec', id, 'cat', '/proc/net/route']);
        const ipv6Routes = await command(['exec', id, 'cat', '/proc/net/ipv6_route']);
        isolation = { networkId: record.id, internal: true, ipv6: false, ...validateOfflineRoutes(routes, ipv6Routes) };
    }
    // Absence of native publication is NOT a valid listener. The Node bind + real EXEC
    // response supplies that proof later. Keep a legacy request only if exactly loopback.
    const activePorts = Object.values(c.ports ?? {}).some(value => value !== null);
    if (activePorts && !allowPublished) deny('relay_native_publication_conflict');
    const requested = c.requestedPorts ?? {};
    if (Object.keys(requested).length && (id !== state.containerId || Object.keys(requested).length !== 1
        || !Array.isArray(requested['80/tcp']) || requested['80/tcp'].length !== 1
        || requested['80/tcp'][0].HostIp !== '127.0.0.1' || requested['80/tcp'][0].HostPort !== '8382')) deny('probe_binding_invalid');
    if (typeof c.startedAt !== 'string' || !Number.isFinite(Date.parse(c.startedAt)) || Date.parse(c.startedAt) <= 0
        || !Number.isInteger(c.pid) || c.pid <= 0 || !Number.isInteger(c.restartCount) || c.restartCount < 0) deny('probe_binding_invalid');
    const bindingSha256 = sha256(JSON.stringify({ installationId: state.installationId, containerId: id, image: state.image,
        engineBinding: state.engineBinding, startedAt: c.startedAt, restartCount: c.restartCount, pid: c.pid,
        networks: Object.entries(c.networks).sort(([a], [b]) => a.localeCompare(b)), requestedPorts: requested, ports: c.ports ?? {}, capAdd: c.capAdd }));
    return { endpoint, containerId: id, bindingSha256, startedAt: c.startedAt, ...(isolation ? { isolation } : {}) };
}
export async function assertMacExecPrerequisites(state, id, dependencies = {}) {
    const run = dependencies.execDocker ?? runDockerAsync;
    const timeout = AbortSignal.timeout(5000);
    const signal = AbortSignal.any([timeout, ...(dependencies.signal ? [dependencies.signal] : [])]);
    try {
        const target = await inspectMacLoopbackTarget(state, id, 'acquisition', run, signal, true);
        await checkWhoExecTools(target, signal, run);
        const after = await inspectMacLoopbackTarget(state, id, 'acquisition', run, signal, true);
        if (after.bindingSha256 !== target.bindingSha256) deny('probe_binding_changed');
        return { contract: EXEC_PREREQUISITE, containerId: id, image: state.image };
    } catch (error) { if (timeout.aborted && !dependencies.signal?.aborted) deny('probe_timeout'); throw error; }
}
export function openMacLoopback(state, id, kind, dependencies = {}) {
    const run = dependencies.execDocker ?? runDockerAsync;
    return openWhoLoopback({ port: kind === 'restored' ? 0 : 8382, signal: dependencies.signal,
        inspect: signal => inspectMacLoopbackTarget(state, id, kind, run, signal),
        prerequisite: (target, signal) => checkWhoExecTools(target, signal, run),
        exchange: (target, requestPath, signal) => exchangeWhoExec(target, requestPath, signal, run) });
}
async function probeMacAccess(state, id, kind, command, options) {
    const access = await openMacLoopback(state, id, kind, options);
    try {
        let raw;
        try { raw = await (options.request ?? readWhoProbe)(access.port, kind, options.signal); }
        catch (error) { throw access.lastError ?? error; }
        checkCancelled(options.signal);
        if (access.lastError) throw access.lastError;
        const proof = access.lastObservation;
        if (!proof || proof.transport !== EXEC_TRANSPORT || proof.responseSha256 !== sha256(raw)
            || proof.requestPathSha256 !== sha256(probePath(kind)) || proof.port !== access.port) deny('probe_binding_invalid');
        const c = assertOwnedContainer(state, id, command, true);
        if (c.startedAt !== proof.startedAt) deny('probe_binding_changed');
        assertOwnedTopology(state, c, command, kind === 'acquisition');
        return { kind, installationId: state.installationId, containerId: id, engineBinding: state.engineBinding,
            observedAt: (options.now ?? (() => new Date().toISOString()))(), ...proof,
            resultCount: validateProbeBody(raw), responseSha256: sha256(raw) };
    } finally { await access.close(); }
}
export async function probeSearch(state, id, kind, command, options = {}) {
    checkCancelled(options.signal);
    if (isMacAccess(state)) {
        const c = assertOwnedContainer(state, id, command, true);
        if (kind !== 'acquisition' || !Array.isArray(c.ports?.['80/tcp'])) return probeMacAccess(state, id, kind, command, options);
    }
    const before = inspectProbeBinding(state, id, kind, command);
    const raw = await (options.request ?? readWhoProbe)(before.port, kind, options.signal);
    checkCancelled(options.signal);
    const after = inspectProbeBinding(state, id, kind, command);
    if (JSON.stringify(before) !== JSON.stringify(after)) deny('probe_binding_changed');
    const resultCount = validateProbeBody(raw);
    return { kind, installationId: state.installationId, containerId: id, engineBinding: state.engineBinding,
        observedAt: (options.now ?? (() => new Date().toISOString()))(), ...after,
        resultCount, responseSha256: sha256(raw), transport: 'node-http-loopback-v1' };
}
export const STARTUP_MAX_ATTEMPTS = 60;
export const STARTUP_BUDGET_MS = 15 * 60 * 1000;
export async function waitForSearch(state, id, kind, command, options = {}) {
    const wait = options.wait ?? delay;
    const mac = isMacAccess(state), clock = options.monotonicNow ?? (() => performance.now());
    const started = clock(), budget = mac ? AbortSignal.timeout(STARTUP_BUDGET_MS) : undefined;
    const signal = mac ? AbortSignal.any([budget, ...(options.signal ? [options.signal] : [])]) : options.signal;
    let lastError, attempts = 0, expectedRuntime;
    const elapsed = () => {
        const value = clock() - started;
        if (!Number.isFinite(value) || value < 0) deny('runtime_evidence_invalid');
        return value;
    };
    const exhausted = () => {
        const error = qualificationError('who_startup_budget_exhausted', lastError);
        error.details = { attempts, budgetMs: STARTUP_BUDGET_MS };
        throw error;
    };
    const check = () => {
        checkCancelled(options.signal);
        if (mac && (budget.aborted || elapsed() >= STARTUP_BUDGET_MS)) exhausted();
    };
    // Unchanged closed allowlist. In particular exit134 and relay137 are NOT retryable.
    const startup = new Set(['probe_connect_pending', 'probe_timeout', 'probe_service_starting']);
    for (let attempt = 0; attempt < STARTUP_MAX_ATTEMPTS; attempt++) {
        check(); attempts = attempt + 1;
        try {
            const probe = () => probeSearch(state, id, kind, command, { ...options, signal });
            if (mac && !expectedRuntime) expectedRuntime = observeOwnedRuntime(state, id, kind, command);
            const result = mac ? await withOwnedRuntime(state, id, kind, command, probe, signal, expectedRuntime) : await probe();
            check(); return result;
        } catch (error) {
            lastError = error; check();
            options.recordProbeFailure?.({ kind, attempt: attempts, cause: failureCause(error) });
            if (!startup.has(error.code)) throw error;
            if (attempts === STARTUP_MAX_ATTEMPTS) {
                if (mac) exhausted();
                throw qualificationError('dataset_not_ready', error);
            }
            try { await wait(mac ? Math.min(10000, STARTUP_BUDGET_MS - elapsed()) : 10000, undefined, { signal }); }
            catch (waitError) { check(); throw waitError; }
        }
    }
}
export function validateOfflineRoutes(routes, ipv6Routes) {
    if (typeof routes !== 'string' || Buffer.byteLength(routes) > 65536
        || typeof ipv6Routes !== 'string' || Buffer.byteLength(ipv6Routes) > 65536) deny('route_evidence_invalid');
    const lines = routes.trim().split('\n');
    if (lines.length < 2 || !lines[0].includes('Destination') || lines.slice(1).some(line => {
        const f = line.trim().split(/\s+/u);
        return f.length < 8 || ![f[1], f[2], f[7]].every(x => /^[a-fA-F0-9]{8}$/u.test(x))
            || f[2] !== '00000000' || (f[1] === '00000000' && f[7] === '00000000');
    })) deny('external_route_present');
    for (const line of ipv6Routes.trim().split('\n').filter(Boolean)) {
        const f = line.trim().split(/\s+/u);
        if (f.length !== 10 || ![f[0], f[2], f[4]].every(x => /^[a-fA-F0-9]{32}$/u.test(x))
            || !/^[a-fA-F0-9]{2}$/u.test(f[1]) || !/^[a-fA-F0-9]{8}$/u.test(f[8])) deny('route_evidence_invalid');
        const flags = Number.parseInt(f[8], 16), prefix = Number.parseInt(f[1], 16);
        // Linux's reject/unreachable default rows on lo are not routable defaults.
        const rejected = f[9] === 'lo' && (flags & 0x200) !== 0 && (flags & 1) === 0;
        const loopback = f[9] === 'lo' && f[0] === '0'.repeat(31) + '1' && prefix === 128;
        const linkLocal = /^fe[89ab]/iu.test(f[0]) && prefix >= 10 && prefix <= 128;
        if ((!rejected && !loopback && !linkLocal) || f[4] !== '0'.repeat(32)) deny('external_route_present');
    }
    return { noDefaultRoute: true, noRoutedEgress: true, routesSha256: sha256(routes), ipv6RoutesSha256: sha256(ipv6Routes) };
}
export function assertOffline(state, id, record, command) {
    const c = assertOwnedContainer(state, id, command, true);
    const attached = Object.values(c.networks);
    if (attached.length !== 1 || attached[0].NetworkID !== record?.id) deny('offline_network_mismatch');
    assertOwnedNetwork(state, record, command);
    const routes = command(['exec', id, 'cat', '/proc/net/route']);
    assertOwnedContainer(state, id, command, true);
    const ipv6Routes = command(['exec', id, 'cat', '/proc/net/ipv6_route']);
    const proof = validateOfflineRoutes(routes, ipv6Routes);
    const after = assertOwnedContainer(state, id, command, true);
    if (JSON.stringify(after.networks) !== JSON.stringify(c.networks) || after.startedAt !== c.startedAt) deny('offline_network_mismatch');
    assertOwnedNetwork(state, record, command);
    return { networkId: record.id, internal: true, ipv6: false, ...proof };
}
export function inspectDatasetMetadata(state, id, files, command) {
    assertOwnedContainer(state, id, command, true);
    if (!Array.isArray(files) || files.length !== 5 || new Set(files).size !== 5 || !files.every(safeDatasetName)) deny('dataset_metadata_invalid');
    return files.map(name => {
        assertOwnedContainer(state, id, command, true);
        const raw = command(['exec', id, 'stat', '-c', '%u %g %a %s %F', '--', `/tmp/${name}`]);
        const match = /^0 0 644 ([1-9][0-9]*) regular file$/u.exec(raw);
        const bytes = match && Number(match[1]);
        if (!Number.isSafeInteger(bytes) || bytes > 1024 * 1024 * 1024) deny('dataset_metadata_invalid');
        return { relativePath: name, bytes, uid: 0, gid: 0, mode: '0644' };
    });
}
export async function inventorySnapshot(directory, metadata) {
    const files = [];
    if (!Array.isArray(metadata) || metadata.length !== 5 || new Set(metadata.map(item => item.relativePath)).size !== 5) deny('dataset_metadata_invalid');
    for (const item of metadata) {
        if (!safeDatasetName(item.relativePath) || item.uid !== 0 || item.gid !== 0 || item.mode !== '0644') deny('dataset_metadata_invalid');
        const filename = path.join(directory, item.relativePath);
        let stat;
        try { stat = assertPrivateFile(filename, { maxBytes: 1024 * 1024 * 1024, payload: true }); } catch { deny('snapshot_file_invalid'); }
        if (stat.size !== item.bytes) deny('snapshot_file_invalid');
        files.push({ ...item, sha256: await hashFile(filename) });
    }
    const inventory = { schemaVersion: 'mediflow.who-owned-snapshot.v1', include: '2026-01_en', files };
    const serialized = `${JSON.stringify(inventory)}\n`;
    return { inventory, serialized, snapshotInventorySha256: sha256(serialized),
        snapshotId: sha256(JSON.stringify(files.map(({ relativePath, sha256: hash, bytes }) => ({ relativePath, sha256: hash, bytes })))) };
}

export async function qualifyOwnedDeployment(state, lock, directory, dependencies = {}) {
    const command = scopedDocker(state, dependencies.run);
    const check = () => checkCancelled(dependencies.signal);
    const now = dependencies.now ?? (() => new Date().toISOString());
    const report = dependencies.report ?? (() => {});
    const persist = dependencies.persist ?? (() => {});
    const previousAttempt = state.qualificationAttempt;
    // Do not discard the only authority for unresolved interrupted resources.
    if (isMacAccess(state) && previousAttempt &&
        ((previousAttempt.offlineNetwork && previousAttempt.offlineNetwork.id !== state.offlineNetwork?.id)
            || (previousAttempt.restoredContainerId && previousAttempt.restoreStopped !== true))) deny('incomplete_attempt_requires_review');
    const attemptId = randomUUID();
    const networkName = `mediflow-who-check-${attemptId}`;
    const restoreName = `mediflow-who-restore-${attemptId}`;
    const snapshotDirectory = path.join(directory, `snapshot-${attemptId}`);
    ensurePrivateDirectory(directory); ensurePrivateDirectory(snapshotDirectory);
    const previousOfflineNetwork = state.offlineNetwork;
    const receipt = { schemaVersion: qualificationSchemaFor(state), ...(isMacAccess(state) ? { accessTopology: MAC_ACCESS_TOPOLOGY } : {}), installationId: state.installationId,
        engineBinding: state.engineBinding, attemptId, originalContainerId: state.containerId, image: state.image,
        startedAt: now(), complete: false, probeFailures: [],
        ...(isMacAccess(state) && uuidPattern.test(previousAttempt?.attemptId ?? '') ? { previousAttemptId: previousAttempt.attemptId } : {}),
        ...(previousOfflineNetwork ? { previousOfflineNetwork } : {}) };
    state.qualificationAttempt = receipt;
    const save = phase => persist({ ...state, qualificationAttempt: receipt, phase: phase ?? 'qualification_required' });
    const recordProbeFailure = entry => { receipt.probeFailures.push({ ...entry, observedAt: now() }); save(); };
    const probeOptions = { ...dependencies, now, recordProbeFailure };
    // A cancelled operation does not restart polling for recovery. Stop and retain instead.
    save();
    let offlineNetwork, restoreId, result, failure, recoveryFailure, activeKind = 'acquisition';
    const stopOwned = id => {
        const c = assertOwnedContainer(state, id, command);
        if (Object.entries(c.networks).some(([name, n]) =>
            !(id === state.containerId && name === 'bridge')
            && n?.NetworkID !== offlineNetwork?.id && n?.NetworkID !== previousOfflineNetwork?.id)) deny('original_network_mismatch');
        for (const record of [offlineNetwork, previousOfflineNetwork]) {
            if (record && Object.values(c.networks).some(n => n.NetworkID === record.id)) assertOwnedNetwork(state, record, command);
        }
        if (c.running) {
            const output = command(['container', 'stop', '--timeout', '30', id], 40000); // @Codex: current Docker option, exact ID confirmation retained.
            if (output !== id) deny('container_stop_unconfirmed');
            assertOwnedContainer(state, id, command, false);
        }
    };
    const restartOriginal = () => {
        assertOffline(state, state.containerId, offlineNetwork, command);
        stopOwned(state.containerId);
        assertOwnedContainer(state, state.containerId, command, false);
        assertOwnedNetwork(state, offlineNetwork, command);
        command(['container', 'start', state.containerId], 30000);
        assertOffline(state, state.containerId, offlineNetwork, command);
    };
    try {
        check(); receipt.dockerServerVersion = assertProbeEngine(command); save();
        const initial = assertOwnedContainer(state, state.containerId, command, isMacAccess(state) ? undefined : true);
        const prior = assertOwnedTopology(state, initial, command, true);
        if (prior && prior.id !== previousOfflineNetwork?.id) deny('original_network_mismatch');
        if (isMacAccess(state)) {
            const priorRuntime = observeOwnedRuntime(state, state.containerId, 'acquisition', command);
            receipt.startup = { priorStatus: priorRuntime.status, startAttempted: false }; save();
            if (!priorRuntime.running) {
                check(); receipt.startup.startAttempted = true; save();
                let startedId;
                try { startedId = command(['container', 'start', state.containerId], 30000); }
                catch (error) {
                    if (['docker_unavailable'].includes(error.code)) throw qualificationError('start_failed', error);
                    throw error;
                }
                if (startedId !== state.containerId) deny('start_unconfirmed');
                check();
            }
            requireRuntimeRunning(observeOwnedRuntime(state, state.containerId, 'acquisition', command));
            state.phase = 'started'; save('started');
            report('Avvio WHO osservato; attendo una risposta reale. Un arresto del processo interrompe il tentativo, senza riavvii automatici.');
            receipt.execPrerequisites = await withOwnedRuntime(state, state.containerId, 'acquisition', command,
                () => assertMacExecPrerequisites(state, state.containerId, dependencies), dependencies.signal);
            save(); check();
        }
        report('Controllo il catalogo scaricato…');
        receipt.acquisition = await waitForSearch(state, state.containerId, 'acquisition', command, probeOptions); save();
        check();
        const metadata = inspectDatasetMetadata(state, state.containerId, lock.datasetFiles, command);
        report('Preparo una copia locale di recupero…');
        check();
        stopOwned(state.containerId);
        for (const file of metadata) {
            check(); assertOwnedContainer(state, state.containerId, command, false);
            command(['cp', `${state.containerId}:/tmp/${file.relativePath}`, path.join(snapshotDirectory, file.relativePath)], 120000);
        }
        result = await inventorySnapshot(snapshotDirectory, metadata); check();
        writeFileSync(path.join(snapshotDirectory, 'inventory.json'), result.serialized, { flag: 'wx', mode: 0o600 });
        receipt.snapshot = { directory: path.basename(snapshotDirectory), snapshotId: result.snapshotId,
            inventorySha256: result.snapshotInventorySha256, fileCount: metadata.length, bytes: metadata.reduce((sum, f) => sum + f.bytes, 0) }; save();
        check();
        if (command(['network', 'ls', '--filter', `name=^${networkName}$`, '--format', '{{.ID}}'])) deny('network_name_conflict');
        const networkId = command(['network', 'create', '--driver', 'bridge', '--internal', '--ipv6=false',
            ...Object.entries(networkOptions).flatMap(([key, value]) => ['--opt', `${key}=${value}`]),
            '--label', `${OWNER_LABEL}=${state.installationId}`, networkName]);
        if (!idPattern.test(networkId)) deny('network_creation_failed');
        offlineNetwork = { id: networkId, name: networkName };
        receipt.offlineNetwork = offlineNetwork; receipt.networkId = networkId; save();
        // Record IDs before a cancellation boundary; never adopt a create with ambiguous output.
        check(); assertOwnedNetwork(state, offlineNetwork, command);
        assertOwnedContainer(state, state.containerId, command, false);
        command(['container', 'start', state.containerId], 30000);
        assertOwnedContainer(state, state.containerId, command, true);
        check(); assertOwnedNetwork(state, offlineNetwork, command);
        command(['network', 'connect', networkId, state.containerId]);
        const connected = assertOwnedContainer(state, state.containerId, command, true);
        const expectedOld = prior?.id ?? initial.networks.bridge.NetworkID;
        const ids = Object.values(connected.networks).map(n => n.NetworkID);
        if (ids.length !== 2 || !ids.includes(networkId) || !ids.includes(expectedOld)) deny('original_network_mismatch');
        assertOwnedNetwork(state, offlineNetwork, command);
        if (prior) assertOwnedNetwork(state, prior, command);
        command(['network', 'disconnect', prior?.id ?? 'bridge', state.containerId]);
        state.offlineNetwork = offlineNetwork; save();
        assertOffline(state, state.containerId, offlineNetwork, command);
        restartOriginal();
        activeKind = 'offline_restart';
        report('Verifico il riavvio senza connessione esterna…');
        receipt.offlineBefore = assertOffline(state, state.containerId, offlineNetwork, command);
        receipt.offlineRestart = await waitForSearch(state, state.containerId, 'offline_restart', command, probeOptions);
        check(); receipt.offlineAfter = assertOffline(state, state.containerId, offlineNetwork, command); save();
        activeKind = 'restored';
        report('Verifico il ripristino in una copia separata…');
        check(); assertOwnedNetwork(state, offlineNetwork, command);
        if (command(['container', 'ls', '--all', '--filter', `name=^/${restoreName}$`, '--format', '{{.Names}}'])) deny('container_ownership_invalid');
        restoreId = command(createOwnedContainerArgs(state, restoreName, networkName, 'ephemeral'));
        if (!idPattern.test(restoreId)) deny('restore_creation_failed');
        receipt.restoredContainerId = restoreId; save();
        for (const file of metadata) {
            check(); assertOwnedContainer(state, restoreId, command, false); assertOwnedNetwork(state, offlineNetwork, command);
            command(['cp', path.join(snapshotDirectory, file.relativePath), `${restoreId}:/tmp/${file.relativePath}`], 120000);
        }
        check(); assertOwnedContainer(state, restoreId, command, false); assertOwnedNetwork(state, offlineNetwork, command);
        command(['container', 'start', restoreId], 30000);
        if (state.engineBinding?.hostPlatform === 'win32') {
            // Existing explicit prerequisite, not inferred from WHO image metadata.
            for (const file of metadata) {
                check(); assertOffline(state, restoreId, offlineNetwork, command);
                command(['exec', restoreId, 'chown', '0:0', '--', `/tmp/${file.relativePath}`]);
                assertOwnedContainer(state, restoreId, command, true);
                command(['exec', restoreId, 'chmod', '0644', '--', `/tmp/${file.relativePath}`]);
            }
        }
        receipt.restoreOfflineBefore = assertOffline(state, restoreId, offlineNetwork, command);
        receipt.restore = await waitForSearch(state, restoreId, 'restored', command, probeOptions);
        check(); receipt.restoreOfflineAfter = assertOffline(state, restoreId, offlineNetwork, command);
        const restoredMetadata = inspectDatasetMetadata(state, restoreId, lock.datasetFiles, command);
        if (JSON.stringify(metadata) !== JSON.stringify(restoredMetadata)) deny('restore_metadata_mismatch');
        for (const file of result.inventory.files) {
            check(); assertOwnedContainer(state, restoreId, command, true);
            const hash = command(['exec', restoreId, 'sha256sum', '--', `/tmp/${file.relativePath}`]).split(/\s+/u)[0];
            if (`sha256:${hash}` !== file.sha256) deny('restore_hash_mismatch');
        }
        receipt.restoredHashesMatch = true; save();
        stopOwned(restoreId); receipt.restoreStopped = true; save();
        // Independent ORIGINAL recovery; no bridge reconnect or substitution of restore evidence.
        activeKind = 'original_recovered';
        check(); restartOriginal();
        receipt.originalOfflineBefore = assertOffline(state, state.containerId, offlineNetwork, command);
        receipt.originalRecoveredProbe = await waitForSearch(state, state.containerId, 'original_recovered', command, probeOptions);
        check(); receipt.originalOfflineAfter = assertOffline(state, state.containerId, offlineNetwork, command);
        const originalMetadata = inspectDatasetMetadata(state, state.containerId, lock.datasetFiles, command);
        if (JSON.stringify(metadata) !== JSON.stringify(originalMetadata)) deny('original_recovery_failed');
        for (const file of result.inventory.files) {
            check(); assertOwnedContainer(state, state.containerId, command, true);
            const hash = command(['exec', state.containerId, 'sha256sum', '--', `/tmp/${file.relativePath}`]).split(/\s+/u)[0];
            if (`sha256:${hash}` !== file.sha256) deny('original_recovery_failed');
        }
        receipt.originalHashesMatch = true; receipt.originalRecovered = true; save();
    } catch (error) {
        failure = error;
        // Capture this observation before stopOwned; cleanup exit status cannot
        // overwrite the independently observed startup/prerequisite failure.
        if (error.runtimeObservation) receipt.runtimeFailure = { ...error.runtimeObservation, kind: activeKind, observedAt: now() };
    }
    finally {
        if (failure) {
            // Never mask the first failure with cancellation/recovery. Cleanup is not qualification.
            for (const [id, key] of [[restoreId, 'restoreStopped'], [state.containerId, 'originalStoppedOnFailure']]) {
                if (!id) continue;
                try { stopOwned(id); receipt[key] = true; }
                catch (error) { recoveryFailure ??= 'owned_stop_failed'; receipt.cleanupFailures ??= []; receipt.cleanupFailures.push({ containerId: id, cause: failureCause(error) }); }
            }
        }
        receipt.completedAt = now();
        receipt.complete = !failure && !recoveryFailure && receipt.restoredHashesMatch === true && receipt.originalHashesMatch === true
            && receipt.originalRecovered === true && receipt.restoreStopped === true;
        if (failure) { receipt.failure = failureCause(failure).code; receipt.failureCause = failureCause(failure); if (failure.cause) receipt.lastProbeCause = failureCause(failure.cause); }
        if (recoveryFailure) receipt.recoveryFailure = recoveryFailure;
        writeFileSync(path.join(snapshotDirectory, 'qualification.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
        if (process.platform !== 'win32') chmodSync(snapshotDirectory, 0o700);
        ensurePrivateDirectory(snapshotDirectory); assertPrivateFile(path.join(snapshotDirectory, 'qualification.json'));
        save(receipt.complete ? 'qualified' : 'qualification_required');
    }
    if (!receipt.complete) {
        const error = qualificationError(receipt.failure ?? recoveryFailure ?? 'qualification_failed', failure);
        if (failure) error.details = failureCause(failure);
        throw error;
    }
    return { receipt, inventory: result.inventory, dataset: { include: '2026-01_en', snapshotId: result.snapshotId,
        snapshotInventorySha256: result.snapshotInventorySha256, offlineRestartVerified: true, restoreVerified: true } };
}
