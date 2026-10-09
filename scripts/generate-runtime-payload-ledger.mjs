import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertNodeRuntime, readNodeContract } from './node-runtime-contract.mjs';

const SCHEMA = 'mediflow.runtime-payload-ledger.v1';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function fail(message) { throw new Error(`Payload ledger: ${message}`); }
function physical(file, directory = false) {
  const absolute = path.resolve(file);
  const stat = fs.lstatSync(absolute);
  if (fs.realpathSync(absolute) !== absolute || stat.isSymbolicLink()
    || (directory ? !stat.isDirectory() : !stat.isFile())) fail('nonphysical input');
  return absolute;
}
function json(file) { return JSON.parse(fs.readFileSync(physical(file), 'utf8')); }
function relativeFile(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\')
    || path.posix.normalize(relative) !== relative || relative.startsWith('/')
    || relative === '..' || relative.startsWith('../')) fail('unsafe relative path');
  return physical(path.join(root, relative));
}
function record(file, relative) {
  const bytes = fs.readFileSync(physical(file));
  return { path: relative, bytes: bytes.length, sha256: hash(bytes),
    mode: (fs.statSync(file).mode & 0o7777).toString(8).padStart(4, '0') };
}
function walk(root, prefix = '') {
  return fs.readdirSync(physical(path.join(root, prefix), true)).sort().flatMap(name => {
    const relative = prefix ? `${prefix}/${name}` : name;
    const full = path.join(root, relative);
    const stat = fs.lstatSync(full);
    if (stat.isDirectory()) return walk(root, relative);
    physical(full);
    return [record(full, relative)];
  });
}
function licenseFiles(files, prefix = '') {
  return files.filter(file => file.path.startsWith(prefix)
    && /^(?:licen[sc]e|copying|notice|copyright)(?:[._-].*)?$/iu.test(path.posix.basename(file.path)))
    .map(({ path: name, bytes, sha256 }) => ({ path: name, bytes, sha256 }));
}
function assetKind(name) {
  if (/\.(?:node|dylib|so(?:\.\d+)*|dll|exe)$/iu.test(name)) return 'native';
  if (/\.(?:woff2?|ttf|otf)$/iu.test(name)) return 'font';
  if (/\.(?:safetensors|gguf|onnx|pt|pth|tiktoken)$/iu.test(name)) return 'model-or-tokenizer';
  if (/\.(?:csv|tsv|parquet)$/iu.test(name)) return 'reference-data';
  if (/\.(?:png|jpe?g|webp|svg|ico)$/iu.test(name)) return 'image';
  return 'other';
}
function declaredScope(location, metadata, manifest) {
  const name = location.split('node_modules/').at(-1);
  if (manifest.dependencies?.[name] && location === `node_modules/${name}`) return 'direct-runtime';
  if (manifest.devDependencies?.[name] && location === `node_modules/${name}`) return 'direct-development';
  return metadata.dev === true ? 'transitive-development' : 'transitive-runtime';
}
function lockedInventory(lock, manifest) {
  return Object.entries(lock.packages).filter(([location]) => location).map(([location, value]) => ({
    location, name: value.name || location.split('node_modules/').at(-1), version: value.version ?? null,
    scope: declaredScope(location, value, manifest), optional: value.optional === true,
    resolved: value.resolved ?? null, integrity: value.integrity ?? null,
    declaredLicense: value.license ?? null,
  })).sort((a, b) => a.location.localeCompare(b.location));
}
function installedPackages(payloadRoot, files, dependencies, profile) {
  const packageFiles = files.filter(file => file.path === 'package.json'
    || /(?:^|\/)node_modules\/(?:@[^/]+\/)?[^/]+\/package\.json$/u.test(file.path));
  return packageFiles.map(file => {
    const metadata = json(path.join(payloadRoot, file.path));
    const directory = path.posix.dirname(file.path);
    const location = directory.slice(directory.indexOf('node_modules/'));
    const matches = dependencies.filter(item => item.name === metadata.name && item.version === metadata.version);
    const exact = dependencies.find(item => item.location === location
      && item.name === metadata.name && item.version === metadata.version);
    const locked = exact || (matches.length === 1 ? matches[0] : null);
    return { location: directory, name: metadata.name ?? null, version: metadata.version ?? null,
      manifestSha256: file.sha256, lockLocation: locked?.location ?? null,
      lockMatch: locked ? 'NAME_AND_VERSION_MATCH' : 'UNRESOLVED',
      scope: locked?.scope ?? (file.path === 'package.json' && profile !== 'local-package' ? 'application' : 'unknown'),
      declaredLicense: metadata.license ?? null,
      notices: licenseFiles(files.filter(item => path.posix.dirname(item.path) === directory)),
      provenance: { resolved: locked?.resolved ?? null, integrity: locked?.integrity ?? null,
        verification: 'MANIFEST_METADATA_ONLY' } };
  });
}
function assertRecord(actual, expected, label) {
  if (!actual || !expected || actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) fail(`${label} bytes mismatch`);
}
function sourceAnchor(sourceRoot, git, anchors) {
  const format = git(['rev-parse', '--show-object-format']);
  if (!['sha1', 'sha256'].includes(format)) fail('unsupported Git object format');
  return relative => {
    const file = relativeFile(sourceRoot, relative);
    const entries = git(['--literal-pathspecs', 'ls-tree', '-z', 'HEAD', '--', relative]).split('\0').filter(Boolean);
    if (entries.length !== 1) fail(`source input is not tracked in the pinned commit: ${relative}`);
    const separator = entries[0].indexOf('\t');
    const header = entries[0].slice(0, separator).split(' ');
    if (separator < 0 || entries[0].slice(separator + 1) !== relative || header[1] !== 'blob'
      || !['100644', '100755'].includes(header[0])) fail('source input is not a regular tracked blob');
    const bytes = fs.readFileSync(file);
    const oid = createHash(format).update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if (oid !== header[2]) fail(`source input differs from the pinned blob: ${relative}`);
    const executable = (fs.statSync(file).mode & 0o111) !== 0;
    if (process.platform !== 'win32' && executable !== (header[0] === '100755')) fail('source Git executable mode mismatch');
    anchors.set(relative, { path: relative, blob: header[2], gitMode: header[0] });
  };
}
function localClosure(sourceRoot, payloadRoot, files, manifest, lock, packageName, anchor) {
  const reference = manifest.dependencies?.[packageName];
  if (!reference?.startsWith('file:') || !reference.endsWith('.tgz')) fail('local package must be a declared packed runtime dependency');
  const artifactPath = reference.slice(5);
  anchor(artifactPath);
  const archive = relativeFile(sourceRoot, artifactPath);
  const provenancePath = artifactPath.replace(/\.tgz$/u, '.provenance.json');
  anchor(provenancePath);
  const provenance = json(relativeFile(sourceRoot, provenancePath));
  if (provenance.schemaVersion !== 'mediflow.web-auth-lifecycle-owner.package-provenance.v1'
    || provenance.artifact?.path !== artifactPath || provenance.package?.name !== packageName
    || !Array.isArray(provenance.inputs) || !Array.isArray(provenance.roster)) fail('unsupported or wrong local provenance identity');
  const actualArchive = record(archive, artifactPath);
  assertRecord(actualArchive, provenance.artifact, 'packed archive');
  const integrity = `sha512-${createHash('sha512').update(fs.readFileSync(archive)).digest('base64')}`;
  const locked = lock.packages[`node_modules/${packageName}`];
  if (!locked || locked.version !== provenance.package.version || locked.resolved !== reference
    || locked.integrity !== integrity || provenance.artifact.integrity !== integrity) fail('manifest/lock/packed package identity mismatch');
  const sourcePackage = physical(path.dirname(path.dirname(archive)), true);
  const sourcePackageRelative = path.relative(sourceRoot, sourcePackage).split(path.sep).join('/');
  anchor(`${sourcePackageRelative}/package.json`);
  const sourceMetadata = json(path.join(sourcePackage, 'package.json'));
  const installedMetadata = json(path.join(payloadRoot, 'package.json'));
  for (const metadata of [sourceMetadata, installedMetadata]) {
    if (metadata.name !== packageName || metadata.version !== provenance.package.version) fail('source/installed package identity mismatch');
  }
  if (Object.keys(installedMetadata.dependencies ?? {}).length || Object.keys(installedMetadata.optionalDependencies ?? {}).length)
    fail('local closure only supports a dependency-free owner package');
  const expected = new Map();
  for (const entry of provenance.inputs) {
    if (expected.has(entry.path)) fail('duplicate source provenance member');
    anchor(`${sourcePackageRelative}/${entry.path}`);
    expected.set(entry.path, entry);
    assertRecord(record(relativeFile(sourcePackage, entry.path), entry.path), entry, 'source member');
  }
  const packed = new Map();
  for (const entry of provenance.roster) {
    if (typeof entry.path !== 'string' || !entry.path.startsWith('package/') || entry.type !== 'file'
      || !/^[0-7]{4}$/u.test(entry.mode)) fail('invalid packed roster');
    const name = entry.path.slice(8);
    if (packed.has(name)) fail('duplicate packed member');
    packed.set(name, entry);
    relativeFile(sourcePackage, name);
    assertRecord(expected.get(name), entry, 'source/packed roster');
  }
  if (files.length !== expected.size || packed.size !== expected.size) fail('missing or unexpected local package member');
  for (const file of files) {
    const expectedMember = packed.get(file.path);
    assertRecord(file, expectedMember, 'installed member');
    if (process.platform !== 'win32' && file.mode !== expectedMember.mode) fail('installed member mode mismatch');
  }
  anchor('LICENSE');
  return { status: 'SOURCE_PROVENANCE_INSTALLED_BYTES_MATCH', package: provenance.package,
    archiveDigestVerification: 'MATCH_TRACKED_PROVENANCE',
    archiveIntegrityVerification: 'MATCH_ROOT_LOCK_AND_TRACKED_PROVENANCE',
    provenanceRosterVerification: 'MATCH_TRACKED_SOURCE', archiveRosterVerification: 'NOT_CHECKED',
    installedObservedMembership: 'MATCH_TRACKED_PROVENANCE',
    installedObservedBytes: 'MATCH_TRACKED_SOURCE_AND_PROVENANCE',
    installedObservedModes: process.platform === 'win32' ? 'POSIX_MODES_NOT_QUALIFIED_ON_WINDOWS' : 'MATCH_PROVENANCE_POSIX_PERMISSIONS',
    artifact: { ...actualArchive, integrity }, provenance: record(relativeFile(sourceRoot, provenancePath), provenancePath),
    matchedMembers: files.length, installationMethod: 'NOT_ATTESTED_BY_INVENTORY',
    applicationLockInstallation: 'NOT_CHECKED',
    requiredNotices: { declaredPackageLicense: installedMetadata.license ?? null, packed: licenseFiles(files),
      sourceRootLicense: record(path.join(sourceRoot, 'LICENSE'), 'LICENSE'), redistributionReview: 'REQUIRED' } };
}
function runtimeIdentity(sourceRoot, payloadRoot, files, expected) {
  if (!expected || !expected.nodeVersion || !expected.nodeAbi || !expected.platform || !expected.arch)
    fail('standalone inventory requires an explicit expected Node/version/ABI/platform/architecture');
  const contract = readNodeContract(sourceRoot);
  const runtime = json(path.join(payloadRoot, 'mediflow-runtime-contract.json'));
  if (runtime.schemaVersion !== 1 || runtime.node?.major !== contract.major
    || Number(runtime.node?.version?.split('.')[0]) !== contract.major
    || runtime.node.version !== expected.nodeVersion || runtime.node.moduleVersion !== expected.nodeAbi
    || runtime.platform !== expected.platform || runtime.arch !== expected.arch) fail('runtime target identity mismatch');
  for (const name of ['server.js', 'package.json', '.next/BUILD_ID']) {
    if (!files.some(file => file.path === name)) fail(`missing standalone identity member ${name}`);
  }
  const build = files.find(file => file.path === 'mediflow-build-identity.json');
  if (build) {
    const identity = json(path.join(payloadRoot, build.path));
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim();
    if (identity.schemaVersion !== 1 || identity.revision !== revision
      || identity.buildId !== fs.readFileSync(path.join(payloadRoot, '.next/BUILD_ID'), 'utf8').trim()) fail('source/build identity mismatch');
  }
  return { status: 'DECLARED_TARGET_MATCH', declared: runtime,
    buildIdentity: build ? 'REVISION_AND_BUILD_ID_MATCH' : 'NOT_PRESENT',
    nodeBinary: 'EXTERNAL_NOT_INVENTORIED', nativeAbiExecution: 'NOT_CHECKED', launch: 'NOT_CHECKED' };
}

