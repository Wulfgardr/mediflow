#!/usr/bin/env node
/** Compare local rules only. Text comes exclusively from frozen repository fixtures. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRedactionSession } from '../lib/ai-redaction-session';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const BASE = '56f9dd5cdd4cec86d98347736f8d2e6d7170cf4b';
const BASELINE_FILE = 'docs/quality/cb-clinical-fp-20261113-before.json';
const BASELINE_SHA256 = '824aa322d17436a44ecd312bc147cfe1e50b4dffa131061335bf1fc69c2495fd';
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
type Range = { start: number; end: number };
type Entry = { id: string; text: string; sourceRefs?: unknown[]; expectedIdentifiers?: (Range & { text: string })[] };
const covered = (ranges: readonly Range[], offset: number) => ranges.some(r => r.start <= offset && offset < r.end);
type FrozenBaseline = { baseline: string; baselineSourceSha256: string;
    sets: { name: string; corpusSha256: string; results: { id: string; text: string; baselineSpans: Range[] }[] }[] };

export async function measureClinicalFalsePositives() {
    const started = performance.now();
    // The historical run is frozen evidence, never executable runtime authority.
    const baselineBytes = fs.readFileSync(path.join(ROOT, BASELINE_FILE));
    if (sha(baselineBytes) !== BASELINE_SHA256) throw new Error('baseline_snapshot_changed');
    const baseline = JSON.parse(baselineBytes.toString('utf8')) as FrozenBaseline;
    if (baseline.baseline !== BASE) throw new Error('baseline_identity_mismatch');
    const sets = [];
    for (const name of ['cb-clinical-independent', 'cb-clinical-challenge']) {
        const file = path.join(ROOT, `scripts/fixtures/${name}.json`), bytes = fs.readFileSync(file);
        const corpus = JSON.parse(bytes.toString('utf8')) as { syntheticOnly: boolean; counts: unknown; entries: Entry[] };
        if (corpus.syntheticOnly !== true) throw new Error('synthetic_corpus_required');
        const frozen = baseline.sets.find(set => set.name === name);
        if (!frozen || frozen.corpusSha256 !== sha(bytes) || frozen.results.length !== corpus.entries.length) throw new Error('baseline_corpus_mismatch');
        const rows = new Map(frozen.results.map(row => [row.id, row]));
        if (rows.size !== frozen.results.length) throw new Error('baseline_duplicate_id');
        const results = [];
        for (const entry of corpus.entries) {
            const a = rows.get(entry.id);
            if (!a || a.text !== entry.text || a.baselineSpans.some(r => !Number.isInteger(r.start) || !Number.isInteger(r.end)
                || r.start < 0 || r.start >= r.end || r.end > entry.text.length)) throw new Error('baseline_row_mismatch');
            const after = createRedactionSession();
            try {
                const b = after.prepare({ text: entry.text, entities: [] });
                const words = [...entry.text.matchAll(/\p{L}[\p{L}\p{M}\p{N}]*/gu)].map(m => ({ start: m.index, end: m.index + m[0].length, text: m[0] }));
                const added: Range[] = [];
                let start = -1;
                for (let i = 0; i <= entry.text.length; i++) {
                    const newlyCovered = i < entry.text.length && covered(b.spans, i) && !covered(a.baselineSpans, i);
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
                results.push({ id: entry.id, text: entry.text, sourceRefs: entry.sourceRefs, baselineSpans: a.baselineSpans,
                    currentSpans: b.spans.map(({ start, end }) => ({ start, end })), newSpans, newlyRemovedClinicalWords: clinicalWords });
            } finally { after.close(); }
        }
        sets.push({ name, corpusSha256: sha(bytes), counts: corpus.counts, newSpans: results.reduce((n, r) => n + r.newSpans.length, 0),
            falsePositiveSpans: results.reduce((n, r) => n + r.newSpans.filter(s => s.classification === 'false_positive').length, 0),
            newlyRemovedClinicalWords: results.reduce((n, r) => n + r.newlyRemovedClinicalWords.length, 0), results });
    }
    return { schema: 'mediflow.cb-local-false-positives.v2', generatedAt: new Date().toISOString(), baseline: BASE,
        baselineSourceSha256: baseline.baselineSourceSha256,
        baselineSnapshot: { path: BASELINE_FILE, sha256: BASELINE_SHA256 },
        sources: Object.fromEntries(['lib/ai-redaction-session.ts', 'lib/ai-egress-gate.ts', 'lib/redaction-identifier-spans.ts']
            .map(p => [p, sha(fs.readFileSync(path.join(ROOT, p)))])),
        method: 'No model, no knownIdentifiers. New spans are current source coverage minus baseline coverage. A clinical word is counted once if any character becomes newly covered; annotated identifiers are excluded. Source occurrences are counted per unique text. Mixed identifier/clinical spans are false positives.',
        elapsedMs: Math.round(performance.now() - started), sets };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
    const report = await measureClinicalFalsePositives();
    const index = process.argv.indexOf('--out');
    if (index < 0 || !process.argv[index + 1]) throw new Error('--out NEW_JSON required');
    fs.writeFileSync(process.argv[index + 1], JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    for (const set of report.sets) console.log(JSON.stringify({ corpus: set.name, newSpans: set.newSpans,
        falsePositiveSpans: set.falsePositiveSpans, clinicalWords: set.newlyRemovedClinicalWords }));
}
