/* @Codex: PROPOSED WHO-TRIOS host-only boundary. Never import from Web/server routes. */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const digest = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/u.test(value);
const contextName = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/u.test(value);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export function platformError(code, missing = []) { const error = new Error(code); error.code = code; error.missing = missing; return error; }
const deny = (code, missing) => { throw platformError(code, missing); };
export function checkCancelled(signal) { if (signal?.aborted) deny('cancelled'); }
export const currentHost = () => ({ platform: process.platform, arch: process.arch });
export function assertSupportedHost(host) {
    if (!host || !['darwin', 'linux', 'win32'].includes(host.platform) || !['x64', 'arm64'].includes(host.arch)) deny('host_unsupported');
    return host;
}
export function engineArchitecture(value) {
    if (['arm64', 'aarch64'].includes(value)) return 'arm64';
    if (['amd64', 'x86_64'].includes(value)) return 'amd64';
    deny('platform_mismatch');
}
export function localDockerEndpoint(endpoint, hostPlatform) {
    if (typeof endpoint !== 'string' || endpoint.length > 1024 || /[\u0000-\u001f\u007f%?#]/u.test(endpoint)) return false;
    if (hostPlatform === 'win32') return ['npipe:////./pipe/docker_engine', 'npipe:////./pipe/dockerDesktopLinuxEngine'].includes(endpoint);
    if (!['linux', 'darwin'].includes(hostPlatform) || !endpoint.startsWith('unix:///')) return false;
    const filename = endpoint.slice(7);
    return filename.length > 1 && !filename.startsWith('//') && !filename.includes('\\')
        && !filename.endsWith('/') && path.posix.normalize(filename) === filename;
}
export function dockerEnvironment(environment = process.env) {
    const result = { ...environment };
    // Windows environment names are case-insensitive, including when copied to a plain object.
    const overrides = new Set(['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']);
    for (const name of Object.keys(result)) if (overrides.has(name.toUpperCase())) delete result[name];
    return result;
}
export function inspectLocalEngine(context, run, host = currentHost()) {
    assertSupportedHost(host);
    if (!contextName(context)) deny('local_context_required');
    const endpoint = run(['context', 'inspect', context, '--format', '{{.Endpoints.docker.Host}}']);
    if (!localDockerEndpoint(endpoint, host.platform)) deny('local_context_required');
    let info;
    try { info = JSON.parse(run(['--context', context, 'info', '--format', '{"os":{{json .OSType}},"arch":{{json .Architecture}},"id":{{json .ID}}}'])); }
    catch (error) { if (error.code?.startsWith('docker_')) throw error; deny('docker_unavailable'); }
    if (info?.os !== 'linux') deny('platform_mismatch');
    const arch = engineArchitecture(info.arch);
    if (typeof info.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9:._-]{7,127}$/u.test(info.id)) deny('engine_identity_required');
    return Object.freeze({ hostPlatform: host.platform, hostArch: host.arch, platform: `linux/${arch}`,
        endpointSha256: hash(endpoint), daemonIdSha256: hash(info.id) });
}
export function validEngineBinding(binding) {
    return exact(binding, ['hostPlatform', 'hostArch', 'platform', 'endpointSha256', 'daemonIdSha256'])
        && ['darwin', 'linux', 'win32'].includes(binding.hostPlatform) && ['x64', 'arm64'].includes(binding.hostArch)
        && ['linux/arm64', 'linux/amd64'].includes(binding.platform)
        && digest(binding.endpointSha256) && digest(binding.daemonIdSha256);
}
export function assertSameEngine(expected, actual) {
    if (!validEngineBinding(expected) || !validEngineBinding(actual)
        || Object.keys(expected).some(key => expected[key] !== actual[key])) deny('engine_identity_changed');
}

// These are descriptors in the supplied, hash-verified index, not deployment evidence.
export const WHO_IMAGE_DESCRIPTORS = Object.freeze({
    'linux/arm64': 'sha256:7555e43478202d3f9a25eeb2914cc5053414c9464ec6a9a7628c01375d5b0a5e',
    'linux/amd64': 'sha256:a63a4c1c73329ff2ebff616a0cde2089b6b0595dec25255844f57f5b1903a4b8',
});
const evidenceFiles = Object.freeze({
    'linux/arm64': ['docs/who-lock-evidence/2.6.0-arm64.json', 'docs/who-lock-evidence/2.6.0-readback.json'],
    'linux/amd64': ['docs/who-lock-evidence/2.6.0-amd64.json', 'docs/who-lock-evidence/2.6.0-amd64-readback.json'],
});
export const safeDatasetName = name => typeof name === 'string' && /^[a-zA-Z0-9_().-]{1,128}$/u.test(name) && !name.includes('..');
const defaultRead = relative => readFileSync(path.join(root, relative));
/** Offline evidence verification only. Injected read is for unit fixtures, never a CLI input. */
export function readReleaseTarget(platform = 'linux/arm64', read = defaultRead) {
    if (!Object.hasOwn(WHO_IMAGE_DESCRIPTORS, platform)) deny('platform_mismatch');
    try {
        const lock = JSON.parse(read('docs/who-local-release-lock.json'));
        const indexBytes = read('docs/who-lock-evidence/2.6.0-index.json');
        const index = JSON.parse(indexBytes);
        if (!exact(lock, ['schemaVersion', 'repository', 'version', 'include', 'indexDigest', 'targets', 'datasetFiles'])
            || lock.schemaVersion !== 'mediflow.who-release-lock.v2' || lock.repository !== 'whoicd/icd-api'
            || lock.version !== '2.6.0' || lock.include !== '2026-01_en'
            || lock.indexDigest !== 'sha256:1b77eb6dc43e0c65a12e9e9340ad178493c93488e728d0d936507cc57ada1b7c'
            || hash(indexBytes) !== lock.indexDigest || index.schemaVersion !== 2
            || index.mediaType !== 'application/vnd.oci.image.index.v1+json' || !Array.isArray(index.manifests)
            || !exact(lock.targets, ['linux/arm64', 'linux/amd64'])
            || !Array.isArray(lock.datasetFiles) || lock.datasetFiles.length !== 5 || new Set(lock.datasetFiles).size !== 5
            || !lock.datasetFiles.every(safeDatasetName)) deny('release_lock_invalid');
        for (const [targetPlatform, imageDigest] of Object.entries(WHO_IMAGE_DESCRIPTORS)) {
            const entry = lock.targets[targetPlatform];
            const descriptors = index.manifests.filter(m => m.platform?.os === 'linux' && m.platform.architecture === targetPlatform.slice(6));
            if (!exact(entry, ['imageDigest', 'registryEvidenceSha256', 'registryVerifiedAt']) || entry.imageDigest !== imageDigest
                || descriptors.length !== 1 || descriptors[0].digest !== imageDigest
                || descriptors[0].mediaType !== 'application/vnd.oci.image.manifest.v1+json'
                || !Number.isSafeInteger(descriptors[0].size) || descriptors[0].size < 1) deny('release_lock_invalid');
        }
        const target = lock.targets[platform];
        const common = { schemaVersion: lock.schemaVersion, repository: lock.repository, version: lock.version, include: lock.include,
            indexDigest: lock.indexDigest, platform, ...target, datasetFiles: Object.freeze([...lock.datasetFiles]) };
        const [childPath, readbackPath] = evidenceFiles[platform];
        const missing = [], bytes = [];
        for (const relative of [childPath, readbackPath]) {
            try { bytes.push(read(relative)); }
            catch (error) { if (error.code !== 'ENOENT') throw error; missing.push(relative); bytes.push(null); }
        }
        if (target.registryEvidenceSha256 === null || target.registryVerifiedAt === null) missing.push(`docs/who-local-release-lock.json#targets/${platform}`);
        if (missing.length) return Object.freeze({ ...common, evidenceState: 'missing_evidence', missing: Object.freeze(missing) });
        const [childBytes, readbackBytes] = bytes;
        const child = JSON.parse(childBytes), evidence = JSON.parse(readbackBytes);
        const descriptor = index.manifests.find(m => m.digest === target.imageDigest);
        if (hash(childBytes) !== target.imageDigest || childBytes.length !== descriptor.size
            || child.schemaVersion !== 2 || child.mediaType !== 'application/vnd.oci.image.manifest.v1+json'
            || !digest(child.config?.digest) || !Array.isArray(child.layers) || !child.layers.length
            || child.layers.some(layer => !digest(layer.digest) || !Number.isSafeInteger(layer.size) || layer.size < 1)
            || hash(readbackBytes) !== target.registryEvidenceSha256
            || evidence.repository !== lock.repository || evidence.tag !== lock.version || evidence.platform !== platform
            || evidence.imageDigest !== target.imageDigest || evidence.indexDigest !== lock.indexDigest
            || new Date(evidence.observedAt).toISOString() !== target.registryVerifiedAt
            || evidence.compressedLayerBytes !== child.layers.reduce((sum, layer) => sum + layer.size, 0)) deny('release_lock_invalid');
        return Object.freeze({ ...common, evidenceState: 'verified_metadata', missing: Object.freeze([]) });
    } catch (error) {
        if (error.code === 'platform_mismatch') throw error;
        deny('release_lock_invalid');
    }
}
export function requireReleaseEvidence(target) {
    if (target.evidenceState !== 'verified_metadata') deny('image_evidence_missing', target.missing);
    return target;
}
export function dockerPrerequisite(hostPlatform) {
    const action = 'Installa o avvia personalmente il runtime Docker locale scelto, verifica i suoi requisiti e termini, poi ripeti node scripts/who-local-onboarding.mjs setup. Questa procedura non installa Docker o VM.';
    switch (hostPlatform) {
        case 'win32': return `Windows: serve Node.js 24 e un motore Docker Linux accessibile da un named pipe locale ammesso. Gli eventuali prerequisiti WSL/virtualizzazione sono gestiti dall’operatore. ${action}`;
        case 'linux': return `Linux: serve Node.js 24 e accesso dell’utente a un motore Docker Linux su socket Unix locale. Non viene usato sudo né cambiato alcun gruppo. ${action}`;
        case 'darwin': return `macOS: serve Node.js 24 e un motore Docker Linux su socket Unix locale. ${action}`;
        default: return 'Host non supportato: serve macOS, Windows o Linux con Node.js 24 x64/arm64.';
    }
}

/** Paths remain host-only. Do not treat Node's Windows mode bits as an ACL. */
export function assertLocalStatePath(value, platform = process.platform) {
    if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/u.test(value)) deny('private_state_invalid');
    if (platform === 'win32') {
        if (!/^[A-Za-z]:\\/u.test(value) || value.includes('/') || value.slice(2).includes(':')) deny('private_state_invalid');
        const parts = value.slice(3).split('\\');
        if (!parts.length || parts.some(part => !part || ['.', '..'].includes(part) || /[<>"|?*]/u.test(part)
            || /[. ]$/u.test(part) || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu.test(part))) deny('private_state_invalid');
    } else if (!path.isAbsolute(value) || path.normalize(value) !== value) deny('private_state_invalid');
    return value;
}
export function defaultWhoDirectory(host = currentHost(), environment = process.env, home = os.homedir()) {
    assertSupportedHost(host);
    if (host.platform === 'win32') {
        if (!environment.LOCALAPPDATA) deny('private_permissions_required');
        return assertLocalStatePath(path.win32.join(assertLocalStatePath(environment.LOCALAPPDATA, 'win32'), 'MediFlow', 'WHO', '2026-01_en'), 'win32');
    }
    if (host.platform === 'darwin') return path.posix.join(home, 'Library', 'Application Support', 'MediFlow', 'WHO', '2026-01_en');
    const base = environment.XDG_DATA_HOME || path.posix.join(home, '.local', 'share');
    assertLocalStatePath(base, 'linux');
    return path.posix.join(base, 'MediFlow', 'WHO', '2026-01_en');
}

// Fixed local PowerShell only. The target path and mode are environment data, never source interpolation.
export const WINDOWS_ACL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$p = $env:MEDIFLOW_WHO_ACL_TARGET
$mode = $env:MEDIFLOW_WHO_ACL_MODE
if ($mode -notin @('inspect','create')) { throw 'mode' }
if ($p -notmatch '^[A-Za-z]:\\' -or $p.Substring(2).Contains(':')) { throw 'path' }
$drive = [System.IO.DriveInfo]::new([System.IO.Path]::GetPathRoot($p))
if (-not $drive.IsReady -or $drive.DriveFormat -ne 'NTFS') { throw 'filesystem' }
$ancestor = $p
while ($ancestor) {
  if (Test-Path -LiteralPath $ancestor) {
    if (([System.IO.File]::GetAttributes($ancestor) -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'reparse' }
  }
  $parent = [System.IO.Path]::GetDirectoryName($ancestor)
  if ($parent -eq $ancestor) { break }
  $ancestor = $parent
}
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
if ($mode -eq 'create') {
  if (Test-Path -LiteralPath $p) { throw 'exists' }
  [void][System.IO.Directory]::CreateDirectory($p)
  $acl = [System.Security.AccessControl.DirectorySecurity]::new()
  $acl.SetOwner($sid)
  $acl.SetAccessRuleProtection($true, $false)
  $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, [System.Security.AccessControl.FileSystemRights]::FullControl,
    ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit),
    [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
  $acl.AddAccessRule($rule)
  Set-Acl -LiteralPath $p -AclObject $acl
}
$item = Get-Item -LiteralPath $p -Force
$acl = Get-Acl -LiteralPath $p
$rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object {
  @{ sid=$_.IdentityReference.Value; rights=[int64]$_.FileSystemRights; type=$_.AccessControlType.ToString() }
})
@{ ownerSid=$acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value; currentSid=$sid.Value;
   protected=$acl.AreAccessRulesProtected; isDirectory=[bool]$item.PSIsContainer;
   reparse=[bool](($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0);
   driveFormat=$drive.DriveFormat; rules=$rules } | ConvertTo-Json -Compress -Depth 5
`;
export function validWindowsAcl(report, directory = false) {
    const full = 0x1f01ff;
    if (!report || report.driveFormat !== 'NTFS' || report.reparse !== false || report.isDirectory !== directory
        || typeof report.currentSid !== 'string' || !/^S-1-5-[0-9-]+$/u.test(report.currentSid)
        || report.ownerSid !== report.currentSid || (directory && report.protected !== true)
        || !Array.isArray(report.rules) || !report.rules.length || report.rules.length > 64) return false;
    const allowed = new Set([report.currentSid, 'S-1-5-18', 'S-1-5-32-544']);
    return report.rules.every(rule => rule?.type === 'Allow' && allowed.has(rule.sid) && Number.isSafeInteger(rule.rights) && rule.rights >= 0)
        && report.rules.some(rule => rule.sid === report.currentSid && (rule.rights & full) === full);
}
export function windowsAcl(filename, { create = false, directory = false, execute = spawnSync } = {}) {
    assertLocalStatePath(filename, 'win32');
    const result = execute('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_ACL_SCRIPT], {
        encoding: 'utf8', timeout: 15000, maxBuffer: 32768, shell: false,
        env: { ...process.env, MEDIFLOW_WHO_ACL_TARGET: filename, MEDIFLOW_WHO_ACL_MODE: create ? 'create' : 'inspect' },
    });
    let report;
    try { if (result.error || result.status !== 0) throw new Error(); report = JSON.parse(result.stdout); }
    catch { deny('private_permissions_required'); }
    if (!validWindowsAcl(report, directory)) deny('private_permissions_required');
}
function assertNoSymlinkComponents(filename) {
    for (let part = filename; part !== path.dirname(part); part = path.dirname(part)) {
        if (existsSync(part) && lstatSync(part).isSymbolicLink()) deny('private_state_invalid');
    }
}
export function ensurePrivateDirectory(directory) {
    assertLocalStatePath(directory);
    assertNoSymlinkComponents(directory);
    if (process.platform === 'win32') {
        windowsAcl(directory, { create: !existsSync(directory), directory: true });
    } else {
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        const stat = lstatSync(directory);
        if (!stat.isDirectory() || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) deny('private_state_invalid');
    }
}
export function assertPrivateFile(filename, { maxBytes = 65536, payload = false } = {}) {
    assertLocalStatePath(filename); assertNoSymlinkComponents(filename);
    const stat = lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > maxBytes) deny('private_state_invalid');
    if (process.platform === 'win32') windowsAcl(filename);
    else if ((process.getuid && stat.uid !== process.getuid()) || (payload ? (stat.mode & 0o777) !== 0o644 : (stat.mode & 0o077) !== 0)) deny('private_state_invalid');
    return stat;
}
export function assertOutsideSource(directory) {
    // The private leaf may not exist yet; use the closest existing ancestor to reject source aliases.
    assertLocalStatePath(directory);
    let parent = directory;
    while (!existsSync(parent) && path.dirname(parent) !== parent) parent = path.dirname(parent);
    const canonical = path.join(realpathSync(parent), path.relative(parent, directory));
    const relative = path.relative(realpathSync(root), canonical);
    if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) deny('private_state_invalid');
}
export function appLaunchSpec(platform, sourceRoot = root) {
    switch (platform) {
        case 'darwin': return { executable: '/bin/bash', args: [path.join(sourceRoot, 'Start_MediFlow.command')] };
        case 'linux': return { executable: '/bin/bash', args: [path.join(sourceRoot, 'scripts', 'start-mediflow.sh')] };
        case 'win32': return { executable: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-File', path.win32.join(sourceRoot, 'Start-MediFlow.ps1')] };
        default: deny('host_unsupported');
    }
}
export function ownedLauncher(platform, sourceRoot = root) {
    if (/[\r\n\0]/u.test(sourceRoot)) deny('private_state_invalid');
    if (platform === 'win32') {
        const target = path.win32.join(sourceRoot, 'Setup_WHO.ps1').replaceAll("'", "''");
        return { name: 'Avvia MediFlow con WHO.ps1', content: `\ufeff# @Codex: fixed local entrypoint; no policy bypass.\n& '${target}' start\nexit $LASTEXITCODE\n` };
    }
    if (!['linux', 'darwin'].includes(platform)) deny('host_unsupported');
    const target = path.join(sourceRoot, platform === 'darwin' ? 'Setup_WHO.command' : 'Setup_WHO.sh').replaceAll("'", "'\\''");
    return { name: platform === 'darwin' ? 'Avvia MediFlow con WHO.command' : 'Avvia MediFlow con WHO.sh',
        content: `#!/bin/bash\n# @Codex: fixed local entrypoint; no data or credentials.\nexec /bin/bash '${target}' start\n` };
}
