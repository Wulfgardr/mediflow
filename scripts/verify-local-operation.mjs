import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const jar = process.env.TLA_JAR || path.join(os.homedir(), '.codex/tools/tlaplus/1.7.4/tla2tools.jar');
const expectedJar = '936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(fs.readFileSync(jar)), expectedJar, 'TLC artifact differs from pinned v1.7.4 / TLC 2.19');
const owned = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-cu1a-verification-'));
const evidence = [];
const outputDirectory = process.env.MEDIFLOW_FORMAL_OUTPUT;
if (outputDirectory && !path.isAbsolute(outputDirectory)) throw new Error('Absolute output directory required');
function run(label, executable, args, expected, pattern) {
    const result = spawnSync(executable, args, { cwd: root, encoding: 'utf8', timeout: 60_000,
        env: { ...process.env, MEDIFLOW_DATA_DIR: path.join(owned, 'data') }, maxBuffer: 4 * 1024 * 1024 });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    assert.equal(result.error, undefined, `${label}: execution error`);
    assert.equal(result.status, expected, `${label}: unexpected exit\n${output}`);
    assert.match(output, pattern, `${label}: semantic result missing`);
    evidence.push({ label, exitCode: result.status, expectedExitCode: expected, output });
    console.log(`${label}: PASS (exit ${result.status} expected)`);
}
function model(label, config, expected = 0, pattern = /No error has been found/) {
    const directory = path.join(owned, label); fs.mkdirSync(directory);
    fs.copyFileSync(path.join(root, 'docs/formal/local-operation/LocalOperation.tla'), path.join(directory, 'LocalOperation.tla'));
    fs.writeFileSync(path.join(directory, 'MC.cfg'), config);
    run(label, 'java', ['-Xmx512m', '-XX:+UseParallelGC', '-cp', jar, 'tlc2.TLC', '-workers', '1', '-metadir', path.join(directory, 'states'),
        '-config', path.join(directory, 'MC.cfg'), path.join(directory, 'LocalOperation.tla')], expected, pattern);
}
function copyCode(name) {
    const directory = path.join(owned, name); fs.mkdirSync(directory);
    for (const relative of ['lib/local-operation', 'lib/territorial-pack-contract.ts', 'lib/territorial-pack-store.ts', 'lib/territorial-packs.ts',
        'packages/mcp/src/local-operation-contract.ts', 'packages/mcp/src/local-operation-server.ts', 'packages/aip/src']) {
        const destination = path.join(directory, relative); fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.cpSync(path.join(root, relative), destination, { recursive: true });
    }
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    return directory;
}
function mutation(label, relative, before, after, pattern, suite) {
    const directory = copyCode(label), target = path.join(directory, relative), source = fs.readFileSync(target, 'utf8');
    assert.equal(source.split(before).length, 2, `${label}: mutation location drift`);
    fs.writeFileSync(target, source.replace(before, after));
    run(label, process.execPath, ['scripts/run-strip-types.mjs', '--test', `--test-name-pattern=${pattern}`, path.join(directory, suite)],
        1, /Missing expected rejection|Expected values to be strictly deep-equal|Expected values to be strictly equal/);
}
try {
    fs.mkdirSync(path.join(owned, 'data'));
    const config = fs.readFileSync(path.join(root, 'docs/formal/local-operation/MC.cfg'), 'utf8');
    const coveragePath = path.join(root, 'docs/formal/local-operation/coverage.json');
    if (fs.existsSync(coveragePath)) {
        const coverage = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
        for (const [file, digest] of Object.entries(coverage.files)) assert.equal(hash(fs.readFileSync(path.join(root, file))), digest, `Review model mapping before advancing ${file}`);
    }
    model('baseline', config);
    model('model-mutant', config.replace('UnsafePreparation = FALSE', 'UnsafePreparation = TRUE'), 12, /Invariant NoUnreconciledPreparation is violated/);
    model('completion-witness', config.replace('NoRepeatedAct NoUnreconciledPreparation ConfirmedHasReceipt', 'NoWitness'), 12, /Invariant NoWitness is violated/);
    model('manual-witness', config.replace('NoRepeatedAct NoUnreconciledPreparation ConfirmedHasReceipt', 'NoManualWitness'), 12, /Invariant NoManualWitness is violated/);
    mutation('runtime-recovery-mutant', 'lib/local-operation/service.ts',
        "if (current.effectPossible) throw new LocalOperationError('reconciliation_required');", 'if (false) throw new Error();',
        'risposta persa, riavvio', 'lib/local-operation/service.test.ts');
    mutation('runtime-session-mutant', 'lib/local-operation/service.ts', 'contextKey(context) !== binding.context', 'false',
        'capability vincolata al contesto', 'lib/local-operation/service.test.ts');
    mutation('wire-mutant', 'packages/mcp/src/local-operation-server.ts',
        'const response = localOperationResultSchema.safeParse(await port.request(input.data.arguments));',
        'const response = { success: true, data: await port.request(input.data.arguments) };',
        'metadati, errori', 'lib/local-operation/wire.test.ts');
    run('runtime-restored', process.execPath, ['scripts/run-strip-types.mjs', '--test',
        'lib/local-operation/local-operation.test.ts', 'lib/local-operation/service.test.ts', 'lib/local-operation/wire.test.ts',
        'lib/local-operation/host.test.ts'], 0, /fail 0/);
    model('model-restored', config);
    if (outputDirectory) {
        fs.mkdirSync(outputDirectory, { recursive: true });
        fs.writeFileSync(path.join(outputDirectory, 'result.json'), JSON.stringify({ tool: 'TLC 2.19 (v1.7.4)', jarSha256: expectedJar,
            at: new Date().toISOString(), results: evidence }, null, 2));
    }
} finally { fs.rmSync(owned, { recursive: true, force: true }); }