export function generatePayloadLedger({ sourceRoot, payloadRoot, profile, packageName, expectedRuntime }) {
  sourceRoot = physical(sourceRoot, true); payloadRoot = physical(payloadRoot, true);
  if (!['local-package', 'standalone'].includes(profile)) fail('supported profiles are local-package and standalone');
  const manifest = json(path.join(sourceRoot, 'package.json'));
  const lock = json(path.join(sourceRoot, 'package-lock.json'));
  if (lock.lockfileVersion !== 3 || !lock.packages?.['']) fail('requires npm lockfile v3');
  const git = args => execFileSync('git', args, { cwd: sourceRoot, encoding: 'utf8' }).trim();
  if (path.resolve(git(['rev-parse', '--show-toplevel'])) !== sourceRoot) fail('source must be the selected physical Git root');
  const anchors = new Map(), anchor = sourceAnchor(sourceRoot, git, anchors);
  for (const relative of ['package.json', 'package-lock.json', '.nvmrc']) anchor(relative);
  if (git(['diff', 'HEAD', '--', 'package.json', 'package-lock.json', '.nvmrc', 'packages/web-auth-lifecycle-owner']))
    fail('source identity inputs differ from the pinned commit');
  const files = walk(payloadRoot);
  const dependencies = lockedInventory(lock, manifest);
  const packages = installedPackages(payloadRoot, files, dependencies, profile);
  const closure = profile === 'local-package'
    ? localClosure(sourceRoot, payloadRoot, files, manifest, lock, packageName, anchor)
    : runtimeIdentity(sourceRoot, payloadRoot, files, expectedRuntime);
  const assets = files.filter(file => assetKind(file.path) !== 'other').map(file => ({ ...file,
    kind: assetKind(file.path), rights: 'REVIEW_REQUIRED', provenance: 'PAYLOAD_BYTES_ONLY' }));
  const notices = licenseFiles(files);
  return { schemaVersion: SCHEMA, profile,
    producer: { scriptSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))),
      nodeVersion: process.versions.node, platform: process.platform, arch: process.arch },
    source: { revision: git(['rev-parse', 'HEAD']), tree: git(['rev-parse', 'HEAD^{tree}']),
      worktreeDirty: Boolean(git(['status', '--porcelain', '--untracked-files=normal'])),
      manifest: record(path.join(sourceRoot, 'package.json'), 'package.json'),
      lock: record(path.join(sourceRoot, 'package-lock.json'), 'package-lock.json') },
    payload: { files: files.length, bytes: files.reduce((total, file) => total + file.bytes, 0),
      modeSemantics: process.platform === 'win32' ? 'WINDOWS_STAT_BITS_NOT_POSIX_QUALIFIED' : 'POSIX_PERMISSION_BITS',
      contentSha256: hash(Buffer.from(JSON.stringify(files))), roster: files },
    closure, packages, assets, notices,
    dependencyInputs: { meaning: 'LOCK_INPUT_INVENTORY_NOT_PAYLOAD_SBOM', dependencies,
      directRuntime: Object.keys(manifest.dependencies ?? {}).length,
      directDevelopment: Object.keys(manifest.devDependencies ?? {}).length },
    absentPackageManifests: dependencies.filter(item => !packages.some(pkg => pkg.lockLocation === item.location))
      .map(item => ({ location: item.location, status: profile === 'local-package' ? 'OUTSIDE_SCOPED_PACKAGE' : 'NOT_OBSERVED_AS_PACKAGE_MANIFEST',
        bundledCodePresence: profile === 'local-package' ? 'EXCLUDED_DEPENDENCY_FREE_PACKAGE' : 'UNKNOWN' })),
    checks: { advisories: 'NOT_CHECKED', redistributionRights: 'NOT_ESTABLISHED_BY_HASHES',
      cleanMachineInstallation: 'NOT_CHECKED', cleanApplicationLockInstall: 'NOT_CHECKED',
      headlessManifest: 'USE_EXISTING_STAGE_HEADLESS_RUNTIME_CHECK', optionalRuntimeProvisioning: 'NOT_PERFORMED' },
    sourceInputAnchoring: { status: 'TRACKED_HEAD_BLOBS_MATCH',
      files: [...anchors.values()].sort((a, b) => a.path.localeCompare(b.path)) } };
}

