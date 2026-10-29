import { accessSync, constants, createReadStream, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { approveRun, evaluateThresholds, fakeRunner, loadInputs, requireLocalVenue, runComparison } from './bench.ts';
import { describeAthenaMlxModelArtifact, generateWithAthenaMlx, resolveAthenaMlxLauncher } from '../../lib/athena-mlx-runtime.ts';

async function main() {
    const args = process.argv.slice(2);
    const mode = args.shift();
    if (!['--self-test', '--run', '--preflight'].includes(mode ?? '')) throw new Error('Usare --self-test, --preflight o --run');
    const options: Record<string, string> = {};
    while (args.length) {
        const key = args.shift()!;
        const value = args.shift();
        if (!['--venue', '--output', '--approval'].includes(key) || !value || options[key]) throw new Error('ARGUMENT_INVALID');
        options[key] = value;
    }
    requireLocalVenue(options['--venue'] ?? 'local_process', readFileSync(new URL('../../docs/adr/0166-athena-method-runner-boundary.md', import.meta.url), 'utf8'));
    if (!process.env.MEDIFLOW_DATA_DIR?.trim()) throw new Error('SYNTHETIC_DATA_DIR_REQUIRED');
    const inputs = loadInputs();
    if (mode === '--self-test') {
        const clean = await runComparison(inputs.corpus, fakeRunner, fakeRunner);
        assert.ok(clean.every(row => row.equivalent && row.expectedStatus));
        const falsification = [];
        for (const metric of ['sourcePage', 'negation', 'uncertainty', 'subject', 'time', 'inventedSources', 'unconfirmedWrites', 'malformed'] as const) {
            const rows = await runComparison(inputs.corpus, fakeRunner, (item, instruction) => fakeRunner(item, instruction, metric));
            const detected = rows.some(row => !row.equivalent);
            assert.ok(detected, metric);
            falsification.push({ mutation: metric, detected });
        }
        const report = { mode: 'deterministic_fake_only', qualification: false, ...inputs, clean, falsification, limits: ['Nessuna inferenza MLX', 'Nessuna qualifica clinica o parità Web/GPUI/chat', 'Broker e revoca sintetici; nessuna prova di arresto fisico'] };
        if (options['--output']) writeFileSync(options['--output'], JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
        console.log('Autoverifica: confronto pulito e 8 mutazioni rilevate. Nessuna qualifica I-7.');
        return;
    }
    const artifact = describeAthenaMlxModelArtifact();
    const launcher = resolveAthenaMlxLauncher();
    if (process.platform !== 'darwin' || process.arch !== 'arm64' || !artifact.available || launcher.mode !== 'direct') throw new Error('MLX_UNAVAILABLE: richiesti Apple Silicon, artifact completo e MEDIFLOW_ATHENA_MLX_GENERATE_BIN assoluto; nessun ripiego');
    accessSync(launcher.command, constants.X_OK);
    console.log('Preflight: artifact presente e launcher diretto eseguibile; inferenza non verificata.');
    if (mode === '--preflight') return;
    if (!options['--approval'] || !options['--output']) throw new Error('APPROVAL_AND_UNIQUE_OUTPUT_REQUIRED');
    const isolationProbe = spawnSync(process.execPath, ['-e', "const net = require('node:net'); const socket = net.connect(9, '127.0.0.1'); socket.on('error', error => process.exit(error.code === 'EPERM' || error.code === 'EACCES' ? 73 : 1)); socket.on('connect', () => process.exit(1)); setTimeout(() => process.exit(1), 1000);"], { timeout: 2000 });
    if (isolationProbe.status !== 73) throw new Error('NETWORK_DENIAL_NOT_VERIFIED');
    const approval = approveRun(JSON.parse(readFileSync(options['--approval'], 'utf8')), inputs);
    const fingerprints: Record<string, string> = {};
    for (const file of readdirSync(artifact.modelDir).filter(name => /(?:\.safetensors|\.json)$/.test(name))) {
        const digest = createHash('sha256');
        for await (const chunk of createReadStream(join(artifact.modelDir, file))) digest.update(chunk);
        fingerprints[file] = digest.digest('hex');
    }
    const runner = async (_item: unknown, prompt: string) => (await generateWithAthenaMlx({ prompt, modelDir: artifact.modelDir, temperature: 0, topP: 1, seed: 7, maxTokens: 1600, timeoutMs: 420_000 })).content;
    const rows = await runComparison(inputs.corpus, runner, runner);
    const thresholdResults = evaluateThresholds(rows, inputs.thresholds, true);
    const methodSha256 = createHash('sha256').update(readFileSync(new URL('../../lib/ai-providers/fabric/treatment-reasoning-athena-method.ts', import.meta.url))).digest('hex');
    const report = { methodSha256, thresholdResults, mode: 'mlx_local_network_denied', approval, corpusSha256: inputs.corpusSha256, thresholdsSha256: inputs.thresholdsSha256, startedAfterApproval: true, launcher, artifact, fingerprints, decoding: { temperature: 0, topP: 1, seed: 7, maxTokens: 1600 }, rows, semanticReview: 'pending', qualification: false };
    writeFileSync(options['--output'], JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    if (!thresholdResults.every(row => row.passed) || !rows.every(row => row.expectedStatus)) throw new Error('COMPARISON_OR_QUALITY_FAILED');
    console.log('Confronto tecnico completato. Revisione semantica e ammissione I-7 ancora richieste.');
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'BENCH_FAILED'); process.exitCode = 1; });
