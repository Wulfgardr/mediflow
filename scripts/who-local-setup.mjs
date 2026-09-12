/* @Codex: host-operated fixed WHO installer; never imported by Web runtime. */
import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectLocalEngine, assertSameEngine, dockerEnvironment, engineArchitecture, windowsAcl } from './who-local-platform.mjs';
import { validateWhoLocalManifest } from './check-who-local-sidecar-manifest.mjs';

export const INSTALL_CONFIRMATION = 'install-who-2.6.0-2026-01_en';
export const ENABLE_CONFIRMATION = 'enable-who-2026-01_en';
export const CONTAINER_NAME = 'mediflow-who-2026-01-guided';
const owner = 'mediflow.who.guided.v1';
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/u.test(value);
const root = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
export const MESSAGES = Object.freeze({
    arguments_invalid: 'Usa init, plan, status, install o configure con le sole opzioni documentate.',
    private_absolute_path_required: 'Scegli un percorso assoluto fuori dalla repository, in una cartella privata esistente.',
    manifest_unreadable: 'Il manifesto deve essere un file JSON locale leggibile, regolare e non oltre 32 KiB.',
    output_exists_or_unwritable: 'File non scritto: esiste gia oppure la cartella non e scrivibile. Scegli un nuovo file.',
    prerequisites_incomplete: 'Completa nel manifesto lock del registry, accettazione WHO e prove richieste dalla fase.',
    confirmation_required: 'Conferma esplicitamente questa operazione e la versione indicata.',
    docker_cli_missing: 'Eseguibile Docker host non trovato. Nessuna installazione automatica.',
    docker_executable_missing: 'Eseguibile richiesto assente (exit127). Verifica prerequisito interrotta; nessun polling.',
    docker_executable_denied: 'Eseguibile richiesto non consentito (exit126 o EACCES). Nessuna elevazione.',
    docker_command_timeout: 'Comando Docker oltre il limite temporale. Risorse conservate; verifica interrotta.',
    docker_unavailable: 'Docker non risponde. Installa o avvia il runtime locale scelto e ripeti status.',
    local_context_required: 'Serve un endpoint Docker locale ammesso: socket Unix per il contratto v1; socket locale o pipe Windows esatto per v2. Nessun cambio del contesto predefinito.',
    platform_mismatch: 'Il motore deve corrispondere al manifesto: Linux ARM64 per v1; Linux ARM64/AMD64 con evidenza verificata per v2.',
    container_absent: 'Container assente: usa install solo per una nuova installazione; controlla il nome per un servizio esistente.',
    container_conflict: 'Esiste gia il container previsto. Usa status; recupero o sostituzione richiedono un intervento esplicito sul solo container.',
    container_not_running: 'Il container e fermo o in errore. Chiedi al gestore locale di ripristinarlo, poi ripeti status.',
    container_binding_mismatch: 'Immagine, piattaforma, listener o isolamento non corrispondono al manifesto. Configurazione bloccata.',
    port_in_use: 'La porta locale 8382 e occupata. Verifica se WHO e gia installato; non interrompere altri servizi.',
    pull_failed: 'Acquisizione immagine non riuscita. Verifica rete e digest nel registry, poi ripeti install.',
    create_failed: 'Creazione non riuscita. Controlla status prima di riprovare; nessuna risorsa e stata rimossa.',
    start_failed: 'Avvio non riuscito. Il container creato e conservato: controlla status e recuperalo manualmente.',
    fresh_qualification_required: 'Una nuova installazione richiede nuove prove dataset. Usa un manifesto di provisioning senza snapshot o prove ereditate; conserva quello del deployment qualificato.',
    node24_required: 'Esegui questa procedura con Node.js 24.',
});
class SetupError extends Error {
    constructor(code, details = []) { super(MESSAGES[code] ?? code); this.code = code; this.details = details; }
}
const fail = (code, details) => { throw new SetupError(code, details); };

