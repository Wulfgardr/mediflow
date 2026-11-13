#!/usr/bin/env node
/** C-B, offline synthetic measurement. Never grants readiness or sends data. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGlinerRedactionRunner, readGlinerRuntimeObservation } from '../lib/gliner-redaction-runner';
import { createRedactionSession } from '../lib/ai-redaction-session';
import { createClinicalPreparation, readPreparedContent } from '../lib/chat-card/clinical-preparation';
import { ClinicalRowDenied } from '../lib/chat-card/clinical-identifiers';
import { assertClinicalBoundary, CLINICAL_PROFILE_VERSION, type ClinicalProfile } from '../lib/chat-card/clinical-profile';
import { REDACTION_WORKER_SHA256 } from '../lib/redaction-runtime-identity';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CORPUS = path.join(ROOT, 'scripts/fixtures/cb-redaction-acceptance.json');
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
type Range = { start: number; end: number };
type Annotation = Range & { type: string; text: string };
type Entry = { id: string; family: string; inputText: string; expected: Annotation[];
    knownIdentifiers?: { names?: string[]; birthDates?: string[]; identifiers?: string[] };
    unknownField?: Record<string, unknown>; preserveText?: boolean };
type Corpus = { schema: string; syntheticOnly: boolean; families: Record<string, { cases: number; identifiers: number }>; cases: Entry[] };
type Counts = { expected: number; stopped: number; escaped: number };

/** Count occurrences, including partial misses. Separators alone carry no identity. */
export function scoreAnnotations(text: string, expected: Annotation[], ranges: readonly Range[]) {
    return expected.map(annotation => {
        if (!Number.isInteger(annotation.start) || !Number.isInteger(annotation.end)
            || annotation.start < 0 || annotation.end <= annotation.start || annotation.end > text.length
            || text.slice(annotation.start, annotation.end) !== annotation.text) throw new Error('invalid_annotation');
        const uncovered: Range[] = [];
        let start = -1;
        for (let index = annotation.start; index <= annotation.end; index++) {
            const visible = index < annotation.end && !ranges.some(r => r.start <= index && index < r.end);
            if (visible && start < 0) start = index;
            if (!visible && start >= 0) { uncovered.push({ start, end: index }); start = -1; }
        }
        return { ...annotation, fullyCovered: uncovered.length === 0,
            stopped: uncovered.every(r => /^[\s\p{Cf}]*$/u.test(text.slice(r.start, r.end))),
            visibleFragments: uncovered.map(r => ({ ...r, text: text.slice(r.start, r.end) })) };
    });
}

export function validateCorpus(value: unknown): Corpus {
    const corpus = value as Corpus;
    if (!['mediflow.cb-acceptance.v1', 'mediflow.cb-reserve.v1'].includes(corpus.schema) || corpus.syntheticOnly !== true
        || !Array.isArray(corpus.cases) || !corpus.cases.length) throw new Error('invalid_corpus');
    const actual: Corpus['families'] = {};
    const ids = new Set<string>();
    for (const entry of corpus.cases) {
        if (!entry.id || ids.has(entry.id) || !entry.family || !entry.inputText?.isWellFormed()
            || !Array.isArray(entry.expected) || (!entry.expected.length && entry.preserveText !== true)) throw new Error('invalid_case');
        ids.add(entry.id);
        scoreAnnotations(entry.inputText, entry.expected, []);
        const ranges = new Set(entry.expected.map(e => `${e.start}:${e.end}`));
        if (ranges.size !== entry.expected.length) throw new Error('duplicate_annotation');
        const family = actual[entry.family] ??= { cases: 0, identifiers: 0 };
        family.cases++; family.identifiers += entry.expected.length;
    }
    for (const required of corpus.schema === 'mediflow.cb-acceptance.v1'
        ? ['cf_ocr', 'terze_persone', 'luoghi', 'nascita', 'nomi_file', 'campi_ignoti'] : ['cf_ocr', 'luoghi', 'campi_ignoti', 'contatti']) {
        if (!actual[required]?.identifiers) throw new Error('missing_family');
    }
    if (JSON.stringify(actual) !== JSON.stringify(corpus.families)) throw new Error('family_counts_mismatch');
    return corpus;
}

/** Uses the production card preparation, including strict unknown-field rejection.
 * This is before broker governance/consent, not a desktop or transport test. */
