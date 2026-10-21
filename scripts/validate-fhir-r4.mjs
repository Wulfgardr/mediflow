import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm, link } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { acquireArtifacts, artifactDirectory, digest, lockPath } from './fhir-validator-artifacts.mjs';
import { verifyValidatorCache } from './verify-fhir-validator-cache.mjs';
import { assertBaseProfiles, assessIssues, readOutcomes } from './fhir-r4-outcomes.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const save = async (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
function command(bin, args, options = {}) {
  const result = spawnSync(bin, args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 600_000, ...options });
  if (result.error || result.signal || result.status !== 0) throw new Error(`TOOL_COMMAND_FAILED:${bin}:${result.error?.message ?? result.signal ?? result.status}\n${result.stderr ?? ''}\n${result.stdout ?? ''}`);
  return result.stdout;
}
export function assertJavaVersion(version, lock, env = process.env) {
  const major = Number(/version "(\d+)/.exec(version)?.[1]);
  if (!major) throw new Error('JAVA_VERSION_UNREADABLE');
  const mismatch = major !== lock.javaMajor;
  if (mismatch && (env.CI || env.MEDIFLOW_FHIR_ALLOW_JAVA_MISMATCH !== '1')) throw new Error(`JAVA_LOCK_MISMATCH:${major}:expected-${lock.javaMajor}`);
  return { major, required: lock.javaMajor, mismatchOverride: mismatch, version: version.trim() };
}
export async function requireVerified(lock, directory) {
  const verified = await verifyValidatorCache(lock, directory);
  if (verified.state !== 'ARTIFACT_BYTES_VERIFIED') throw new Error(`ARTIFACT_INTEGRITY_REJECTED:${verified.files.filter(item => item.state !== 'MATCH').map(item => item.file).join(',')}`);
  return verified;
}
async function preparePackages(lock, home) {
  const cache = path.join(home, '.fhir/packages');
  await mkdir(cache, { recursive: true });
  const metadataReport = [];
  for (const item of lock.packages) {
    const directory = path.join(cache, `${item.name}#${item.version}`);
    await mkdir(directory);
    command('tar', ['-xzf', path.join(artifactDirectory, `${item.name}#${item.version}.tgz`), '-C', directory]);
    const metadata = await json(path.join(directory, 'package/package.json'));
    if (metadata.name !== item.name || metadata.version !== item.version) throw new Error('PACKAGE_IDENTITY_MISMATCH');
    metadataReport.push({ package: `${metadata.name}#${metadata.version}`, license: metadata.license ?? 'NOT_DECLARED', dependencies: metadata.dependencies ?? {} });
  }
  await writeFile(path.join(cache, 'packages.ini'), '[cache]\nversion=4\n');
  return metadataReport;
}
function isolatedInvocation(configFile) {
  if (process.platform === 'darwin') return ['sandbox-exec', ['-p', '(version 1) (allow default) (deny network*)', process.execPath, path.join(root, 'scripts/fhir-validator-offline.mjs'), configFile]];
  if (process.platform === 'linux') return ['sudo', ['-n', 'unshare', '--net', '--', 'setpriv', '--reuid', String(process.getuid()), '--regid', String(process.getgid()), '--clear-groups', process.execPath, path.join(root, 'scripts/fhir-validator-offline.mjs'), configFile]];
  throw new Error('PROCESS_NETWORK_SANDBOX_UNSUPPORTED');
}
async function falsifyIntegrity(lock, home) {
  const results = [];
  for (const target of ['validator_cli.jar', `${lock.packages[0].name}#${lock.packages[0].version}.tgz`]) {
    const directory = path.join(home, `tamper-${results.length}`);
    await mkdir(directory);
    const files = (await verifyValidatorCache(lock, artifactDirectory)).files;
    for (const file of files) {
      if (file.file !== target) await link(path.join(artifactDirectory, file.file), path.join(directory, file.file));
    }
    const bytes = await readFile(path.join(artifactDirectory, target));
    bytes[0] ^= 1;
    await writeFile(path.join(directory, target), bytes);
    let actual;
    try { await requireVerified(lock, directory); actual = 'ACCEPTED'; }
    catch (error) { actual = error.message; }
    if (actual !== `ARTIFACT_INTEGRITY_REJECTED:${target}`) throw new Error(`FALSIFICATION_FAILED:${target}`);
    await rm(directory, { recursive: true });
    results.push({ id: target.endsWith('.jar') ? 'jar-byte' : 'package-hash', expected: 'ARTIFACT_INTEGRITY_REJECTED', actual, classification: 'integrity', jvmStarted: false, passed: true });
  }
  return results;
}
export async function runGate({ outputDirectory, falsify = false }) {
  const started = performance.now();
  await mkdir(outputDirectory, { recursive: true });
  const report = { schemaVersion: 'mediflow.fhir-r4-gate.v1', revision: command('git', ['rev-parse', 'HEAD']).trim(), producer: 'web', producers: [], state: 'TOOL_ERROR', timingsMs: {}, falsifications: [] };
  let home;
  try {
    const lockBytes = await readFile(lockPath);
    const lock = JSON.parse(lockBytes);
    if (lock.validation?.minimumLevel !== 'warnings' || lock.validation?.showMessageIds !== true
        || lock.validation?.locale !== 'en-US' || lock.validation?.jurisdiction !== 'global') throw new Error('UNSUPPORTED_VALIDATION_SETTINGS');
    const env = { PATH: process.env.PATH, JAVA_HOME: process.env.JAVA_HOME, LANG: 'en_US.UTF-8' };
    const java = spawnSync('java', ['-version'], { encoding: 'utf8', env });
    if (java.error || java.status !== 0) throw new Error('JAVA_UNAVAILABLE');
    report.java = assertJavaVersion(java.stderr + java.stdout, lock);
    report.lockSha256 = digest(lockBytes);
    report.versions = { fhir: lock.fhirVersion, validator: lock.validator.version, packages: lock.packages };
    const acquisitionStart = performance.now();
    report.artifacts = (await acquireArtifacts(lock)).files;
    report.timingsMs.acquisition = Math.round(performance.now() - acquisitionStart);
    const cacheRoot = path.join(homedir(), '.cache/mediflow-fhir-validator');
    home = await mkdtemp(path.join(cacheRoot, 'run-'));
    const prepareStart = performance.now();
    const packageMetadata = await preparePackages(lock, home);
    const corpusDirectory = path.join(outputDirectory, 'corpus');
    await mkdir(corpusDirectory, { recursive: true });
    command(process.execPath, ['scripts/run-strip-types.mjs', 'scripts/fhir-r4-corpus.ts', corpusDirectory], { env: { ...env, HOME: home, MEDIFLOW_DATA_DIR: path.join(home, 'synthetic-data'), MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1' } });
    const artifacts = await json(path.join(corpusDirectory, 'manifest.txt'));
    for (const artifact of artifacts) {
      artifact.bundle = await json(path.join(corpusDirectory, artifact.file));
      assertBaseProfiles(artifact.bundle);
      artifact.sha256 = digest(await readFile(path.join(corpusDirectory, artifact.file)));
    }
    const corpus = [...artifacts];
    if (falsify) {
      report.falsifications.push(...await falsifyIntegrity(lock, home));
      const template = corpus.find(artifact => artifact.id === 'diagnosis-id');
      for (const id of ['illegal-gender', 'broken-reference', 'new-warning']) {
        const bundle = structuredClone(template.bundle);
        if (id === 'illegal-gender') bundle.entry[0].resource.gender = 'not-a-gender';
        if (id === 'broken-reference') bundle.entry[1].resource.subject.reference = 'urn:uuid:00000000-0000-4000-8000-000000000000';
        if (id === 'new-warning') bundle.entry[0].resource.contact = [{ name: { text: 'Synthetic contact' }, relationship: [{ text: 'Synthetic relationship' }] }];
        const file = `falsify-${id}.json`;
        await save(path.join(corpusDirectory, file), bundle);
        artifacts.push({ id, file, producer: 'web', bundle, falsification: true });
      }
      const ips = structuredClone(template.bundle);
      ips.meta = { profile: ['http://hl7.org/fhir/uv/ips/StructureDefinition/Bundle-uv-ips'] };
      let actual;
      try { assertBaseProfiles(ips); actual = 'ACCEPTED'; } catch (error) { actual = error.message; }
      if (actual !== 'UNLOCKED_PROFILE_CLAIM') throw new Error('FALSIFICATION_FAILED:ips');
      report.falsifications.push({ id: 'collection-as-ips', expected: 'UNLOCKED_PROFILE_CLAIM', actual, classification: 'profile-policy', jvmStarted: false, passed: true });
    }
    const settingsFile = path.join(home, 'fhir-settings.json');
    await save(settingsFile, lock.settings);
    const outcomeFile = path.join(outputDirectory, 'operation-outcomes.json');
    const configFile = path.join(home, 'invocation.json');
    const networkEvidence = path.join(outputDirectory, 'network-denial.json');
    const javaArgs = ['-Xmx3g', `-Duser.home=${home}`, '-jar', path.join(artifactDirectory, 'validator_cli.jar'), ...artifacts.map(artifact => path.join(corpusDirectory, artifact.file)), '-version', lock.fhirVersion,
      '-fhir-settings', settingsFile, '-tx', lock.validation.terminologyServer, '-txCache', lock.validation.terminologyCache, '-jurisdiction', lock.validation.jurisdiction, '-locale', lock.validation.locale,
      '-level', lock.validation.minimumLevel, '-show-message-ids', '-output', outcomeFile];
    await save(configFile, { networkEvidence, javaArgs, javaExecutable: command('which', ['java']).trim(), environment: { ...env, HOME: home } });
    await requireVerified(lock, artifactDirectory);
    report.timingsMs.preparation = Math.round(performance.now() - prepareStart);
    const [bin, args] = isolatedInvocation(configFile);
    const validationStart = performance.now();
    const result = spawnSync(bin, args, { cwd: home, env: { ...env, HOME: home }, encoding: 'utf8', timeout: 600_000, maxBuffer: 32 * 1024 * 1024 });
    await writeFile(path.join(outputDirectory, 'validator.log'), (result.stdout ?? '') + (result.stderr ?? ''));
    report.timingsMs.validation = Math.round(performance.now() - validationStart);

    report.validatorExitCode = result.status;
    report.invocation = { executable: 'java', arguments: javaArgs.map(arg => arg.replaceAll(home, '<isolated-home>').replaceAll(outputDirectory, '<report-directory>')), sandbox: process.platform === 'darwin' ? 'sandbox-exec deny network*' : 'unshare --net; setpriv to original uid/gid' };
    if (result.error || result.signal || ![0, 1].includes(result.status)) throw new Error(`TOOL_VALIDATOR_FAILED:${result.error?.message ?? result.signal ?? result.status}`);
    report.network = await json(networkEvidence);
    report.jvmInvocations = report.network.validatorStarted ? 1 : 0;
    if (report.network.state !== 'PROCESS_NETWORK_DENIED') throw new Error(`TOOL_NETWORK_PREFLIGHT_FAILED:${JSON.stringify(report.network.probes)}`);
    const outcomes = readOutcomes(await json(outcomeFile), artifacts);
    report.validatedArtifactCount = outcomes.size;
    if (result.status === 1 && ![...outcomes.values()].flat().some(issue => ['error', 'fatal'].includes(issue.severity))) throw new Error('TOOL_EXIT_WITHOUT_SEMANTIC_ERRORS');
    const warningBaseline = await json(new URL('../contracts/fhir/r4-warning-baseline.v1.json', import.meta.url));
    const errorBaseline = await json(new URL('../contracts/fhir/r4-error-baseline.v1.json', import.meta.url));
    if (warningBaseline.entries.some(entry => entry.severity !== 'warning') || errorBaseline.entries.some(entry => !['error', 'fatal'].includes(entry.severity))) throw new Error('BASELINE_SEVERITY_MISMATCH');
    report.assessment = assessIssues(corpus, outcomes, { entries: [...warningBaseline.entries, ...errorBaseline.entries] });
    report.baseline = { mode: errorBaseline.entries.length ? 'frozen-existing-errors' : 'strict', warningSha256: digest(JSON.stringify(warningBaseline)), errorSha256: digest(JSON.stringify(errorBaseline)) };
    const resourceCounts = {};
    report.sourceFiles = await Promise.all(['lib/fhir/bundle-mapper.ts', 'lib/fhir/clinical-adapter.ts', 'lib/fhir/patient-adapter.ts', 'lib/fhir/id.ts', 'scripts/fhir-r4-corpus.ts'].map(async file => ({ file, sha256: digest(await readFile(path.join(root, file))) })));
    report.workingTreeDirty = Boolean(command('git', ['status', '--porcelain', '--untracked-files=no']).trim());
    report.producers = [{ id: 'web', artifacts: corpus.map(artifact => {
      for (const { resource } of artifact.bundle.entry) resourceCounts[resource.resourceType] = (resourceCounts[resource.resourceType] ?? 0) + 1;
      return { id: artifact.id, file: artifact.file, sha256: artifact.sha256, covers: artifact.covers, issues: outcomes.get(artifact.file) };
    }), artifactTypes: { Bundle: corpus.length }, resourceCounts }];
    report.issueCounts = { bySeverity: {}, byIdentifier: {}, byResourceType: {} };
    for (const artifact of corpus) {
      for (const issue of outcomes.get(artifact.file)) {
        const counts = report.issueCounts;
        counts.bySeverity[issue.severity] = (counts.bySeverity[issue.severity] ?? 0) + 1;
        counts.byIdentifier[issue.identifier] = (counts.byIdentifier[issue.identifier] ?? 0) + 1;
        const type = /\/\*([^/]+)/.exec(issue.path)?.[1] ?? 'Bundle';
        const perType = counts.byResourceType[type] ??= {};
        perType[issue.severity] = (perType[issue.severity] ?? 0) + 1;
      }
    }
    report.terminology = {
      state: 'NOT_VERIFIED_OFFLINE', verifiedBindings: [],
      unverifiedBindings: ['AdministrativeGender external terminology checks', 'ICD-9 / ICD-10 / ICD-11 diagnosis codes', 'LOINC observation codes and display', 'UCUM quantities and units', 'Condition clinical status', 'Encounter class', 'MedicationStatement status'],
      reason: 'Terminology server and terminology cache disabled (-tx n/a -txCache n/a). Structural/required-code diagnostics do not establish complete terminology validity.',
      packageMetadata,
      licensingLimit: 'Package license declarations do not grant additional rights for external terminologies or redistribution.',
    };
    if (falsify) {
      for (const id of ['illegal-gender', 'broken-reference', 'new-warning']) {
        const artifact = artifacts.find(item => item.id === id);
        const issues = outcomes.get(artifact.file);
        const expected = id === 'illegal-gender' ? issues.filter(issue => ['error', 'fatal'].includes(issue.severity) && ['UNABLE_TO_INFER_CODESYSTEM', 'Terminology_TX_NoValid_16'].includes(issue.identifier) && /gender/i.test(issue.path))
          : id === 'broken-reference' ? issues.filter(issue => issue.identifier === 'Bundle_BUNDLE_Not_Local' && /subject/i.test(issue.path))
            : issues.filter(issue => issue.severity === 'warning' && issue.identifier === 'Terminology_TX_Code_ValueSet_Ext' && /contact\[0\]\.relationship\[0\]/.test(issue.path));
        const assessment = assessIssues([{ ...artifact, id: 'diagnosis-id' }], outcomes, { entries: [...warningBaseline.entries, ...errorBaseline.entries].filter(entry => entry.artifact === 'diagnosis-id') });
        if (!expected.length || assessment.passed || !assessment.new.some(fresh => expected.some(issue => fresh.identifier === issue.identifier && fresh.path === issue.path))) throw new Error(`FALSIFICATION_FAILED:${id}`);
        report.falsifications.push({ id, expected: 'SEMANTIC_REJECTION', actual: expected, classification: 'semantic', passed: true });
      }
    }
    report.state = report.assessment.passed ? (errorBaseline.entries.length ? 'PASS_FROZEN_BASELINE' : 'PASS') : 'SEMANTIC_REJECTION';
    report.claim = errorBaseline.entries.length || !report.assessment.passed ? 'Corpus checked against FHIR R4 4.0.1 base; existing defects listed, no corpus conformance claim; terminology not verified offline.' : 'validato contro FHIR R4 4.0.1 base, terminologia non verificata offline';
  } catch (error) {
    report.state = 'TOOL_ERROR'; report.error = error.message;
  } finally {
    report.timingsMs.total = Math.round(performance.now() - started);
    await save(path.join(outputDirectory, 'report.json'), report);
    const summary = renderTextReport(report);
    await writeFile(path.join(outputDirectory, 'report.txt'), summary + '\n');
    console.log(summary);
    if (home) await rm(home, { recursive: true, force: true });
  }
  return report;
}
export function renderTextReport(report) {
  return [
    `FHIR R4 Web gate: ${report.state}`,
    `Revision: ${report.revision}; working tree dirty: ${report.workingTreeDirty ?? 'NOT_ASSESSED'}`,
    `Producer: web; artifacts: ${report.producers[0]?.artifacts.length ?? 'NOT_RUN'}`,
    `Resource counts: ${JSON.stringify(report.producers[0]?.resourceCounts ?? {})}`,
    `Issue counts: ${JSON.stringify(report.issueCounts ?? {})}`,
    `Versions: FHIR ${report.versions?.fhir ?? 'NOT_RUN'}; validator ${report.versions?.validator ?? 'NOT_RUN'}`,
    `Lock SHA-256: ${report.lockSha256 ?? 'NOT_RUN'}`,
    ...(report.artifacts ?? []).map(item => `Artifact: ${item.file} ${item.sha256} ${item.state}`),
    `Java: ${JSON.stringify(report.java)}`,
    `Network: ${JSON.stringify(report.network)}`,
    `Times (ms): ${JSON.stringify(report.timingsMs)}`,
    `Baseline: ${JSON.stringify(report.baseline)}`,
    ...['known', 'new', 'stale'].flatMap(state => (report.assessment?.[state] ?? []).map(issue => `${state.toUpperCase()}: ${JSON.stringify(issue)}`)),
    'TERMINOLOGIA: non verificata offline. Nessuna dichiarazione di validità terminologica.',
    `Binding verificati: ${JSON.stringify(report.terminology?.verifiedBindings ?? [])}`,
    `Binding non verificati: ${JSON.stringify(report.terminology?.unverifiedBindings ?? [])}`,
    `Pacchetti/licenze: ${JSON.stringify(report.terminology?.packageMetadata ?? [])}`,
    ...(report.falsifications ?? []).map(item => `Falsification: ${JSON.stringify(item)}`),
    report.claim ?? '', report.error ?? '',
  ].join('\n');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--falsify'].includes(arg))) throw new Error('USAGE: node scripts/validate-fhir-r4.mjs [--falsify]');
  const outputDirectory = await mkdtemp(path.join(root, 'tmp-fhir-r4-'));
  console.log(`Reports: ${outputDirectory}`);
  const report = await runGate({ outputDirectory, falsify: args.includes('--falsify') });
  process.exitCode = ['PASS', 'PASS_FROZEN_BASELINE'].includes(report.state) ? 0 : report.state === 'SEMANTIC_REJECTION' ? 1 : 2;
}