// Paths are operator-owned local CLI inputs, never browser/API inputs. No shell executes them.
function privatePath(value) {
    if (typeof value !== 'string' || !path.isAbsolute(value) || /[\r\n\0]/u.test(value)) fail('private_absolute_path_required');
    let resolved;
    try { resolved = path.join(realpathSync(path.dirname(value)), path.basename(value)); }
    catch { fail('private_absolute_path_required'); }
    if (resolved === root || resolved.startsWith(`${root}${path.sep}`)) fail('private_absolute_path_required');
    return resolved;
}
export function readManifest(filename) {
    privatePath(filename);
    try {
        const stat = lstatSync(filename);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32768) fail('manifest_unreadable');
        if (process.platform === 'win32') windowsAcl(filename);
        return JSON.parse(readFileSync(filename, 'utf8'));
    } catch { fail('manifest_unreadable'); }
}
function writePrivate(filename, content) {
    privatePath(filename);
    try {
        if (process.platform === 'win32') windowsAcl(path.dirname(filename), { directory: true });
        writeFileSync(filename, content, { flag: 'wx', mode: 0o600 });
        if (process.platform === 'win32') windowsAcl(filename);
    }
    catch { fail('output_exists_or_unwritable'); }
}
export function parseArguments(args) {
    const [action, ...rest] = args;
    const allowed = {
        init: ['manifest'], plan: ['manifest'], status: ['manifest', 'context', 'container'],
        install: ['manifest', 'context', 'confirm'], configure: ['manifest', 'context', 'container', 'output', 'confirm'],
    };
    if (!Object.hasOwn(allowed, action) || rest.length % 2) fail('arguments_invalid');
    const options = { action };
    for (let i = 0; i < rest.length; i += 2) {
        const key = rest[i].startsWith('--') ? rest[i].slice(2) : '';
        if (!allowed[action].includes(key) || Object.hasOwn(options, key) || !rest[i + 1] || rest[i + 1].startsWith('--')) fail('arguments_invalid');
        options[key] = rest[i + 1];
    }
    privatePath(options.manifest);
    if (['status', 'install', 'configure'].includes(action) && !identifier(options.context)) fail('arguments_invalid');
    if (options.container !== undefined && !identifier(options.container)) fail('arguments_invalid');
    if (action === 'configure') privatePath(options.output);
    return options;
}

