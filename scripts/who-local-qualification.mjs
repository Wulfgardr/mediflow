/* @Codex: fixed host-only qualification of resources created by this installer. */
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, lstatSync, mkdirSync, chmodSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runDocker } from './who-local-setup.mjs';

export const OWNER_LABEL = 'org.mediflow.who-installation';
const idPattern = /^[0-9a-f]{64}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
export function qualificationError(code) { const e = new Error(code); e.code = code; return e; }
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
    return (args, timeout) => run(['--context', state.context, ...args], timeout);
}
export function assertOwnedContainer(state, id, command, expectedRunning) {
    if (!idPattern.test(id)) deny('container_ownership_invalid');
    const c = parseMetadata(command(['container', 'inspect', id, '--format', `{"id":{{json .Id}},"owner":{{json (index .Config.Labels "${OWNER_LABEL}")}},"image":{{json .Config.Image}},"running":{{json .State.Running}},"mounts":{{len .Mounts}},"privileged":{{json .HostConfig.Privileged}},"restart":{{json .HostConfig.RestartPolicy.Name}},"networks":{{json .NetworkSettings.Networks}}}`]));
    if (c.id !== id || c.owner !== state.installationId || c.image !== state.image
        || c.mounts !== 0 || c.privileged !== false || c.restart !== 'no'
        || (expectedRunning !== undefined && c.running !== expectedRunning)
        || !c.networks || typeof c.networks !== 'object') deny('container_ownership_invalid');
    return c;
}
export function createOwnedContainerArgs(state, name, network, publish) {
    if (!uuidPattern.test(state.installationId) || !/^mediflow-who-[a-z0-9-]+$/u.test(name)
        || !(network === 'bridge' || /^mediflow-who-check-[a-f0-9-]+$/u.test(network))
        || !/^whoicd\/icd-api@sha256:[a-f0-9]{64}$/u.test(state.image)) deny('installation_invalid');
    return ['container', 'create', '--name', name, '--platform', 'linux/arm64', '--network', network,
        '--label', `${OWNER_LABEL}=${state.installationId}`, '--restart', 'no',
        ...(publish ? ['--publish', '127.0.0.1:8382:80'] : []), '--env', 'acceptLicense=true',
        '--env', 'include=2026-01_en', '--env', 'saveAnalytics=false', '--env', 'enableDoris=false',
        '--env', 'fhirSupport=false', state.image];
}
const probeTerms = Object.freeze({ acquisition: 'cholera', offline_restart: 'measles', restored: 'rubella' });
export function probeSearch(state, id, kind, command, now = () => new Date().toISOString()) {
    if (!Object.hasOwn(probeTerms, kind)) deny('probe_invalid');
    assertOwnedContainer(state, id, command, true);
    const url = `http://127.0.0.1:80/icd/release/11/2026-01/mms/search?q=${probeTerms[kind]}&flatResults=true&highlightingEnabled=false&medicalCodingMode=true&includeKeywordResult=false`;
    const raw = command(['exec', id, 'curl', '--silent', '--show-error', '--fail', '--noproxy', '*', '--max-time', '5', '--max-filesize', '65536',
        '--header', 'API-Version: v2', '--header', 'Accept: application/json', '--header', 'Accept-Language: en', url], 8000);
    if (Buffer.byteLength(raw) > 65536) deny('probe_response_invalid');
    const body = parseMetadata(raw);
    if (!Array.isArray(body.destinationEntities) || !body.destinationEntities.length
        || body.destinationEntities.some(e => !e || typeof e.title !== 'string' || !e.title.trim()
            || typeof e.theCode !== 'string' || !e.theCode || typeof e.id !== 'string'
            || !e.id.startsWith('http://id.who.int/icd/release/11/2026-01/mms/'))) deny('probe_response_invalid');
    return { kind, containerId: id, observedAt: now(), resultCount: body.destinationEntities.length, responseSha256: sha256(raw) };
}
export async function waitForSearch(state, id, kind, command, options = {}) {
    const wait = options.wait ?? delay;
    const now = options.now ?? (() => new Date().toISOString());
    // Installer boot polling only; does not change the Application Service retry contract.
    for (let attempt = 0; attempt < 60; attempt++) {
        try { return probeSearch(state, id, kind, command, now); }
        catch (error) {
            if (['container_ownership_invalid', 'probe_response_invalid', 'probe_invalid'].includes(error.code)) throw error;
            if (attempt === 59) deny('dataset_not_ready');
            await wait(10000);
        }
    }
}
export function assertOffline(state, id, networkId, command) {
    const c = assertOwnedContainer(state, id, command, true);
    const attached = Object.values(c.networks);
    if (attached.length !== 1 || attached[0].NetworkID !== networkId) deny('offline_network_mismatch');
    const n = parseMetadata(command(['network', 'inspect', networkId, '--format', `{"id":{{json .Id}},"internal":{{json .Internal}},"ipv6":{{json .EnableIPv6}},"owner":{{json (index .Labels "${OWNER_LABEL}")}}}`]));
    if (n.id !== networkId || n.internal !== true || n.ipv6 !== false || n.owner !== state.installationId) deny('offline_network_mismatch');
    const routes = command(['exec', id, 'cat', '/proc/net/route']);
    const lines = routes.trim().split('\n');
    if (lines.length < 2 || !lines[0].includes('Destination') || lines.slice(1).some(line => {
        const fields = line.trim().split(/\s+/u); return fields.length < 8 || (fields[1] === '00000000' && fields[7] === '00000000');
    })) deny('external_route_present');
    return { networkId, internal: true, ipv6: false, noDefaultRoute: true, routesSha256: sha256(routes) };
}
export function inspectDatasetMetadata(state, id, files, command) {
    assertOwnedContainer(state, id, command, true);
    return files.map(name => {
        const raw = command(['exec', id, 'stat', '-c', '%u %g %a %s %F', '--', `/tmp/${name}`]);
        const match = /^0 0 644 ([1-9][0-9]*) regular file$/u.exec(raw);
        const bytes = match && Number(match[1]);
        if (!Number.isSafeInteger(bytes) || bytes > 1024 * 1024 * 1024) deny('dataset_metadata_invalid');
        return { relativePath: name, bytes, uid: 0, gid: 0, mode: '0644' };
    });
}
export async function inventorySnapshot(directory, metadata) {
    const files = [];
    for (const item of metadata) {
        const filename = path.join(directory, item.relativePath);
        const stat = lstatSync(filename);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== item.bytes || (stat.mode & 0o777) !== 0o644) deny('snapshot_file_invalid');
        files.push({ ...item, sha256: await hashFile(filename) });
    }
    const inventory = { schemaVersion: 'mediflow.who-owned-snapshot.v1', include: '2026-01_en', files };
    const serialized = `${JSON.stringify(inventory)}\n`;
    return { inventory, serialized, snapshotInventorySha256: sha256(serialized),
        snapshotId: sha256(JSON.stringify(files.map(({ relativePath, sha256: hash, bytes }) => ({ relativePath, sha256: hash, bytes })))) };
}