// The caller establishes the ledger's trust separately. This compares bytes;
// it neither admits code nor executes a runtime or native binding.
export function verifyPayloadLedger({ payloadRoot, ledger }) {
  if (ledger?.schemaVersion !== SCHEMA || !Array.isArray(ledger.payload?.roster)) fail('unsupported trusted ledger');
  const files = walk(physical(payloadRoot, true));
  if (files.length !== ledger.payload.files || files.length !== ledger.payload.roster.length
    || hash(Buffer.from(JSON.stringify(files))) !== ledger.payload.contentSha256) fail('payload roster identity mismatch');
  for (let index = 0; index < files.length; index++) {
    const actual = files[index], expected = ledger.payload.roster[index];
    if (actual.path !== expected.path || actual.mode !== expected.mode) fail('payload member identity mismatch');
    assertRecord(actual, expected, 'payload member');
  }
  return { status: 'TRUSTED_ROSTER_BYTES_MATCH', files: files.length };
}

function main() {
  const args = process.argv.slice(2);
  const options = {};
  const allowed = new Set(['source', 'payload', 'profile', 'package', 'output', 'node-version', 'node-abi', 'platform', 'arch', 'verify']);
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]?.replace(/^--/u, '');
    if (!args[index]?.startsWith('--') || !allowed.has(key) || !args[index + 1] || options[key]) fail('invalid command arguments');
    options[key] = args[index + 1];
  }
  if (options.verify) {
    if (!options.payload || Object.keys(options).some(key => !['verify', 'payload', 'source'].includes(key))) fail('--verify requires only --payload and optional --source');
    assertNodeRuntime(readNodeContract(options.source));
    const result = verifyPayloadLedger({ payloadRoot: options.payload, ledger: json(options.verify) });
    console.log(`[payload-ledger] ${result.status}: ${result.files} files`);
    return;
  }
  if (!options.source || !options.payload || !options.profile || !options.output) fail('--source --payload --profile --output are required');
  assertNodeRuntime(readNodeContract(options.source));
  const ledger = generatePayloadLedger({ sourceRoot: options.source, payloadRoot: options.payload,
    profile: options.profile, packageName: options.package,
    expectedRuntime: { nodeVersion: options['node-version'], nodeAbi: options['node-abi'], platform: options.platform, arch: options.arch } });
  const output = path.resolve(options.output);
  physical(path.dirname(output), true);
  if (output === path.resolve(options.payload) || output.startsWith(`${path.resolve(options.payload)}${path.sep}`)) fail('output must be outside payload');
  fs.writeFileSync(output, `${JSON.stringify(ledger, null, 2)}\n`, { flag: 'wx' });
  console.log(`[payload-ledger] ${ledger.profile}: ${ledger.payload.files} files, ${ledger.payload.bytes} bytes, ${ledger.closure.status}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
