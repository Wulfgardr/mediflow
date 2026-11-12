import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

type CopyChange = { file: string; removed: string[]; added: string[] };
const root = path.resolve(import.meta.dirname, '..');
const productRoot = process.env.MEDIFLOW_COPY_ROOT ?? root;
const read = (file: string) => fs.readFileSync(path.join(productRoot, file), 'utf8');
for (const surface of ['web']) {
    const rows = JSON.parse(execFileSync(process.execPath, ['scripts/ui-copy-census.mjs', `--surface=${surface}`, '--all'], { cwd: root, env: process.env, encoding: 'utf8' })) as { file: string; text: string }[];
    const changes = JSON.parse(fs.readFileSync(path.join(root, `scripts/fixtures/wul825-${surface}-copy.json`), 'utf8')) as CopyChange[];
    for (const change of changes) test(`${surface} visible copy: ${change.file}`, () => {
        const visible = new Set(rows.filter(row => row.file === change.file).map(row => row.text));
        for (const text of change.added) assert.ok(visible.has(text), `missing: ${text}`);
        for (const text of change.removed) assert.ok(!visible.has(text), `retired: ${text}`);
    });
    test(`${surface} has no retired visible names`, () => {
        assert.equal(execFileSync(process.execPath, ['scripts/ui-copy-census.mjs', `--surface=${surface}`, '--check'], { cwd: root, env: process.env, encoding: 'utf8' }).trim(), '[]');
    });
}

test('patient proposal keeps source review and removes repeated chart reassurance', () => {
    const source = read('components/ai-patient-insight.tsx');
    assert.match(source, /PATIENT_INSIGHT_REVIEW_NOTICE/);
    const proposal = source.slice(source.indexOf('data-testid="patient-insight-review-proposal"'), source.indexOf('title="Dettagli di verifica"'));
    assert.doesNotMatch(proposal, /cartella.*(?:invariata|non cambia)/);
    assert.match(source, /!preview && <p[^>]*>La cartella non cambia\./);
});

test('context bytes and fingerprint are inside Details at the context consent', () => {
    const source = read('components/function-models/function-model-picker.tsx');
    assert.match(source, /<Disclosure title="Dettagli">\s*<p>Contesto preparato ed oscurato: \{view.disclosure.payloadBytes\} byte\.<\/p>\s*<p>Impronta del contesto<\/p><code[^>]*>\{view.disclosure.payloadSha256\}<\/code>\s*<\/Disclosure>/);
    assert.equal(source.split('Restano applicabili le condizioni').length - 1, 1);
});

test('therapy proposals stay hidden while unavailable', () => {
    assert.match(read('components/treatment-reasoning-panel.tsx'), /return null;/);
});