export async function qualifyOwnedDeployment(state, lock, directory, dependencies = {}) {
    const command = scopedDocker(state, dependencies.run);
    const now = dependencies.now ?? (() => new Date().toISOString());
    const report = dependencies.report ?? (() => {});
    const persist = dependencies.persist ?? (() => {});
    const attemptId = randomUUID();
    const networkName = `mediflow-who-check-${attemptId}`;
    const restoreName = `mediflow-who-restore-${attemptId}`;
    const snapshotDirectory = path.join(directory, `snapshot-${attemptId}`);
    mkdirSync(snapshotDirectory, { mode: 0o700 });
    const receipt = { schemaVersion: 'mediflow.who-owned-qualification.v1', installationId: state.installationId,
        attemptId, originalContainerId: state.containerId, image: state.image, startedAt: now(), complete: false };
    let networkId, restoreId, sourceTouched = false;
    let result, failure, recoveryFailure;
    try {
        const initial = assertOwnedContainer(state, state.containerId, command, true);
        if (Object.keys(initial.networks).length !== 1 || !initial.networks.bridge) deny('original_network_mismatch');
        report('Controllo il catalogo scaricato…');
        receipt.acquisition = await waitForSearch(state, state.containerId, 'acquisition', command, dependencies);
        const metadata = inspectDatasetMetadata(state, state.containerId, lock.datasetFiles, command);
        assertOwnedContainer(state, state.containerId, command, true);
        report('Preparo una copia locale di recupero…');
        sourceTouched = true;
        command(['container', 'stop', '--time', '30', state.containerId], 40000);
        assertOwnedContainer(state, state.containerId, command, false);
        for (const file of metadata) command(['cp', `${state.containerId}:/tmp/${file.relativePath}`, path.join(snapshotDirectory, file.relativePath)], 120000);
        result = await inventorySnapshot(snapshotDirectory, metadata);
        writeFileSync(path.join(snapshotDirectory, 'inventory.json'), result.serialized, { flag: 'wx', mode: 0o600 });
        receipt.snapshot = { directory: path.basename(snapshotDirectory), snapshotId: result.snapshotId,
            inventorySha256: result.snapshotInventorySha256, fileCount: metadata.length, bytes: metadata.reduce((sum, f) => sum + f.bytes, 0) };
        networkId = command(['network', 'create', '--internal', '--label', `${OWNER_LABEL}=${state.installationId}`, networkName]);
        if (!idPattern.test(networkId)) deny('network_creation_failed');
        receipt.networkId = networkId; persist({ ...state, qualificationAttempt: receipt });
        // Docker disconnect requires a running container. Attach the internal network,
        // detach bridge, then stop/start while internal-only to prove an offline restart.
        assertOwnedContainer(state, state.containerId, command, false);
        command(['container', 'start', state.containerId], 30000);
        assertOwnedContainer(state, state.containerId, command, true);
        command(['network', 'connect', networkId, state.containerId]);
        command(['network', 'disconnect', 'bridge', state.containerId]);
        assertOffline(state, state.containerId, networkId, command);
        command(['container', 'stop', '--time', '30', state.containerId], 40000);
        command(['container', 'start', state.containerId], 30000);
        report('Verifico il riavvio senza connessione esterna…');
        receipt.offlineBefore = assertOffline(state, state.containerId, networkId, command);
        receipt.offlineRestart = await waitForSearch(state, state.containerId, 'offline_restart', command, dependencies);
        receipt.offlineAfter = assertOffline(state, state.containerId, networkId, command);
        report('Verifico il ripristino in una copia separata…');
        restoreId = command(createOwnedContainerArgs(state, restoreName, networkName, false));
        if (!idPattern.test(restoreId)) deny('restore_creation_failed');
        receipt.restoredContainerId = restoreId; persist({ ...state, qualificationAttempt: receipt });
        assertOwnedContainer(state, restoreId, command, false);
        for (const file of metadata) command(['cp', path.join(snapshotDirectory, file.relativePath), `${restoreId}:/tmp/${file.relativePath}`], 120000);
        command(['container', 'start', restoreId], 30000);
        receipt.restoreOfflineBefore = assertOffline(state, restoreId, networkId, command);
        receipt.restore = await waitForSearch(state, restoreId, 'restored', command, dependencies);
        receipt.restoreOfflineAfter = assertOffline(state, restoreId, networkId, command);
        const restoredMetadata = inspectDatasetMetadata(state, restoreId, lock.datasetFiles, command);
        if (JSON.stringify(metadata) !== JSON.stringify(restoredMetadata)) deny('restore_metadata_mismatch');
        for (const file of result.inventory.files) {
            const hash = command(['exec', restoreId, 'sha256sum', '--', `/tmp/${file.relativePath}`]).split(/\s+/u)[0];
            if (`sha256:${hash}` !== file.sha256) deny('restore_hash_mismatch');
        }
        receipt.restoredHashesMatch = true;
    } catch (error) { failure = error; }
    finally {
        // Recover only resources proven to belong to this installation. Never rm/prune.
        try {
            if (restoreId && idPattern.test(restoreId)) {
                const c = assertOwnedContainer(state, restoreId, command);
                if (c.running) command(['container', 'stop', '--time', '30', restoreId], 40000);
            }
        } catch { recoveryFailure = 'restore_cleanup_failed'; }
        try {
            if (sourceTouched) {
                let c = assertOwnedContainer(state, state.containerId, command);
                const attachments = Object.entries(c.networks);
                if (attachments.some(([name, n]) => name !== 'bridge' && n.NetworkID !== networkId)) deny('original_recovery_failed');
                if (!c.running) command(['container', 'start', state.containerId], 30000);
                c = assertOwnedContainer(state, state.containerId, command, true);
                if (!c.networks.bridge) command(['network', 'connect', 'bridge', state.containerId]);
                if (networkId && Object.values(c.networks).some(n => n.NetworkID === networkId)) command(['network', 'disconnect', networkId, state.containerId]);
                command(['container', 'stop', '--time', '30', state.containerId], 40000);
                command(['container', 'start', state.containerId], 30000);
                const recovered = assertOwnedContainer(state, state.containerId, command, true);
                if (Object.keys(recovered.networks).length !== 1 || !recovered.networks.bridge) deny('original_recovery_failed');
                if (result) {
                    receipt.originalRecoveredProbe = await waitForSearch(state, state.containerId, 'acquisition', command, dependencies);
                    inspectDatasetMetadata(state, state.containerId, lock.datasetFiles, command);
                    for (const file of result.inventory.files) {
                        const hash = command(['exec', state.containerId, 'sha256sum', '--', `/tmp/${file.relativePath}`]).split(/\s+/u)[0];
                        if (`sha256:${hash}` !== file.sha256) deny('original_recovery_failed');
                    }
                    receipt.originalHashesMatch = true;
                }
                receipt.originalRecovered = true;
            }
        } catch { recoveryFailure = 'original_recovery_failed'; }
        receipt.completedAt = now();
        receipt.complete = !failure && !recoveryFailure && receipt.restoredHashesMatch === true && receipt.originalHashesMatch === true && receipt.originalRecovered === true;
        if (failure) receipt.failure = /^[a-z_]+$/u.test(failure.code ?? '') ? failure.code : 'qualification_failed';
        if (recoveryFailure) receipt.recoveryFailure = recoveryFailure;
        writeFileSync(path.join(snapshotDirectory, 'qualification.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
        // Snapshot payload files remain 0644 inside the enclosing private 0700 directory.
        chmodSync(snapshotDirectory, 0o700);
    }
    if (!receipt.complete) {
        persist({ ...state, qualificationAttempt: receipt, phase: 'qualification_required' });
        throw qualificationError(recoveryFailure ?? receipt.failure ?? 'qualification_failed');
    }
    persist({ ...state, qualificationAttempt: receipt, phase: 'qualified' });
    return { receipt, inventory: result.inventory, dataset: { include: '2026-01_en', snapshotId: result.snapshotId,
        snapshotInventorySha256: result.snapshotInventorySha256, offlineRestartVerified: true, restoreVerified: true } };
}
