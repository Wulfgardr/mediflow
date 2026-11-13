#!/usr/bin/env node
/** Compare local rules only. Text comes exclusively from frozen repository fixtures. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRedactionSession } from '../lib/ai-redaction-session';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const BASE = '56f9dd5cdd4cec86d98347736f8d2e6d7170cf4b';
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
type Range = { start: number; end: number };
type Entry = { id: string; text: string; sourceRefs?: unknown[]; expectedIdentifiers?: (Range & { text: string })[] };
const covered = (ranges: readonly Range[], offset: number) => ranges.some(r => r.start <= offset && offset < r.end);

export async function measureClinicalFalsePositives() {
    const started = performance.now();
    const source = execFileSync('git', ['show', `${BASE}:lib/ai-redaction-session.ts`], { cwd: ROOT, encoding: 'utf8' });
    // Materialize code from Git, never a corpus or database from outside the repository.
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-cb-local-baseline-'));
    const baselinePath = path.join(scratch, 'session.ts');
    const rewritten = source.replaceAll("from './ai-egress-gate'", `from ${JSON.stringify(path.join(ROOT, 'lib/ai-egress-gate.ts'))}`)
        .replaceAll("from './redaction-contracts'", `from ${JSON.stringify(path.join(ROOT, 'lib/redaction-contracts.ts'))}`);
    fs.writeFileSync(baselinePath, rewritten, { mode: 0o600 });
    try {
        const { createRedactionSession: baseline } = await import(pathToFileURL(baselinePath).href) as { createRedactionSession: typeof createRedactionSession };
        const sets = [];
        for (const name of ['cb-clinical-independent', 'cb-clinical-challenge']) {
            const file = path.join(ROOT, `scripts/fixtures/${name}.json`), bytes = fs.readFileSync(file);
            const corpus = JSON.parse(bytes.toString('utf8')) as { syntheticOnly: boolean; counts: unknown; entries: Entry[] };
            if (corpus.syntheticOnly !== true) throw new Error('synthetic_corpus_required');
            const results = [];
            for (const entry of corpus.entries) {
                const before = baseline(), after = createRedactionSession();
                try {
                    const a = before.prepare({ text: entry.text, entities: [] }), b = after.prepare({ text: entry.text, entities: [] });
                    const words = [...entry.text.matchAll(/\p{L}[\p{L}\p{M}\p{N}]*/gu)].map(m => ({ start: m.index, end: m.index + m[0].length, text: m[0] }));
                    const added: Range[] = [];
                    let start = -1;
                    for (let i = 0; i <= entry.text.length; i++) {
                        const newlyCovered = i < entry.text.length && covered(b.spans, i) && !covered(a.spans, i);
                        if (newlyCovered && start < 0) start = i;
                        if (!newlyCovered && start >= 0) { added.push({ start, end: i }); start = -1; }
                    }
                    const newlyRemovedWords = words.filter(w => Array.from({ length: w.end - w.start }, (_, i) => w.start + i)
                        .some(i => covered(added, i)));
                    const identifiers = entry.expectedIdentifiers ?? [];
                    const clinicalWords = newlyRemovedWords.filter(w => !identifiers.some(r => r.start <= w.start && w.end <= r.end));
                    const newSpans = added.map(r => ({ ...r, text: entry.text.slice(r.start, r.end),
                        classification: clinicalWords.some(w => w.start < r.end && r.start < w.end) ? 'false_positive' : 'identifier',
                        clinicalWords: clinicalWords.filter(w => w.start < r.end && r.start < w.end),
                        context: entry.text.slice(Math.max(0, r.start - 100), Math.min(entry.text.length, r.end + 100)) }));
                    results.push({ id: entry.id, text: entry.text, sourceRefs: entry.sourceRefs, baselineSpans: a.spans.map(({ start, end }) => ({ start, end })),
                        currentSpans: b.spans.map(({ start, end }) => ({ start, end })), newSpans, newlyRemovedClinicalWords: clinicalWords });
                } finally { before.close(); after.close(); }
            }
            sets.push({ name, corpusSha256: sha(bytes), counts: corpus.counts, newSpans: results.reduce((n, r) => n + r.newSpans.length, 0),
                falsePositiveSpans: results.reduce((n, r) => n + r.newSpans.filter(s => s.classification === 'false_positive').length, 0),
                newlyRemovedClinicalWords: results.reduce((n, r) => n + r.newlyRemovedClinicalWords.length, 0), results });
        }
        return { schema: 'mediflow.cb-local-false-positives.v1', generatedAt: new Date().toISOString(), baseline: BASE,
            baselineSourceSha256: sha(source), currentHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
            sources: Object.fromEntries(['lib/ai-redaction-session.ts', 'lib/ai-egress-gate.ts', 'lib/redaction-identifier-spans.ts']
                .map(p => [p, sha(fs.readFileSync(path.join(ROOT, p)))])),
            method: 'No model, no knownIdentifiers. New spans are current source coverage minus baseline coverage. A clinical word is counted once if any character becomes newly covered; annotated identifiers are excluded. Source occurrences are counted per unique text. Mixed identifier/clinical spans are false positives.',
            elapsedMs: Math.round(performance.now() - started), sets };
    } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
    const report = await measureClinicalFalsePositives();
    const index = process.argv.indexOf('--out');
    if (index < 0 || !process.argv[index + 1]) throw new Error('--out NEW_JSON required');
    fs.writeFileSync(process.argv[index + 1], JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    for (const set of report.sets) console.log(JSON.stringify({ corpus: set.name, newSpans: set.newSpans,
        falsePositiveSpans: set.falsePositiveSpans, clinicalWords: set.newlyRemovedClinicalWords }));
}
