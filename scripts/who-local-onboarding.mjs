/* @Codex: PROPOSED WHO-TRIOS ordinary host-only setup. No DB, Web authority or remote engine. */
import { randomUUID } from 'node:crypto';
import { validateWhoLocalManifest } from './check-who-local-sidecar-manifest.mjs';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configurationText, inspectStatus, checkPort, runDocker, CONTAINER_NAME } from './who-local-setup.mjs';
import { observeOwnedRuntime, failureCause, qualificationSchemaFor, isMacAccess, openMacLoopback, assertProbeEngine, assertOffline, assertOwnedTopology, validOwnedNetwork, assertOwnedContainer, assertPinnedImage, createOwnedContainerArgs, qualifyOwnedDeployment, scopedDocker, qualificationError, waitForSearch, sha256 } from './who-local-qualification.mjs';
import { MAC_ACCESS_TOPOLOGY, EXEC_TRANSPORT, EXEC_PREREQUISITE } from './who-local-loopback.mjs';
import { readWhoProbe, probePath, validateProbeBody } from './who-local-probe.mjs';
import { appLaunchSpec, assertOutsideSource, assertPrivateFile, assertSameEngine, assertSupportedHost, checkCancelled,
    currentHost, defaultWhoDirectory, dockerPrerequisite, ensurePrivateDirectory, inspectLocalEngine, localDockerEndpoint,
    ownedLauncher, readReleaseTarget, requireReleaseEvidence, validEngineBinding } from './who-local-platform.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const dataFileNames = new Set(['installation.json', 'manifest.json', 'license.json', 'who.env',
    'Avvia MediFlow con WHO.command', 'Avvia MediFlow con WHO.ps1', 'Avvia MediFlow con WHO.sh']);
