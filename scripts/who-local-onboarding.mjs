/* @Codex: ordinary Mac ARM setup; all host authority remains in this CLI. */
import { randomUUID } from 'node:crypto';
import { validateWhoLocalManifest } from './check-who-local-sidecar-manifest.mjs';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configurationText, inspectStatus, localEngine, checkPort, runDocker, CONTAINER_NAME } from './who-local-setup.mjs';
import { assertOwnedContainer, createOwnedContainerArgs, qualifyOwnedDeployment, scopedDocker, sha256, qualificationError, waitForSearch } from './who-local-qualification.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const dataFileNames = new Set(['installation.json', 'manifest.json', 'license.json', 'who.env', 'Avvia MediFlow con WHO.command']);
const message = Object.freeze({
    host_unsupported: 'Questa procedura supporta macOS su Apple Silicon. Windows e Linux non sono ancora supportati.',
    docker_unavailable: 'Avvia Docker Desktop o il runtime Docker locale scelto, poi riapri Setup_WHO.command. Non modifico macchine virtuali.',
    local_context_required: 'Serve un contesto Docker locale. Avvia il runtime scelto, poi riapri questa procedura.',
    platform_mismatch: 'Il motore Docker deve essere Linux ARM64. Seleziona il runtime per Apple Silicon.',
    port_in_use: 'La porta WHO e gia occupata. Non modifico il servizio esistente. Se WHO funziona in MediFlow, non serve installarlo di nuovo; altrimenti chiedi al gestore di collegarlo.',
    cancelled: 'Operazione annullata. Nessuna nuova installazione autorizzata.',
    setup_busy: 'Un’altra procedura WHO e gia attiva. Attendi che termini. Se e stata interrotta, il gestore puo verificare il lock nella cartella privata.',
    private_state_invalid: 'La registrazione locale non e coerente. Conservo i file: serve una verifica del gestore.',
    release_lock_invalid: 'Il pacchetto WHO non supera la verifica di integrita. Ripristina i file distribuiti con MediFlow.',
    container_ownership_invalid: 'Il servizio non corrisponde a quello creato da questa procedura. Non viene modificato.',
    original_network_mismatch: 'La rete del servizio e cambiata. Conservo lo stato e fermo la qualifica.',
    dataset_not_ready: 'Il catalogo non risponde ancora. Conservo il download: riapri la procedura per riprendere i controlli.',
    qualification_required: 'Installazione presente, ma verifiche non complete. La configurazione resta disabilitata: riapri la procedura per riprendere.',
    qualification_failed: 'Una verifica non e riuscita. Conservo la copia di recupero e la prova incompleta; WHO non viene attivato.',
    original_recovery_failed: 'Il servizio creato non e tornato allo stato iniziale. Non attivo WHO: il gestore deve recuperare il solo servizio registrato.',
    restore_cleanup_failed: 'La copia di verifica non si e fermata correttamente. Non attivo WHO: il gestore deve controllare le risorse registrate.',
    probe_response_invalid: 'La risposta WHO non supera il controllo previsto. La configurazione resta disabilitata.',
    snapshot_file_invalid: 'La copia del catalogo non corrisponde ai file osservati. Non attivo WHO.',
    dataset_metadata_invalid: 'I file del catalogo hanno una struttura inattesa. Non attivo WHO.',
    restore_hash_mismatch: 'I file ripristinati differiscono dalla copia di recupero. Non attivo WHO.',
    restore_metadata_mismatch: 'I metadati dei file ripristinati non corrispondono. Non attivo WHO.',
    offline_network_mismatch: 'La rete della verifica non e isolata come previsto. Non attivo WHO.',
    external_route_present: 'La verifica ha rilevato una route esterna. Non attivo WHO.',
    pull_failed: 'Download immagine WHO non riuscito. Controlla la connessione e riapri la procedura: il consenso e lo stato preparato sono conservati. Non cambio il pin.',
    create_failed: 'Creazione del servizio WHO non confermata. Conservo la registrazione: controlla lo stato con il gestore prima di riprovare, senza rimuovere servizi.',
    start_failed: 'Avvio WHO non riuscito. Il servizio registrato è conservato: controlla Docker e riprendi la procedura.',
    app_launch_failed: 'Avvio di MediFlow non riuscito o interrotto. La configurazione WHO qualificata è conservata; riprova il launcher senza reinstallare WHO.',
    app_running: 'MediFlow e gia in esecuzione: non lo interrompo. Al prossimo avvio usa “Avvia MediFlow con WHO” nella cartella privata.',
});
export function friendlySetupMessage(error) { return message[error?.code] ?? message.qualification_failed; }
const deny = code => { throw qualificationError(code); };