async function measureClinical(entry: Entry, configuration: Parameters<typeof createGlinerRedactionRunner>[0]) {
    const expected = { profile: CLINICAL_PROFILE_VERSION, version: 1, pseudonym: `card_${'a'.repeat(32)}`,
        diagnoses: [], noteExcerpts: [{ text: entry.inputText, sourceRef: `src_${'b'.repeat(32)}` }],
        ...entry.unknownField } as ClinicalProfile;
    const controller = new AbortController();
    const known = { names: entry.knownIdentifiers?.names ?? [], birthDates: entry.knownIdentifiers?.birthDates ?? [] };
    const job = createClinicalPreparation(expected, configuration, controller.signal, known);
    try {
        const token = await job.ready;
        const prepared = readPreparedContent(token);
        assertClinicalBoundary(prepared, expected, known);
        if ((prepared.content.noteExcerpts as { text: string }[])[0]?.text !== entry.inputText) throw new Error('unexpected_card_transform');
        // The card preserves row text by contract; returned text remains visible.
        return { state: 'prepared' as const, payload: prepared.payload, runtimeIdentity: prepared.redactionIdentity };
    } catch (error) {
        // Infrastructure failures must never be counted as successful rejection.
        if (error instanceof ClinicalRowDenied) return { state: 'denied' as const, reason: 'clinical_identifier' };
        if (error instanceof Error && error.name === 'ZodError') return { state: 'denied' as const, reason: 'strict_schema' };
        return { state: 'unproven' as const, reason: error instanceof Error ? error.message : 'unknown_error' };
    } finally { await job.close(); }
}