export function dockerFailure(result, args) {
    const code = result.error?.code === 'ENOENT' ? 'docker_cli_missing'
        : result.status === 127 ? 'docker_executable_missing'
            : result.status === 126 || result.error?.code === 'EACCES' ? 'docker_executable_denied'
                : result.error?.code === 'ETIMEDOUT' ? 'docker_command_timeout' : 'docker_unavailable';
    const execIndex = args[0] === '--context' ? 2 : 0;
    const executable = args[execIndex] === 'exec' && /^[a-zA-Z0-9_.-]{1,64}$/u.test(args[execIndex + 2] ?? '')
        ? args[execIndex + 2] : 'docker';
    const details = { code, executable,
        ...(Number.isInteger(result.status) ? { exitCode: result.status } : {}),
        ...(/^[A-Z0-9_]{1,48}$/u.test(result.error?.code ?? '') ? { systemCode: result.error.code } : {}) };
    const error = new SetupError(code, details);
    if (Number.isInteger(result.status)) error.exitCode = result.status;
    return error;
}
export function runDocker(args, timeout = 8000) {
    // Private raw output is never logged or copied to qualification receipts.
    const result = spawnSync('docker', args, { encoding: 'utf8', timeout, maxBuffer: 128 * 1024, shell: false, env: dockerEnvironment() });
    if (result.error || result.status !== 0) throw dockerFailure(result, args);
    return result.stdout.trim();
}
const json = value => { try { return JSON.parse(value); } catch { fail('docker_unavailable'); } };
export function localEngine(context, run, options = {}) {
    if (options.proposed) return inspectLocalEngine(context, run, options.host);
    // Preserve the legacy v1 Unix/ARM64 rule; multiarchitecture is explicitly v2.
    const endpoint = run(['context', 'inspect', context, '--format', '{{.Endpoints.docker.Host}}']);
    if (!/^unix:\/\/\//u.test(endpoint) || /[\r\n\0]/u.test(endpoint)) fail('local_context_required');
    const info = json(run(['--context', context, 'info', '--format', '{"os":{{json .OSType}},"arch":{{json .Architecture}}}']));
    if (info.os !== 'linux' || !['aarch64', 'arm64'].includes(info.arch)) fail('platform_mismatch');
}
const containerFormat = '{"running":{{json .State.Running}},"status":{{json .State.Status}},"imageId":{{json .Image}},"ports":{{json .NetworkSettings.Ports}},"mountCount":{{len .Mounts}},"privileged":{{json .HostConfig.Privileged}},"network":{{json .HostConfig.NetworkMode}},"restart":{{json .HostConfig.RestartPolicy.Name}}}';
function names(context, container, run) {
    const exactName = container.replaceAll('.', '\\.');
    return run(['--context', context, 'container', 'ls', '--all', '--filter', `name=^/${exactName}$`, '--format', '{{.Names}}']).split('\n');
}
export function inspectStatus(manifest, context, container, run = runDocker, options = {}) {
    const proposed = manifest.schemaVersion === 'mediflow.who-local-sidecar.manifest.v2';
    const engine = localEngine(context, run, { proposed, host: options.host });
    if (proposed && engine.platform !== manifest.image.platform) fail('platform_mismatch');
    if (proposed && options.engineBinding) assertSameEngine(options.engineBinding, engine);
    const read = proposed ? (args, timeout) => {
        assertSameEngine(engine, localEngine(context, run, { proposed: true, host: options.host }));
        return run(args, timeout);
    } : run;
    if (!names(context, container, read).includes(container)) return { state: 'container_absent', matching: false };
    const c = json(read(['--context', context, 'container', 'inspect', container, '--format', containerFormat]));
    if (typeof c.imageId !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(c.imageId)) fail('docker_unavailable');
    const im = json(read(['--context', context, 'image', 'inspect', c.imageId, '--format', '{"digests":{{json .RepoDigests}},"os":{{json .Os}},"arch":{{json .Architecture}}}']));
    const ports = c.ports?.['80/tcp'];
    const matching = im.os === 'linux' && (proposed ? `linux/${engineArchitecture(im.arch)}` === manifest.image.platform : im.arch === 'arm64')
        && Array.isArray(im.digests) && im.digests.includes(`${manifest.image.repository}@${manifest.image.digest}`)
        && c.mountCount === 0 && c.privileged === false && typeof c.network === 'string' && c.network !== 'host' && !c.network.startsWith('container:')
        && c.restart === 'no' && Array.isArray(ports) && ports.length === 1
        && ports[0].HostIp === '127.0.0.1' && ports[0].HostPort === '8382'
        && Object.entries(c.ports).every(([key, value]) => key === '80/tcp' || value === null);
    return { state: !matching ? 'container_binding_mismatch' : c.running === true ? 'running' : 'container_not_running', matching };
}
export function checkPort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', () => reject(new SetupError('port_in_use')));
        server.listen({ host: '127.0.0.1', port: 8382, exclusive: true }, () => server.close(resolve));
    });
}
export function configurationText(manifest) {
    const errors = validateWhoLocalManifest(manifest, 'activate');
    if (errors.length) fail('prerequisites_incomplete', errors);
    return `MEDIFLOW_ICD_WHO_ENABLED=1\nMEDIFLOW_ICD_WHO_LOCAL_IMAGE_DIGEST=${manifest.image.digest}\nMEDIFLOW_ICD_WHO_LOCAL_DATASET_ID=${manifest.dataset.snapshotId}\n`;
}
export async function executeSetup(options, dependencies = {}) {
    const run = dependencies.run ?? runDocker;
    const portFree = dependencies.portFree ?? checkPort;
    const { action, context } = options;
    if (action === 'init') {
        writePrivate(options.manifest, readFileSync(new URL('../docs/who-local-sidecar.manifest.json', import.meta.url), 'utf8'));
        return { state: 'manifest_created', next: 'Compila lock del registry e accettazione esatta WHO, poi esegui plan. Nessun termine accettato da init.' };
    }
    const manifest = readManifest(options.manifest);
    const provisionErrors = validateWhoLocalManifest(manifest, 'provision');
    const activationErrors = validateWhoLocalManifest(manifest, 'activate');
    if (action === 'plan') return { state: provisionErrors.length ? 'prerequisites_incomplete' : activationErrors.length ? 'qualification_required' : 'recorded_prerequisites_complete', provisionErrors, activationErrors, execution: 'none', next: 'Le registrazioni non provano il servizio. Esegui status per un deployment esistente, install solo per uno nuovo.' };
    // No Docker command is issued before a valid fixed manifest and exact mutation consent.
    if (provisionErrors.length) fail('prerequisites_incomplete', provisionErrors);
    const container = options.container ?? CONTAINER_NAME;
    if (action === 'status') {
        const status = inspectStatus(manifest, context, container, run, { host: dependencies.host });
        return { ...status, activationErrors, message: MESSAGES[status.state] ?? 'Container in esecuzione; metadati coerenti. La ricerca applicativa resta da verificare.', next: activationErrors.length ? 'Completa inventario e qualifica offline/ripristino prima di configure.' : 'Esegui configure se desideri attivare MediFlow, poi la verifica di esempio nelle impostazioni.' };
    }
    if (action === 'configure') {
        if (options.confirm !== ENABLE_CONFIRMATION) fail('confirmation_required');
        const config = configurationText(manifest);
        const status = inspectStatus(manifest, context, container, run, { host: dependencies.host });
        if (status.state !== 'running') fail(status.state);
        writePrivate(options.output, config);
        return { state: 'configuration_written', next: 'Carica il file nel prossimo avvio autorizzato del server con Node 24 --env-file. Rileggi la configurazione e verifica il termine di esempio in Impostazioni > Terminologia WHO. Il processo corrente non e stato modificato.' };
    }
    if (action !== 'install') fail('arguments_invalid');
    if (options.confirm !== INSTALL_CONFIRMATION) fail('confirmation_required');
    if (manifest.dataset.snapshotId !== null || manifest.dataset.snapshotInventorySha256 !== null
        || manifest.dataset.offlineRestartVerified || manifest.dataset.restoreVerified) fail('fresh_qualification_required');
    const proposed = manifest.schemaVersion === 'mediflow.who-local-sidecar.manifest.v2';
    const engine = localEngine(context, run, { proposed, host: dependencies.host });
    if (proposed && engine.platform !== manifest.image.platform) fail('platform_mismatch');
    if (names(context, CONTAINER_NAME, run).includes(CONTAINER_NAME)) fail('container_conflict');
    await portFree();
    const image = `${manifest.image.repository}@${manifest.image.digest}`;
    const command = (phase, args, timeout) => { try { return run(['--context', context, ...args], timeout); } catch { fail(phase); } };
    command('pull_failed', ['image', 'pull', '--platform', manifest.image.platform, '--quiet', image], 15 * 60 * 1000);
    const id = command('create_failed', ['container', 'create', '--name', CONTAINER_NAME, '--platform', manifest.image.platform,
        '--label', `org.mediflow.owner=${owner}`, '--restart', 'no', '--publish', '127.0.0.1:8382:80',
        // @Codex: fixed in-image CA bundle enables the pinned WHO image TLS verification.
        '--env', 'SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt', '--env', 'acceptLicense=true', '--env', 'include=2026-01_en', '--env', 'saveAnalytics=false',
        '--env', 'enableDoris=false', '--env', 'fhirSupport=false', image]);
    if (!/^[0-9a-f]{64}$/u.test(id)) fail('create_failed');
    command('start_failed', ['container', 'start', id], 30000);
    return { state: 'container_started', next: 'Il dataset puo essere ancora in acquisizione. Completa inventario, snapshot e qualifica offline/ripristino secondo docs/icd-who-setup.md; poi plan e configure. Avvio non significa Search disponibile.' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        if (process.versions.node.split('.')[0] !== '24') fail('node24_required');
        if (process.argv.length === 3 && ['--help', '-h'].includes(process.argv[2])) {
            console.log('WHO locale 2.6.0 / 2026-01_en. Esegui dalla cartella MediFlow con Node 24.\ninit|plan --manifest /percorso/privato/manifest.json\nstatus --manifest PATH --context CONTESTO [--container NOME]\ninstall --manifest PATH --context CONTESTO --confirm install-who-2.6.0-2026-01_en\nconfigure --manifest PATH --context CONTESTO [--container NOME] --output /percorso/privato/who.env --confirm enable-who-2026-01_en\nSolo install scarica e avvia un nuovo container. configure scrive un nuovo file, non modifica il processo server.\nProcedura e qualifica: docs/icd-who-setup.md');
            process.exit(0);
        }
        const result = await executeSetup(parseArguments(process.argv.slice(2)));
        console.log(JSON.stringify(result, null, 2));
        if (['prerequisites_incomplete', 'container_absent', 'container_not_running', 'container_binding_mismatch'].includes(result.state)) process.exitCode = 1;
    } catch (error) {
        const known = error instanceof SetupError;
        console.log(JSON.stringify({ state: 'blocked', code: known ? error.code : 'arguments_invalid',
            message: known ? error.message : MESSAGES.arguments_invalid, errors: known ? error.details : [] }, null, 2));
        process.exitCode = 1;
    }
}
