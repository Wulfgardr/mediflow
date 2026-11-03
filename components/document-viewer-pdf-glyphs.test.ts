import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';

// Runs the real PDF.js engine with the preview configuration and the
// production operator admission, one isolated process per file.
type Glyph = { isInFont: boolean; unicode: string };
type Observation = { glyphs: Glyph[]; failures: string[] };
type Entry = { file: string; category: string; sha256: string };
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const support = new URL('./test-support/', import.meta.url);
const fixtures = new URL('./pdf-glyphs/', support);
const gpuiFixtures = path.join(root, 'experiments/gpui-patient-pilot/app/test_support/pdf-limits');
const manifest = JSON.parse(readFileSync(new URL('manifest.json', fixtures), 'utf8')) as Entry[];
function inspect(file: string): Observation {
    const result = spawnSync(process.execPath, [
        '--no-addons', '--import', pathToFileURL(path.join(root, 'scripts/register-strip-types-loader.mjs')).href,
        fileURLToPath(new URL('pdf-glyph-probe.mjs', support)), root, file,
    ], { encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout.trim().split('\n').at(-1)!) as Observation;
}
const fixture = (file: string) => fileURLToPath(new URL(file, fixtures));

test('a page whose digit or letter has no outline is refused instead of painted with a gap', () => {
    for (const file of [fixture('lab-missing-digit.pdf'), fixture('missing-glyph.pdf'),
        path.join(gpuiFixtures, 'simple-three-missing.pdf'), path.join(gpuiFixtures, 'cid-three-missing.pdf')]) {
        assert.ok(inspect(file).failures.includes('unresolved_glyph'), path.basename(file));
    }
});

test('legitimate exports, laboratory reports, OCR layers and encodings are not refused for glyphs', () => {
    let legitimate = 0;
    for (const row of manifest.filter(entry => entry.category !== 'review')) {
        const bytes = readFileSync(new URL(row.file, fixtures));
        assert.equal(createHash('sha256').update(bytes).digest('hex'), row.sha256, row.file);
        const result = inspect(fixture(row.file));
        assert.ok(!result.failures.includes('unresolved_glyph'), row.file);
        legitimate++;
    }
    assert.ok(legitimate > 0);
});

test('a blank advance is admitted whether the space glyph is valid or unresolved, since both paint the same', () => {
    for (const [valid, missing] of [['ambiguity-space.pdf', 'ambiguity-nonexistentSyntheticGlyph.pdf'],
        ['cid-ambiguity-space.pdf', 'cid-ambiguity-notdef.pdf']]) {
        const a = inspect(fixture(valid)), b = inspect(fixture(missing));
        assert.deepEqual(a.failures, []); assert.deepEqual(b.failures, []);
        assert.deepEqual(a.glyphs, b.glyphs);
        assert.ok(a.glyphs.every(glyph => glyph.unicode.trim() === ''));
    }
});