export function readReleaseLock() {
    try {
        const lock = JSON.parse(readFileSync(new URL('../docs/who-local-release-lock.json', import.meta.url), 'utf8'));
        const indexBytes = readFileSync(new URL('../docs/who-lock-evidence/2.6.0-index.json', import.meta.url));
        const imageBytes = readFileSync(new URL('../docs/who-lock-evidence/2.6.0-arm64.json', import.meta.url));
        const evidenceBytes = readFileSync(new URL('../docs/who-lock-evidence/2.6.0-readback.json', import.meta.url));
        const index = JSON.parse(indexBytes), evidence = JSON.parse(evidenceBytes);
        if (lock.schemaVersion !== 'mediflow.who-release-lock.v1' || lock.repository !== 'whoicd/icd-api'
            || lock.version !== '2.6.0' || lock.platform !== 'linux/arm64' || lock.include !== '2026-01_en'
            || sha256(imageBytes) !== lock.imageDigest || sha256(indexBytes) !== lock.indexDigest
            || sha256(evidenceBytes) !== lock.registryEvidenceSha256 || evidence.imageDigest !== lock.imageDigest
            || evidence.indexDigest !== lock.indexDigest || evidence.repository !== lock.repository || evidence.tag !== lock.version
            || evidence.platform !== lock.platform || new Date(evidence.observedAt).toISOString() !== lock.registryVerifiedAt
            || !index.manifests.some(m => m.digest === lock.imageDigest && m.platform?.architecture === 'arm64' && m.platform.os === 'linux')
            || !Array.isArray(lock.datasetFiles) || lock.datasetFiles.length !== 5 || new Set(lock.datasetFiles).size !== 5
            || lock.datasetFiles.some(name => !/^[a-zA-Z0-9_().-]{1,128}$/u.test(name) || name.includes('..'))) deny('release_lock_invalid');
        return lock;
    } catch { deny('release_lock_invalid'); }
}
function privateDirectory(directory) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) deny('private_state_invalid');
}
function writeLocal(directory, name, content, mode = 0o600) {
    if (!dataFileNames.has(name)) deny('private_state_invalid');
    const target = path.join(directory, name);
    if (existsSync(target) && (!lstatSync(target).isFile() || lstatSync(target).isSymbolicLink())) deny('private_state_invalid');
    const temporary = path.join(directory, `.${name}.${randomUUID()}.tmp`);
    writeFileSync(temporary, content, { flag: 'wx', mode });
    renameSync(temporary, target);
}
function readLocal(directory, name) {
    const filename = path.join(directory, name);
    const stat = lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536 || (stat.mode & 0o077) !== 0) deny('private_state_invalid');
    return JSON.parse(readFileSync(filename, 'utf8'));
}
export function prepareManifest(lock, installationId, acceptedAt) {
    const manifest = JSON.parse(readFileSync(new URL('../docs/who-local-sidecar.manifest.json', import.meta.url), 'utf8'));
    Object.assign(manifest.image, { digest: lock.imageDigest, registryVerifiedAt: lock.registryVerifiedAt, registryEvidenceSha256: lock.registryEvidenceSha256 });
    Object.assign(manifest.license, { acceptedAt, acceptanceRecordRef: `who-${installationId}` });
    return manifest;
}
async function chooseContext(run, ask, report) {
    let contexts;
    try {
        contexts = run(['context', 'ls', '--format', '{{.Name}}']).split('\n').filter(name => /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/u.test(name));
        contexts = contexts.filter(name => /^unix:\/\/\//u.test(run(['context', 'inspect', name, '--format', '{{.Endpoints.docker.Host}}'])));
    } catch { deny('docker_unavailable'); }
    if (!contexts.length) deny('local_context_required');
    let selected = contexts[0];
    if (contexts.length > 1) {
        report('Scegli il runtime locale gia avviato:');
        contexts.forEach((name, i) => report(`${i + 1}. ${name}`));
        const choice = await ask('Numero del runtime: ');
        if (!/^[1-9][0-9]*$/u.test(choice) || !contexts[Number(choice) - 1]) deny('cancelled');
        selected = contexts[Number(choice) - 1];
    }
    localEngine(selected, run);
    return selected;
}
function validateState(state, lock) {
    if (state.schemaVersion !== 'mediflow.who-installation.v1' || !uuidPattern.test(state.installationId)
        || state.image !== `${lock.repository}@${lock.imageDigest}` || state.containerName !== `mediflow-who-local-${state.installationId}`
        || !['prepared', 'created', 'started', 'qualification_required', 'qualified', 'ready'].includes(state.phase)
        || (state.containerId !== undefined && !/^[0-9a-f]{64}$/u.test(state.containerId))) deny('private_state_invalid');
    scopedDocker(state);
}
function validQualification(state, manifest) {
    const r = state.qualificationAttempt;
    return r?.schemaVersion === 'mediflow.who-owned-qualification.v1' && r.complete === true
        && r.installationId === state.installationId && r.originalContainerId === state.containerId && r.image === state.image
        && r.snapshot?.snapshotId === manifest.dataset.snapshotId && r.snapshot?.inventorySha256 === manifest.dataset.snapshotInventorySha256
        && r.offlineRestart?.containerId === state.containerId && r.restore?.containerId === r.restoredContainerId
        && r.restoredHashesMatch === true && r.originalHashesMatch === true && r.originalRecovered === true;
}
const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`;
export async function launchWithWho(manifest, dependencies = {}) {
    configurationText(manifest); // Reapply the existing activation contract before loading environment.
    const environment = { ...process.env, MEDIFLOW_ICD_WHO_ENABLED: '1', MEDIFLOW_ICD_WHO_LOCAL_IMAGE_DIGEST: manifest.image.digest,
        MEDIFLOW_ICD_WHO_LOCAL_DATASET_ID: manifest.dataset.snapshotId };
    const launch = dependencies.launch ?? ((env) => new Promise((resolve, reject) => {
        const child = spawn('/bin/bash', [path.join(root, 'Start_MediFlow.command')], { cwd: root, env, stdio: 'inherit', shell: false });
        child.once('error', reject); child.once('exit', code => resolve(code));
    }));
    try {
        const code = await launch(environment);
        // The real child returns a numeric exit code, or null when terminated by a signal.
        if (code !== undefined && code !== 0) deny('app_launch_failed');
        return code;
    } catch { deny('app_launch_failed'); }
}

export async function onboardWho(action = 'setup', dependencies = {}) {
    if (!['setup', 'qualify', 'status', 'start'].includes(action)) deny('private_state_invalid');
    const host = dependencies.host ?? { platform: process.platform, arch: process.arch };
    if (host.platform !== 'darwin' || host.arch !== 'arm64') deny('host_unsupported');
    const directory = dependencies.directory ?? path.join(os.homedir(), 'Library', 'Application Support', 'MediFlow', 'WHO', '2026-01_en');
    const run = dependencies.run ?? runDocker;
    const ask = dependencies.ask ?? (() => Promise.resolve(''));
    const report = dependencies.report ?? (() => {});
    const now = dependencies.now ?? (() => new Date().toISOString());
    const lock = readReleaseLock();
    if (action === 'status' && !existsSync(directory)) return { state: 'not_installed', message: 'WHO locale non e ancora installato da questa procedura.' };
    privateDirectory(directory);
    const mutex = path.join(directory, '.setup-active');
    if (action !== 'status') {
        try { mkdirSync(mutex, { mode: 0o700 }); } catch { deny('setup_busy'); }
    }
    let holdsMutex = action !== 'status';
    const save = value => writeLocal(directory, 'installation.json', `${JSON.stringify(value, null, 2)}\n`);
    let state, manifest;
    try {
        if (existsSync(path.join(directory, 'installation.json'))) {
            state = readLocal(directory, 'installation.json'); validateState(state, lock);
            manifest = readLocal(directory, 'manifest.json');
            const license = readLocal(directory, 'license.json');
            if (license.installationId !== state.installationId || license.acceptedAt !== manifest.license.acceptedAt
                || license.gesture !== 'ACCETTO' || license.imageDigest !== lock.imageDigest
                || manifest.image.digest !== lock.imageDigest || manifest.license.acceptanceRecordRef !== `who-${state.installationId}`) deny('private_state_invalid');
        }
        // Reapply the existing fixed manifest gate on resume before any Docker operation.
        if (manifest && validateWhoLocalManifest(manifest, 'provision').length) deny('private_state_invalid');
        if (action === 'start' && state?.phase !== 'ready') deny('qualification_required');
        if (state?.phase === 'ready' && !validQualification(state, manifest)) deny('private_state_invalid');
        if (action === 'status') {
            if (!state?.containerId) return state
                ? { state: 'qualification_required', message: 'Preparazione WHO salvata; creazione del servizio non ancora confermata. Riapri la procedura per controllare e riprendere.' }
                : { state: 'not_installed', message: 'WHO locale non e ancora installato da questa procedura.' };
            localEngine(state.context, run);
            assertOwnedContainer(state, state.containerId, scopedDocker(state, run));
            const observed = inspectStatus(manifest, state.context, state.containerName, run);
            return { state: state.phase === 'ready' && observed.state === 'running' ? 'ready' : 'qualification_required',
                message: state.phase === 'ready' && observed.state === 'running' ? 'Qualifica WHO salvata e container in esecuzione. Questo controllo non esegue una ricerca: verifica WHO in MediFlow.' : message.qualification_required };
        }
        if (!state) {
            if (action !== 'setup') deny('qualification_required');
            report('1 di 3 — Controllo il computer.');
            const context = await chooseContext(run, ask, report);
            await (dependencies.portFree ?? checkPort)();
            // A legacy guided container is not adopted, even when its name is known.
            if (run(['--context', context, 'container', 'ls', '--all', '--filter', `name=^/${CONTAINER_NAME}$`, '--format', '{{.Names}}'])) deny('container_ownership_invalid');
            report('2 di 3 — WHO ICD API 2.6.0 · ICD-11 MMS 2026-01 · inglese.');
            report('Termini WHO: https://icd.who.int/en/docs/icd11-license.pdf');
            report('Scarichero il servizio e il catalogo locale (circa 494 MB, oltre a immagine e copie di recupero). Analytics disattivate. Verifichero riavvio e ripristino senza rete del solo servizio appena creato.');
            if (await ask('Per accettare questi termini e avviare installazione e verifiche, scrivi ACCETTO: ') !== 'ACCETTO') deny('cancelled');
            const installationId = randomUUID(), acceptedAt = now();
            state = { schemaVersion: 'mediflow.who-installation.v1', installationId, context,
                containerName: `mediflow-who-local-${installationId}`, image: `${lock.repository}@${lock.imageDigest}`, phase: 'prepared' };
            manifest = prepareManifest(lock, installationId, acceptedAt);
            writeLocal(directory, 'license.json', `${JSON.stringify({ installationId, imageDigest: lock.imageDigest, version: lock.version, include: lock.include,
                url: manifest.license.url, acceptedAt, gesture: 'ACCETTO' }, null, 2)}\n`);
            writeLocal(directory, 'manifest.json', `${JSON.stringify(manifest, null, 2)}\n`); save(state);
        } else if (state.phase !== 'ready' || action === 'qualify') {
            if (await ask('Riprendere installazione e verifiche del solo servizio creato qui? [s/N] ') !== 's') deny('cancelled');
        }
        const command = scopedDocker(state, run);
        const runPhase = (code, args, timeout) => {
            try { return command(args, timeout); } catch { deny(code); }
        };
        localEngine(state.context, run);
        if (!state.containerId) {
            await (dependencies.portFree ?? checkPort)();
            report('Scarico la versione WHO verificata…');
            runPhase('pull_failed', ['image', 'pull', '--platform', 'linux/arm64', '--quiet', state.image], 15 * 60 * 1000);
            state.containerId = runPhase('create_failed', createOwnedContainerArgs(state, state.containerName, 'bridge', true));
            if (!/^[0-9a-f]{64}$/u.test(state.containerId)) deny('container_ownership_invalid');
            state.phase = 'created'; save(state);
        }
        if (state.phase !== 'ready' || action === 'qualify') {
            const original = assertOwnedContainer(state, state.containerId, command);
            if (!original.running) runPhase('start_failed', ['container', 'start', state.containerId], 30000);
            state.phase = 'started'; save(state);
            manifest.dataset = { include: '2026-01_en', snapshotId: null, snapshotInventorySha256: null, offlineRestartVerified: false, restoreVerified: false };
            writeLocal(directory, 'manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
            writeLocal(directory, 'who.env', 'MEDIFLOW_ICD_WHO_ENABLED=0\n');
            report('3 di 3 — Verifico il catalogo e preparo MediFlow. La prima volta puo richiedere alcuni minuti.');
            const result = await qualifyOwnedDeployment(state, lock, directory, { ...dependencies, run, now, report, persist: save });
            manifest.dataset = result.dataset;
            state.qualificationAttempt = result.receipt;
            writeLocal(directory, 'manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
            writeLocal(directory, 'who.env', configurationText(manifest));
            writeLocal(directory, 'Avvia MediFlow con WHO.command', `#!/bin/bash\n# @Codex: named host launcher; no secrets in this file.\nexec ${shellQuote(path.join(root, 'Setup_WHO.command'))} start\n`, 0o700);
            state.phase = 'ready'; save(state);
        }
        if (!validQualification(state, manifest)) deny('private_state_invalid');
        const current = assertOwnedContainer(state, state.containerId, command);
        if (Object.keys(current.networks).length !== 1 || !current.networks.bridge) deny('original_network_mismatch');
        if (!current.running) {
            if (action !== 'start' && await ask('WHO locale e fermo. Avviare il servizio gia verificato? [s/N] ') !== 's') deny('cancelled');
            report('Avvio il servizio WHO gia verificato…');
            runPhase('start_failed', ['container', 'start', state.containerId], 30000);
            await waitForSearch(state, state.containerId, 'acquisition', command, dependencies);
        }
        assertOwnedContainer(state, state.containerId, command, true);
        if (inspectStatus(manifest, state.context, state.containerName, run).state !== 'running') deny('qualification_required');
        report('WHO locale pronto. Configurazione salvata automaticamente.');
        if (action === 'start' || (action === 'setup' && await ask('Vuoi avviare MediFlow con WHO? [s/N] ') === 's')) {
            // The ordinary app launcher owns its normal lifecycle; this procedure never kills it.
            const checkAppPort = dependencies.appPortFree ?? (async () => {
                const net = await import('node:net');
                await new Promise((resolve, reject) => {
                    const server = net.createServer(); server.once('error', () => reject(qualificationError('app_running')));
                    server.listen({ host: '127.0.0.1', port: 3000, exclusive: true }, () => server.close(resolve));
                });
            });
            await checkAppPort();
            rmdirSync(mutex); holdsMutex = false;
            await launchWithWho(manifest, dependencies);
        }
        return { state: 'ready', message: 'In MediFlow, rileggi lo stato e prova la ricerca WHO. Per gli avvii successivi usa Avvia MediFlow con WHO, senza configurare variabili.',
            launcher: path.join(directory, 'Avvia MediFlow con WHO.command') };
    } finally { if (holdsMutex) rmdirSync(mutex); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    if (process.versions.node.split('.')[0] !== '24' || process.argv.length > 3) {
        console.error('Usa Setup_WHO.command con Node.js 24.'); process.exitCode = 1;
    } else if (!stdin.isTTY && process.argv[2] !== 'status') {
        console.error('Apri Setup_WHO.command in un terminale: consenso e avvio richiedono il tuo gesto.'); process.exitCode = 1;
    } else {
        const reader = createInterface({ input: stdin, output: stdout });
        try {
            const result = await onboardWho(process.argv[2] ?? 'setup', { ask: prompt => reader.question(prompt), report: line => console.log(line) });
            console.log(result.message); if (result.launcher) console.log(`Avvio pronto: ${result.launcher}`);
        } catch (error) { console.error(friendlySetupMessage(error)); process.exitCode = 1; }
        finally { reader.close(); }
    }
}