export async function measureCb(options: { pythonExecutable?: string; modelDirectory?: string; corpusPath?: string; negativeControl?: boolean; onCase?: (id: string) => void }) {
    const started = performance.now();
    const corpusPath = options.corpusPath ?? CORPUS;
    const corpusBytes = fs.readFileSync(corpusPath);
    const corpus = validateCorpus(JSON.parse(corpusBytes.toString('utf8')));
    const workerPath = path.join(ROOT, 'scripts/gliner-redaction-worker.py');
    if (hash(fs.readFileSync(workerPath)) !== REDACTION_WORKER_SHA256) throw new Error('worker_pin_mismatch');
    const configuration = options.negativeControl ? null : {
        pythonExecutable: path.resolve(options.pythonExecutable ?? ''),
        modelDirectory: path.resolve(options.modelDirectory ?? ''), workerPath,
    };
    if (!options.negativeControl && (!options.pythonExecutable || !options.modelDirectory)) throw new Error('runtime_paths_required');
    const sourceFiles = ['scripts/measure-cb-redaction.ts', 'lib/gliner-redaction-runner.ts', 'scripts/gliner-redaction-worker.py',
        'lib/redaction-runtime-identity.ts', 'lib/ai-redaction-session.ts', 'lib/ai-egress-gate.ts',
        'lib/chat-card/clinical-preparation.ts', 'lib/chat-card/clinical-identifiers.ts', 'lib/chat-card/clinical-profile.ts',
        ...['lib/redaction-identifier-spans.ts'].filter(name => fs.existsSync(path.join(ROOT, name)))];
    const sources = Object.fromEntries(sourceFiles.map(name => [name, hash(fs.readFileSync(path.join(ROOT, name)))]));
    const runner = configuration ? createGlinerRedactionRunner(configuration) : null;
    const families: Record<string, { redactor: Counts; clinical: Counts; unproven: number }> = {};
    const results = [];
    let runtimeIdentity: ReturnType<typeof readGlinerRuntimeObservation> = null;
    try {
        for (const entry of corpus.cases) {
            options.onCase?.(entry.id);
            const began = performance.now();
            // Gold annotations and unknown-field expectations never reach the runner.
            const neural = runner ? await runner.extract(entry.inputText) : [];
            if (runner) {
                runtimeIdentity = readGlinerRuntimeObservation(runner);
                if (!runtimeIdentity) throw new Error('real_runtime_identity_missing');
            }
            const session = createRedactionSession();
            try {
                const prepared = session.prepare({ text: entry.inputText, entities: neural, knownIdentifiers: entry.knownIdentifiers });
                if (prepared.rehydrate(prepared.redactedText) !== entry.inputText) throw new Error('roundtrip_failed');
                const annotations = scoreAnnotations(entry.inputText, entry.expected, prepared.spans);
                const clinical = configuration ? await measureClinical(entry, configuration) : { state: 'not_run' as const };
                const family = families[entry.family] ??= { redactor: { expected: 0, stopped: 0, escaped: 0 },
                    clinical: { expected: 0, stopped: 0, escaped: 0 }, unproven: 0 };
                family.redactor.expected += annotations.length;
                family.redactor.stopped += annotations.filter(e => e.stopped).length;
                family.redactor.escaped += annotations.filter(e => !e.stopped).length;
                if (clinical.state === 'denied' || clinical.state === 'prepared') {
                    family.clinical.expected += annotations.length;
                    family.clinical[clinical.state === 'denied' ? 'stopped' : 'escaped'] += annotations.length;
                } else if (clinical.state === 'unproven') family.unproven++;
                results.push({ id: entry.id, family: entry.family, inputText: entry.inputText, annotations,
                    neural, redactedText: prepared.redactedText, clinical,
                    controlPreserved: entry.preserveText ? prepared.redactedText === entry.inputText && clinical.state === 'prepared' : null,
                    clinicalControl: entry.preserveText ? { redactorPreserved: prepared.redactedText === entry.inputText,
                        visibleCharacters: entry.inputText.split('').filter((_, index) => !prepared.spans.some(s => s.start <= index && index < s.end)).length,
                        totalCharacters: entry.inputText.length, clinicalPrepared: clinical.state === 'prepared' } : null,
                    elapsedMs: Math.round(performance.now() - began) });
            } finally { session.close(); }
        }
    } finally { await runner?.close(); }
    if (hash(fs.readFileSync(corpusPath)) !== hash(corpusBytes)) throw new Error('corpus_changed');
    for (const [name, digest] of Object.entries(sources)) {
        if (hash(fs.readFileSync(path.join(ROOT, name))) !== digest) throw new Error('source_changed');
    }
    const misses = results.flatMap(c => c.annotations.filter(a => !a.stopped).map(a => ({ caseId: c.id, family: c.family, ...a })));
    const clinicalEscapes = results.filter(c => c.clinical.state === 'prepared' && c.annotations.length).map(c => c.id);
    const unproven = results.filter(c => c.clinical.state === 'unproven').map(c => c.id);
    const controlsPassed = results.filter(c => c.controlPreserved !== null).every(c => c.controlPreserved);
    return { schema: 'mediflow.cb-measurement.v1', generatedAt: new Date().toISOString(),
        mode: options.negativeControl ? 'negative_empty_runner' : 'real',
        passed: !!runtimeIdentity && misses.length === 0 && clinicalEscapes.length === 0 && unproven.length === 0 && controlsPassed,
        elapsedMs: Math.round(performance.now() - started), corpusSha256: hash(corpusBytes),
        corpusSchema: corpus.schema,
        gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
        sources,
        configuration, pythonResolvedPath: configuration ? fs.realpathSync(configuration.pythonExecutable) : null,
        runtimeIdentity, families, misses, clinicalEscapes, unproven, controlsPassed, results,
        limits: 'Misura locale del redattore condiviso e della preparazione clinica. Non prova consenso, trasporto, desktop, equivalenza clinica o identificativi fuori da questo corpus.' };
}

async function main() {
    const args = process.argv.slice(2);
    const value = (flag: string) => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
    const out = value('--out');
    if (!out) throw new Error('usage: --python ABS_PYTHON --model ABS_MODEL --out JSON | --negative-control --out JSON');
    const report = await measureCb({ pythonExecutable: value('--python'), modelDirectory: value('--model'), corpusPath: value('--corpus'),
        negativeControl: args.includes('--negative-control'), onCase: id => console.error(`C-B ${id}`) });
    fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log('famiglia\tattesi\tfermati\tsfuggiti\tscheda_fermati\tscheda_sfuggiti\tnon_provati');
    for (const [name, f] of Object.entries(report.families)) console.log([name, f.redactor.expected, f.redactor.stopped,
        f.redactor.escaped, f.clinical.stopped, f.clinical.escaped, f.unproven].join('\t'));
    for (const miss of report.misses) console.log(JSON.stringify({ sfuggito: miss }));
    console.log(JSON.stringify({ passed: report.passed, mode: report.mode, elapsedMs: report.elapsedMs,
        clinicalEscapes: report.clinicalEscapes, unproven: report.unproven, controlsPassed: report.controlsPassed, report: path.resolve(out) }));
    process.exitCode = report.passed ? 0 : report.unproven.length ? 2 : 1;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
    void main().catch(error => { console.error(error instanceof Error ? error.message : 'cb_measurement_failed'); process.exitCode = 2; });
}