const message = Object.freeze({
    host_unsupported: 'Serve macOS, Windows o Linux con Node.js 24 x64/arm64. Il motore Docker deve essere Linux.',
    docker_unavailable: 'Avvia il runtime Docker locale scelto e ripeti node scripts/who-local-onboarding.mjs setup. Non modifico macchine virtuali.',
    local_context_required: 'Serve un socket Unix locale su macOS/Linux o un named pipe Windows esatto ammesso. TCP, SSH e contesti remoti non sono accettati.',
    platform_mismatch: 'Il motore Docker deve essere Linux ARM64 o AMD64 e corrispondere al target registrato. Non cambio motore o immagine.',
    port_in_use: 'La porta WHO e gia occupata. Non modifico il servizio esistente. Se WHO funziona in MediFlow, non serve installarlo di nuovo; altrimenti chiedi al gestore di collegarlo.',
    cancelled: 'Operazione annullata ai confini delle operazioni. Eventuali risorse già create e prove incomplete sono conservate; l’annullamento non le elimina.',
    setup_busy: 'Un’altra procedura WHO e gia attiva. Attendi che termini. Se e stata interrotta, il gestore puo verificare il lock nella cartella privata.',
    private_state_invalid: 'La registrazione locale non e coerente. Conservo i file: serve una verifica del gestore.',
    release_lock_invalid: 'Il pacchetto WHO non supera la verifica di integrita. Ripristina i file distribuiti con MediFlow.',
    container_ownership_invalid: 'Il servizio non corrisponde a quello creato da questa procedura. Non viene modificato.',
    original_network_mismatch: 'La rete del servizio e cambiata. Conservo lo stato e fermo la qualifica.',
    docker_cli_missing: 'Docker CLI non trovato sul computer. Nessun download o installazione automatica.',
    docker_executable_missing: 'Un eseguibile richiesto manca (exit127). Verifica fermata al primo tentativo; causa e risorse conservate.',
    docker_executable_denied: 'Eseguibile non consentito (exit126 o EACCES). Non elevo i privilegi e non ripeto il probe.',
    docker_command_timeout: 'Comando Docker oltre il limite. Prova incompleta conservata, WHO disabilitato.',
    docker_loopback_prerequisite: 'Questo percorso proposto richiede un motore Docker locale versione 28 o successiva per il binding loopback. Non aggiorno il motore.',
    probe_endpoint_unavailable: 'Il motore non conferma la porta IPv4 loopback della risorsa posseduta. Le reti internal possono non pubblicarla: nessun fallback con egress.',
    probe_binding_changed: 'Il binding del servizio è cambiato durante la ricerca. Risposta scartata, WHO disabilitato.',
    probe_redirect_refused: 'La ricerca locale ha ricevuto un redirect. Non seguo URL diversi e non attivo WHO.',
    network_foreign_member: 'La rete registrata contiene una risorsa estranea. Non la modifico; WHO resta disabilitato.',
    qualification_version_required: 'La ricevuta precedente non prova il trasporto previsto per questo host (Mac v4). Serve qualify con nuovo consenso; non riuso una vecchia prova.',
    relay_prerequisite_failed: 'Il controllo BusyBox timeout/cat nella stessa immagine WHO non è riuscito. Non installo strumenti e non cambio il pin.',
    relay_timeout_unsupported: 'BusyBox timeout non supporta le opzioni corte richieste. Nessuna prova avviata e nessuna attivazione.',
    relay_nc_unsupported: 'BusyBox nc non espone le capacità richieste per il loopback. Il solo help non qualifica il trasporto TCP.',
    relay_deadline_unverified: 'La prova di scadenza interna non è verificata. Non è una diagnosi della causa WHO; controlla lo stato posseduto con diagnose. Il ponte resta disabilitato.',
    who_runtime_exited: 'Il processo WHO posseduto è terminato durante avvio o verifica. La causa esterna resta indeterminata; una terminazione EXEC simultanea non prova un difetto di timeout. Stato e diagnosi pre-cleanup conservati, WHO disabilitato. Esegui diagnose prima di un nuovo qualify esplicito.',
    who_runtime_not_running: 'Il processo WHO posseduto non è nello stato running richiesto. Nessuna ricerca, adozione o riattivazione automatica: usa diagnose.',
    runtime_evidence_invalid: 'La lettura minimizzata dello stato WHO non è verificabile. Non inferisco disponibilità o causa; conserva lo stato per il gestore.',
    who_startup_budget_exhausted: 'WHO non ha prodotto una risposta valida entro il limite del tentativo (60 prove o 15 minuti ai confini delle operazioni). Non è una diagnosi di rete o dataset. Il servizio posseduto viene conservato fermo; usa diagnose e riprendi solo con qualify esplicito.',
    start_unconfirmed: 'Docker non ha confermato l’ID esatto del servizio avviato. Non adotto risorse per nome; WHO resta disabilitato.',
    incomplete_attempt_requires_review: 'Il tentativo precedente contiene risorse o una topologia incompleta da verificare. Non sovrascrivo i riferimenti, non ricollego reti e non elimino container. Serve la verifica del gestore.',
    relay_native_publication_conflict: 'Una pubblicazione Docker è ancora attiva: non apro un secondo listener né disconnetto reti per aggirare il controllo.',
    relay_listener_failed: 'Il ponte WHO locale si è chiuso. MediFlow resta indipendente; riavvia il solo launcher WHO dopo la verifica.',
    relay_transport_failed: 'Il trasporto locale verso il container posseduto non è riuscito. Nessun risultato sostitutivo e nessuna attivazione.',
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
    image_binding_mismatch: 'Digest o piattaforma dell’immagine locale non corrispondono al pin verificato. Non creo o qualifico il servizio e non cambio immagine.',
    image_evidence_missing: 'Target presente nell’indice, ma mancano manifest figlio/readback verificati. Non scarico, non creo e non attivo WHO. Servono gli artefatti indicati in NEEDS_CONTEXT.',
    engine_identity_required: 'Il motore non espone un’identità stabile verificabile. Non viene creata o attivata un’installazione.',
    engine_identity_changed: 'Host, endpoint o identità del motore sono cambiati. La qualifica precedente non autorizza questo target; conservo i dati per il gestore.',
    private_permissions_required: 'Permessi Windows non verificati: serve una cartella locale NTFS dell’utente con ACL privato. Non correggo ACL esistenti, non uso elevazione o bypass di policy.',
    engine_binding_required: 'La registrazione precedente non lega il motore. Riprendi setup o qualify con conferma per una nuova qualifica del solo servizio posseduto.',
    app_running: 'MediFlow e gia in esecuzione: non lo interrompo. Al prossimo avvio usa “Avvia MediFlow con WHO” nella cartella privata.',
});
export function friendlySetupMessage(error, hostPlatform = process.platform) {
    if (error?.code === 'docker_unavailable') return dockerPrerequisite(hostPlatform);
    const text = message[error?.code] ?? message.qualification_failed;
    if (error?.code === 'who_runtime_exited') {
        const cause = failureCause(error);
        return `${text}${Number.isInteger(cause.exitCode) ? ` Exit WHO: ${cause.exitCode}.` : ''}${typeof cause.oomKilled === 'boolean' ? ` OOM osservato: ${cause.oomKilled ? 'sì' : 'no'}.` : ''}`;
    }
    return text;
}
const deny = code => { throw qualificationError(code); };
export function readReleaseLock(platform = 'linux/arm64') { return readReleaseTarget(platform); }
function writeLocal(directory, name, content, mode = 0o600) {
    if (!dataFileNames.has(name)) deny('private_state_invalid');
    ensurePrivateDirectory(directory);
    const target = path.join(directory, name);
    if (existsSync(target)) assertPrivateFile(target);
    else { try { lstatSync(target); deny('private_state_invalid'); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
    const temporary = path.join(directory, `.${name}.${randomUUID()}.tmp`);
    writeFileSync(temporary, content, { flag: 'wx', mode });
    assertPrivateFile(temporary);
    renameSync(temporary, target);
    assertPrivateFile(target);
}
function readLocal(directory, name) {
    if (!dataFileNames.has(name)) deny('private_state_invalid');
    const filename = path.join(directory, name);
    assertPrivateFile(filename);
    try { return JSON.parse(readFileSync(filename, 'utf8')); } catch { deny('private_state_invalid'); }
}
export function prepareManifest(lock, installationId, acceptedAt) {
    requireReleaseEvidence(lock);
    const manifest = JSON.parse(readFileSync(new URL('../docs/who-local-sidecar.manifest.json', import.meta.url), 'utf8'));
    manifest.schemaVersion = 'mediflow.who-local-sidecar.manifest.v2';
    Object.assign(manifest.image, { platform: lock.platform, digest: lock.imageDigest,
        registryVerifiedAt: lock.registryVerifiedAt, registryEvidenceSha256: lock.registryEvidenceSha256 });
    Object.assign(manifest.license, { acceptedAt, acceptanceRecordRef: `who-${installationId}` });
    return manifest;
}
async function chooseContext(run, ask, report, host, signal) {
    let contexts;
    try {
        contexts = run(['context', 'ls', '--format', '{{.Name}}']).split('\n').filter(name => /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/u.test(name));
        contexts = contexts.filter(name => localDockerEndpoint(run(['context', 'inspect', name, '--format', '{{.Endpoints.docker.Host}}']), host.platform));
    } catch (error) { if (error.code?.startsWith('docker_')) throw error; deny('docker_unavailable'); }
    if (!contexts.length) deny('local_context_required');
    let selected = contexts[0];
    if (contexts.length > 1) {
        report('Scegli il runtime locale gia avviato:');
        contexts.forEach((name, i) => report(`${i + 1}. ${name}`));
        const choice = await ask('Numero del runtime: ');
        checkCancelled(signal);
        if (!/^[1-9][0-9]*$/u.test(choice) || !contexts[Number(choice) - 1]) deny('cancelled');
        selected = contexts[Number(choice) - 1];
    }
    return { context: selected, engineBinding: inspectLocalEngine(selected, run, host) };
}
function validateState(state, lock, host) {
    if (!['mediflow.who-installation.v1', 'mediflow.who-installation.v2'].includes(state?.schemaVersion)
        || !uuidPattern.test(state.installationId) || state.image !== `${lock.repository}@${lock.imageDigest}`
        || state.containerName !== `mediflow-who-local-${state.installationId}`
        || !['prepared', 'created', 'started', 'qualification_required', 'qualified', 'ready'].includes(state.phase)
        || (state.containerId !== undefined && !/^[0-9a-f]{64}$/u.test(state.containerId))) deny('private_state_invalid');
    if (state.schemaVersion === 'mediflow.who-installation.v2') {
        if (!validEngineBinding(state.engineBinding) || state.engineBinding.platform !== lock.platform
            || state.platform !== lock.platform) deny('private_state_invalid');
        if (state.engineBinding.hostPlatform !== host.platform || state.engineBinding.hostArch !== host.arch) deny('engine_identity_changed');
    } else if (lock.platform !== 'linux/arm64' || state.engineBinding !== undefined) deny('private_state_invalid');
    if (state.offlineNetwork !== undefined && !validOwnedNetwork(state.offlineNetwork)) deny('private_state_invalid');
    scopedDocker(state);
}
export function validQualification(state, manifest) {
    const r = state.qualificationAttempt;
    const hash = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/u.test(value);
    if (state.schemaVersion !== 'mediflow.who-installation.v2' || r?.schemaVersion !== qualificationSchemaFor(state)) return false;
    try { assertSameEngine(state.engineBinding, r.engineBinding); } catch { return false; }
    const probes = [[r.acquisition, 'acquisition', state.containerId], [r.offlineRestart, 'offline_restart', state.containerId],
        [r.restore, 'restored', r.restoredContainerId], [r.originalRecoveredProbe, 'original_recovered', state.containerId]];
    const mac = isMacAccess(state);
    if (mac && (r.accessTopology !== MAC_ACCESS_TOPOLOGY || r.execPrerequisites?.contract !== EXEC_PREREQUISITE
        || r.execPrerequisites.containerId !== state.containerId || r.execPrerequisites.image !== state.image)) return false;
    const validProbes = probes.every(([p, kind, id]) => {
        if (!p || p.kind !== kind || p.containerId !== id || p.installationId !== state.installationId
            || !(mac ? (kind === 'acquisition' && p.transport === 'node-http-loopback-v1') || p.transport === EXEC_TRANSPORT
                : p.transport === 'node-http-loopback-v1') || !hash(p.responseSha256) || !hash(p.bindingSha256)
            || !Number.isInteger(p.resultCount) || p.resultCount < 1 || !Number.isInteger(p.port) || p.port < 1 || p.port > 65535
            || p.endpoint !== `http://127.0.0.1:${p.port}` || (kind !== 'restored' ? p.port !== 8382 : p.port === 8382)
            || !Number.isFinite(Date.parse(p.observedAt)) || !Number.isFinite(Date.parse(p.startedAt))) return false;
        if (p.transport === EXEC_TRANSPORT && (!uuidPattern.test(p.instanceId) || !hash(p.targetBindingSha256)
            || p.requestPathSha256 !== sha256(probePath(kind))
            || p.bindingSha256 !== sha256(JSON.stringify({ instanceId: p.instanceId, port: p.port, target: p.targetBindingSha256 })) || (kind !== 'acquisition' && (p.isolation?.networkId !== state.offlineNetwork?.id
                || p.isolation.internal !== true || p.isolation.noDefaultRoute !== true || p.isolation.noRoutedEgress !== true)))) return false;
        try { assertSameEngine(state.engineBinding, p.engineBinding); return true; } catch { return false; }
    });
    const isolation = [r.offlineBefore, r.offlineAfter, r.restoreOfflineBefore, r.restoreOfflineAfter,
        r.originalOfflineBefore, r.originalOfflineAfter];
    return r.complete === true && r.failure === undefined && r.recoveryFailure === undefined
        && r.installationId === state.installationId && r.originalContainerId === state.containerId && r.image === state.image
        && uuidPattern.test(r.attemptId) && /^[a-f0-9]{64}$/u.test(r.restoredContainerId) && r.restoredContainerId !== state.containerId
        && r.snapshot?.snapshotId === manifest.dataset.snapshotId && r.snapshot?.inventorySha256 === manifest.dataset.snapshotInventorySha256
        && validOwnedNetwork(state.offlineNetwork) && validOwnedNetwork(r.offlineNetwork)
        && r.offlineNetwork.id === state.offlineNetwork.id && r.offlineNetwork.name === state.offlineNetwork.name
        && validProbes && new Set(probes.map(([p]) => p.bindingSha256)).size === 4
        && (!mac || new Set([r.acquisition.startedAt, r.offlineRestart.startedAt, r.originalRecoveredProbe.startedAt]).size === 3)
        && isolation.every(p => p?.networkId === state.offlineNetwork.id && p.internal === true && p.ipv6 === false
            && p.noDefaultRoute === true && p.noRoutedEgress === true && hash(p.routesSha256) && hash(p.ipv6RoutesSha256))
        && r.restoredHashesMatch === true && r.originalHashesMatch === true && r.originalRecovered === true && r.restoreStopped === true;
}
export async function launchWithWho(manifest, dependencies = {}) {
    configurationText(manifest);
    checkCancelled(dependencies.signal);
    const environment = { ...process.env, MEDIFLOW_ICD_WHO_ENABLED: '1', MEDIFLOW_ICD_WHO_LOCAL_IMAGE_DIGEST: manifest.image.digest,
        MEDIFLOW_ICD_WHO_LOCAL_DATASET_ID: manifest.dataset.snapshotId };
    const spec = appLaunchSpec((dependencies.host ?? currentHost()).platform);
    const launch = dependencies.launch ?? ((env) => new Promise((resolve, reject) => {
        const child = spawn(spec.executable, spec.args, { cwd: root, env, stdio: 'inherit', shell: false });
        child.once('error', reject); child.once('exit', code => resolve(code));
    }));
    try {
        const code = await launch(environment, spec);
        if (code !== undefined && code !== 0) deny('app_launch_failed');
        return code;
    } catch { deny('app_launch_failed'); }
}
const emptyDataset = () => ({ include: '2026-01_en', snapshotId: null, snapshotInventorySha256: null, offlineRestartVerified: false, restoreVerified: false });
export async function onboardWho(action = 'setup', dependencies = {}) {
    if (!['setup', 'qualify', 'status', 'diagnose', 'start', 'serve'].includes(action)) deny('private_state_invalid');
    const host = assertSupportedHost(dependencies.host ?? currentHost());
    if (['serve', 'diagnose'].includes(action) && host.platform !== 'darwin') deny('host_unsupported');
    const directory = dependencies.directory ?? defaultWhoDirectory(host);
    assertOutsideSource(directory);
    const run = dependencies.run ?? runDocker;
    const ask = dependencies.ask ?? (() => Promise.resolve(''));
    const report = dependencies.report ?? (() => {});
    const now = dependencies.now ?? (() => new Date().toISOString());
    const signal = dependencies.signal;
    checkCancelled(signal);
    const readOnly = ['status', 'diagnose'].includes(action);
    if (readOnly && !existsSync(directory)) return { state: 'not_installed', message: 'WHO locale non e ancora installato da questa procedura.' };
    ensurePrivateDirectory(directory);
    const mutex = path.join(directory, '.setup-active');
    if (action === 'diagnose' && existsSync(mutex)) deny('setup_busy');
    if (!readOnly) { try { mkdirSync(mutex, { mode: 0o700 }); } catch { deny('setup_busy'); } }
    let holdsMutex = !readOnly, activationCommitted = false;
    const save = value => writeLocal(directory, 'installation.json', `${JSON.stringify(value, null, 2)}\n`);
    let state, manifest, lock;
    try {
        if (existsSync(path.join(directory, 'installation.json'))) {
            state = readLocal(directory, 'installation.json');
            manifest = readLocal(directory, 'manifest.json');
            lock = requireReleaseEvidence(readReleaseLock(manifest?.image?.platform));
            validateState(state, lock, host);
            const license = readLocal(directory, 'license.json');
            if (license.installationId !== state.installationId || license.acceptedAt !== manifest.license?.acceptedAt
                || license.gesture !== 'ACCETTO' || license.imageDigest !== lock.imageDigest || license.version !== lock.version
                || license.include !== lock.include || license.url !== manifest.license?.url
                || manifest.image.digest !== lock.imageDigest || manifest.license.acceptanceRecordRef !== `who-${state.installationId}`) deny('private_state_invalid');
        }
        if (manifest && validateWhoLocalManifest(manifest, 'provision').length) deny('private_state_invalid');
        const legacy = state?.schemaVersion === 'mediflow.who-installation.v1';
        const oldQualification = state?.phase === 'ready' && state?.qualificationAttempt?.schemaVersion !== qualificationSchemaFor(state);
        if (['start', 'serve'].includes(action) && (state?.phase !== 'ready' || legacy || oldQualification)) deny('qualification_required');
        if (state?.phase === 'ready' && !oldQualification && !validQualification(state, manifest)) deny('private_state_invalid');
        if (action === 'diagnose') {
            if (!state?.containerId) return { state: state ? 'qualification_required' : 'not_installed',
                message: 'Nessun ID di container posseduto confermato. Non cerco o adotto altri servizi.' };
            if (legacy) deny('engine_binding_required');
            const diagnosticCommand = scopedDocker(state, run);
            const observed = observeOwnedRuntime(state, state.containerId, 'acquisition', diagnosticCommand);
            // Current state may reflect an earlier cleanup. Do not infer original cause
            // from it, or emit identifiers, raw logs, State.Error, Config.Env or endpoints.
            const { status, running, exitCode, oomKilled, runtimeError, restartCount } = observed;
            const diagnostic = { status, running, exitCode, oomKilled, runtimeError, restartCount,
                runtimeCause: 'undetermined', qualifiedReceipt: state.phase === 'ready' && validQualification(state, manifest),
                ...(state.qualificationAttempt?.failureCause ? { previousFailure: failureCause(state.qualificationAttempt.failureCause) } : {}) };
            return { state: diagnostic.qualifiedReceipt ? 'qualified' : 'qualification_required', diagnostic,
                message: 'Diagnosi in sola lettura: nessun avvio, EXEC, download, modifica o ricerca WHO. Lo stato corrente può riflettere il cleanup; non identifica la causa originale. Confronta la diagnosi pre-cleanup, poi usa qualify solo dopo verifica esterna e nuovo consenso.' };
        }
        if (action === 'status') {
            if (!state?.containerId) return state
                ? { state: 'qualification_required', message: 'Preparazione WHO salvata; creazione del servizio non ancora confermata. Riapri la procedura per controllare e riprendere.' }
                : { state: 'not_installed', message: 'WHO locale non e ancora installato da questa procedura.' };
            const observedEngine = inspectLocalEngine(state.context, run, host);
            if (state.engineBinding) assertSameEngine(state.engineBinding, observedEngine);
            else if (observedEngine.platform !== lock.platform) deny('platform_mismatch');
            const statusCommand = scopedDocker(state, run);
            const current = assertOwnedContainer(state, state.containerId, statusCommand);
            if (oldQualification && !legacy) return { state: 'qualification_required', message: message.qualification_version_required };
            if (legacy) return { state: 'qualification_required', message: message.engine_binding_required };
            if (state.phase === 'ready') {
                assertProbeEngine(statusCommand); assertOwnedTopology(state, current, statusCommand);
                if (current.running) assertOffline(state, state.containerId, state.offlineNetwork, statusCommand);
            }
            if (isMacAccess(state) && state.phase === 'ready') return { state: 'qualified',
                message: 'Qualifica Mac salvata; questo status non osserva il listener e non esegue una ricerca. Usa start oppure serve e verifica WHO in MediFlow.' };
            const observed = inspectStatus(manifest, state.context, state.containerName, run, { host, engineBinding: state.engineBinding });
            return { state: state.phase === 'ready' && observed.state === 'running' ? 'ready' : 'qualification_required',
                message: state.phase === 'ready' && observed.state === 'running' ? 'Qualifica WHO salvata e container in esecuzione. Questo controllo non esegue una ricerca: verifica WHO in MediFlow.' : message.qualification_required };
        }
        if (!state) {
            if (action !== 'setup') deny('qualification_required');
            report('1 di 3 — Controllo il computer e il motore locale.');
            const selected = await chooseContext(run, ask, report, host, signal);
            lock = requireReleaseEvidence(readReleaseLock(selected.engineBinding.platform));
            await (dependencies.portFree ?? checkPort)(); checkCancelled(signal);
            assertSameEngine(selected.engineBinding, inspectLocalEngine(selected.context, run, host));
            if (run(['--context', selected.context, 'container', 'ls', '--all', '--filter', `name=^/${CONTAINER_NAME}$`, '--format', '{{.Names}}'])) deny('container_ownership_invalid');
            report(`Host Node ${host.platform}/${host.arch}; motore ${lock.platform}. Metadati immagine verificati, runtime non ancora qualificato.`);
            report('2 di 3 — WHO ICD API 2.6.0 · ICD-11 MMS 2026-01 · inglese.');
            report('Termini WHO: https://icd.who.int/en/docs/icd11-license.pdf');
            report('Scarichero immagine e catalogo locale e conservero copie di recupero. Serve spazio libero; il totale non e misurato qui. Analytics, DORIS e FHIR disattivati. Verifichero riavvio offline e ripristino del solo servizio creato.');
            const answer = await ask('Per accettare questi termini e avviare installazione e verifiche, scrivi ACCETTO: ');
            checkCancelled(signal); if (answer !== 'ACCETTO') deny('cancelled');
            // Recheck after the human gesture: the selected context may have changed meanwhile.
            assertSameEngine(selected.engineBinding, inspectLocalEngine(selected.context, run, host));
            const installationId = randomUUID(), acceptedAt = now();
            state = { schemaVersion: 'mediflow.who-installation.v2', installationId, context: selected.context,
                engineBinding: selected.engineBinding, platform: lock.platform, containerName: `mediflow-who-local-${installationId}`,
                image: `${lock.repository}@${lock.imageDigest}`, phase: 'prepared' };
            manifest = prepareManifest(lock, installationId, acceptedAt);
            writeLocal(directory, 'license.json', `${JSON.stringify({ installationId, imageDigest: lock.imageDigest, version: lock.version, include: lock.include,
                url: manifest.license.url, acceptedAt, gesture: 'ACCETTO' }, null, 2)}\n`);
            writeLocal(directory, 'manifest.json', `${JSON.stringify(manifest, null, 2)}\n`); save(state);
        } else if (state.phase !== 'ready' || action === 'qualify' || legacy || oldQualification) {
            const answer = await ask('Riprendere installazione e verifiche del solo servizio creato qui? [s/N] ');
            checkCancelled(signal); if (answer !== 's') deny('cancelled');
        }
        if (legacy) {
            const engineBinding = inspectLocalEngine(state.context, run, host);
            if (engineBinding.platform !== lock.platform) deny('platform_mismatch');
            if (state.containerId) assertOwnedContainer(state, state.containerId, scopedDocker(state, run));
            // Explicit migration preserves the previous snapshots and never adopts another container.
            state = { ...state, schemaVersion: 'mediflow.who-installation.v2', engineBinding, platform: lock.platform,
                phase: state.containerId ? 'qualification_required' : 'prepared' };
            manifest.schemaVersion = 'mediflow.who-local-sidecar.manifest.v2'; manifest.dataset = emptyDataset();
            writeLocal(directory, 'who.env', 'MEDIFLOW_ICD_WHO_ENABLED=0\n');
            writeLocal(directory, 'manifest.json', `${JSON.stringify(manifest, null, 2)}\n`); save(state);
        }
        if (oldQualification && !legacy) {
            manifest.dataset = emptyDataset(); state.phase = 'qualification_required';
            writeLocal(directory, 'who.env', 'MEDIFLOW_ICD_WHO_ENABLED=0\n');
            writeLocal(directory, 'manifest.json', `${JSON.stringify(manifest, null, 2)}\n`); save(state);
        }
        const command = scopedDocker(state, run);
        const runPhase = (code, args, timeout, persistSuccess) => {
            checkCancelled(signal);
            let result;
            try { result = command(args, timeout); }
            catch (error) { if (error.code?.startsWith('docker_') && error.code !== 'docker_unavailable') throw error; if (['cancelled', 'engine_identity_changed', 'local_context_required', 'platform_mismatch', 'engine_identity_required'].includes(error.code)) throw error; deny(code); }
            // Record a successfully returned owned ID before honoring cancellation.
            // Ambiguous/failed creates are never adopted later from a name alone.
            persistSuccess?.(result);
            checkCancelled(signal);
            return result;
        };
        assertSameEngine(state.engineBinding, inspectLocalEngine(state.context, run, host));
        checkCancelled(signal);
        assertProbeEngine(command);
        if (!state.containerId) {
            // A previous create could have succeeded without a returned ID. Never adopt by name.
            if (command(['container', 'ls', '--all', '--filter', `name=^/${state.containerName}$`, '--format', '{{.Names}}'])) deny('container_ownership_invalid');
            await (dependencies.portFree ?? checkPort)(); checkCancelled(signal);
            report('Download immagine WHO in corso; il catalogo non e ancora disponibile.');
            runPhase('pull_failed', ['image', 'pull', '--platform', lock.platform, '--quiet', state.image], 15 * 60 * 1000);
            assertPinnedImage(state, command);
            runPhase('create_failed', createOwnedContainerArgs(state, state.containerName, 'bridge', true), undefined, id => {
                if (!/^[0-9a-f]{64}$/u.test(id)) deny('container_ownership_invalid');
                state.containerId = id; state.phase = 'created'; save(state);
            });
        }
        assertPinnedImage(state, command);
        if (state.phase !== 'ready' || action === 'qualify') {
            // Invalidate a previous ready configuration before a requalification mutation.
            if (state.phase === 'ready') {
                manifest.dataset = emptyDataset(); state.phase = 'qualification_required';
                writeLocal(directory, 'who.env', 'MEDIFLOW_ICD_WHO_ENABLED=0\n');
                writeLocal(directory, 'manifest.json', `${JSON.stringify(manifest, null, 2)}\n`); save(state);
            }
            const original = assertOwnedContainer(state, state.containerId, command);
            assertOwnedTopology(state, original, command, true);
            // F5 Mac: the qualification attempt is persisted before first start;
            // it owns bounded cleanup and the pre-cleanup runtime diagnosis.
            if (!isMacAccess(state) && !original.running) runPhase('start_failed', ['container', 'start', state.containerId], 30000);
            state.phase = isMacAccess(state) ? 'qualification_required' : 'started'; save(state);
            manifest.dataset = emptyDataset();
            writeLocal(directory, 'manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
            writeLocal(directory, 'who.env', 'MEDIFLOW_ICD_WHO_ENABLED=0\n');
            report('3 di 3 — Qualifica in corso: inventario del download, riavvio offline e ripristino. WHO non e ancora attivato.');
            const result = await qualifyOwnedDeployment(state, lock, directory, { ...dependencies, run, now, report, persist: save });
            checkCancelled(signal);
            manifest.dataset = result.dataset; state.qualificationAttempt = result.receipt;
            writeLocal(directory, 'manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
            const launcher = ownedLauncher(host.platform);
            writeLocal(directory, launcher.name, launcher.content, 0o700);
            configurationText(manifest); state.phase = 'ready'; save(state);
            writeLocal(directory, 'who.env', configurationText(manifest));
        }
        if (!validQualification(state, manifest)) deny('private_state_invalid');
        checkCancelled(signal);
        const current = assertOwnedContainer(state, state.containerId, command);
        assertOwnedTopology(state, current, command);
        if (!current.running) {
            if (action !== 'start' && await ask('WHO locale e fermo. Avviare il servizio gia verificato? [s/N] ') !== 's') deny('cancelled');
            checkCancelled(signal); report('Avvio il servizio WHO gia verificato…');
            await (dependencies.portFree ?? checkPort)();
            runPhase('start_failed', ['container', 'start', state.containerId], 30000);
            assertOffline(state, state.containerId, state.offlineNetwork, command);
            await waitForSearch(state, state.containerId, 'original_recovered', command, dependencies);
            assertOffline(state, state.containerId, state.offlineNetwork, command);
        }
        assertOffline(state, state.containerId, state.offlineNetwork, command);
        if (!isMacAccess(state) && inspectStatus(manifest, state.context, state.containerName, run, { host, engineBinding: state.engineBinding }).state !== 'running') deny('qualification_required');
        activationCommitted = true;
        report('Qualifica WHO completa e configurazione salvata. La disponibilita nel processo MediFlow si verifica con una ricerca esplicita.');
        if (['start', 'serve'].includes(action) || (action === 'setup' && await ask('Vuoi avviare MediFlow con WHO? [s/N] ') === 's')) {
            checkCancelled(signal);
            const checkAppPort = dependencies.appPortFree ?? (async () => {
                const net = await import('node:net');
                await new Promise((resolve, reject) => {
                    const server = net.createServer(); server.once('error', () => reject(qualificationError('app_running')));
                    server.listen({ host: '127.0.0.1', port: 3000, exclusive: true }, () => server.close(resolve));
                });
            });
            if (action !== 'serve') await checkAppPort(); checkCancelled(signal);
            // Revalidate identity after the await before releasing the mutex and launching the app.
            assertSameEngine(state.engineBinding, inspectLocalEngine(state.context, run, host));
            if (isMacAccess(state)) {
                // Foreground ownership: no detached daemon, PID file or acceptance by port alone.
                const access = await openMacLoopback(state, state.containerId, 'application', dependencies);
                try {
                    let response;
                    try { response = await (dependencies.request ?? readWhoProbe)(access.port, 'original_recovered', signal); }
                    catch (error) { throw access.lastError ?? error; }
                    if (access.lastError) throw access.lastError;
                    if (!access.lastObservation || access.lastObservation.responseSha256 !== sha256(response)
                        || access.lastObservation.requestPathSha256 !== sha256(probePath('original_recovered'))) deny('probe_binding_invalid');
                    validateProbeBody(response);
                    checkCancelled(signal);
                    report('WHO locale risponde sul ponte posseduto 127.0.0.1:8382. Mantieni aperto questo processo; Ctrl-C chiude il ponte.');
                    if (action === 'serve') {
                        await access.closed;
                        return { state: 'stopped', message: 'Ponte WHO chiuso; nessuna app o risorsa estranea è stata arrestata. La qualifica salvata non prova disponibilità attuale.' };
                    }
                    // Keep the mutex while the Mac bridge is owned; do not requalify beneath it.
                    await launchWithWho(manifest, { ...dependencies, host });
                } finally { await access.close(); }
            } else {
                rmdirSync(mutex); holdsMutex = false;
                await launchWithWho(manifest, { ...dependencies, host });
            }
        }
        return { state: 'ready', message: 'In MediFlow, rileggi lo stato e prova la ricerca WHO. Qualifica salvata non significa nuova risposta applicativa.',
            launcher: path.join(directory, ownedLauncher(host.platform).name) };
    } catch (error) {
        if (!readOnly && state && (!activationCommitted || error.code === 'engine_identity_changed'
                || (isMacAccess(state) && ['start', 'serve'].includes(action) && !['app_launch_failed', 'app_running'].includes(error.code)))
            && existsSync(path.join(directory, 'who.env'))) writeLocal(directory, 'who.env', 'MEDIFLOW_ICD_WHO_ENABLED=0\n');
        throw error;
    } finally { if (holdsMutex) rmdirSync(mutex); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    if (process.versions.node.split('.')[0] !== '24' || process.argv.length > 3) {
        console.error('Usa Node.js 24: node scripts/who-local-onboarding.mjs [setup|status|diagnose|qualify|start|serve].'); process.exitCode = 1;
    } else if (!stdin.isTTY && !['status', 'diagnose'].includes(process.argv[2])) {
        console.error('Esegui nel terminale del computer MediFlow: consenso e avvio richiedono il tuo gesto.'); process.exitCode = 1;
    } else {
        const reader = createInterface({ input: stdin, output: stdout });
        const controller = new AbortController();
        const cancel = () => controller.abort();
        process.on('SIGINT', cancel); process.on('SIGTERM', cancel); reader.on('SIGINT', cancel); reader.on('close', cancel);
        try {
            const result = await onboardWho(process.argv[2] ?? 'setup', { signal: controller.signal,
                ask: prompt => reader.question(prompt, { signal: controller.signal }).catch(() => { throw qualificationError('cancelled'); }),
                report: line => console.log(line) });
            console.log(result.message); if (result.diagnostic) console.log(JSON.stringify(result.diagnostic, null, 2)); if (result.launcher) console.log(`Launcher locale: ${result.launcher}`);
        } catch (error) {
            console.error(friendlySetupMessage(error));
            if (error.code === 'image_evidence_missing') for (const missing of error.missing ?? []) console.error(`Manca: ${missing}`);
            process.exitCode = 1;
        } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); reader.removeListener('SIGINT', cancel); reader.removeListener('close', cancel); reader.close(); }
    }
}
