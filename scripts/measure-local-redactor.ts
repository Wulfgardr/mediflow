#!/usr/bin/env node
/** Component benchmark. No broker authority, provider inference or archive access. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createGlinerRedactionRunner, readGlinerRuntimeObservation } from '../lib/gliner-redaction-runner';
import { createRedactionSession } from '../lib/ai-redaction-session';

const args = process.argv.slice(2);
const root = new URL('../', import.meta.url);
const value = (name: string) => args[args.indexOf(name) + 1];
for (const name of ['--python', '--model', '--fixture', '--out', '--permit']) {
    if (!args.includes(name) || !path.isAbsolute(value(name))) throw new Error(`absolute_path_required:${name}`);
}
// The owner issues this only after the shared machine is free to measure.
if (!fs.existsSync(value('--permit'))) throw new Error('measurement_permit_missing');
const fixtureBytes = fs.readFileSync(value('--fixture'));
const fixture = JSON.parse(fixtureBytes.toString());
if (fixture.syntheticOnly !== true || typeof fixture.text !== 'string' || fixture.text.length !== 10000) throw new Error('invalid_fixture');
const configuration = { pythonExecutable: value('--python'), modelDirectory: value('--model'), workerPath: new URL('scripts/gliner-redaction-worker.py', root).pathname };
const samples: { mode: string; run: number; phase: string; elapsedMs: number; outcome: string; error: string | null }[] = [];
let identity: ReturnType<typeof readGlinerRuntimeObservation> = null;
const out = value('--out');
const flush = () => fs.writeFileSync(out, JSON.stringify({ schema: 'mediflow.local-redactor-component.v1',
    sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    fixtureSha256: createHash('sha256').update(fixtureBytes).digest('hex'), characters: fixture.text.length,
    scope: 'gliner_and_redaction_session_component_only', identity, samples }, null, 2) + '\n');

for (const mode of ['cold', 'warm']) {
    const runner = mode === 'warm' ? createGlinerRedactionRunner(configuration) : null;
    try {
        for (let run = 1; run <= 30; run++) {
            const current = runner ?? createGlinerRedactionRunner(configuration);
            try {
                // One preliminary extraction for the warm distribution, never hidden.
                for (const phase of mode === 'warm' && run === 1 ? ['warmup', 'measured'] : ['measured']) {
                    const started = performance.now();
                    let outcome = 'ok', error: string | null = null;
                    const session = createRedactionSession();
                    try {
                        const entities = await current.extract(fixture.text, AbortSignal.timeout(120000));
                        identity = readGlinerRuntimeObservation(current);
                        if (!identity) throw new Error('runtime_identity_missing');
                        const prepared = session.prepare({ text: fixture.text, entities });
                        if (prepared.rehydrate(prepared.redactedText) !== fixture.text) throw new Error('round_trip_failed');
                    } catch (e) { outcome = 'error'; error = e instanceof Error ? e.message : 'unknown_error'; }
                    finally { session.close(); }
                    samples.push({ mode, run, phase, elapsedMs: performance.now() - started, outcome, error });
                    flush();
                    console.error(`${mode} ${run} ${phase}: ${outcome}`);
                }
            } finally { if (!runner) await current.close(); }
        }
    } finally { await runner?.close(); }
}
flush();
if (samples.some(s => s.outcome !== 'ok')) process.exitCode = 1;
