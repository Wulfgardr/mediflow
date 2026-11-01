import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';

type Glyph = { isInFont: boolean; unicode: string; isSpace: boolean; originalCharCode: number };
type Observation = { glyphs: Glyph[]; fonts: unknown[]; failures: string[] };
type Entry = { file: string; category: string; sha256: string; flagFalse: boolean };
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const support = new URL('./test-support/', import.meta.url);
const fixtures = new URL('./pdf-glyphs/', support);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', fixtures), 'utf8')) as Entry[];
const observed = new Map<string, Observation>();
function inspect(file: string): Observation {
    const cached = observed.get(file);
    if (cached) return cached;
    const result = spawnSync(process.execPath, [
        '--no-addons', '--import', pathToFileURL(path.join(root, 'scripts/register-strip-types-loader.mjs')).href,
        fileURLToPath(new URL('pdf-glyph-probe.mjs', support)), root,
        fileURLToPath(new URL(file, fixtures)),
    ], { encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr);
    const value = JSON.parse(result.stdout.trim().split('\n').at(-1)!) as Observation;
    observed.set(file, value);
    return value;
}

test('real PDF.js exposes the missing A and digit 3 in the review PDFs', () => {
    for (const [file, character] of [['missing-glyph.pdf', 'A'], ['lab-missing-digit.pdf', '3']]) {
        const result = inspect(file);
        assert.deepEqual(result.failures, []);
        assert.ok(result.glyphs.some(glyph => glyph.unicode === character && glyph.isInFont === false));
    }
});
test('real PDF.js glyph records cannot distinguish a valid Base14 space from an unresolved used name', () => {
    const valid = inspect('ambiguity-space.pdf'), missing = inspect('ambiguity-nonexistentSyntheticGlyph.pdf');
    assert.deepEqual(valid.failures, []); assert.deepEqual(missing.failures, []);
    assert.equal(valid.glyphs.length, 1);
    assert.equal(valid.glyphs[0].isInFont, false);
    assert.deepEqual(valid.glyphs, missing.glyphs);
});
test('even extra exported font properties and rebuilt font bytes lose the original CID distinction', () => {
    const valid = inspect('cid-ambiguity-space.pdf'), missing = inspect('cid-ambiguity-notdef.pdf');
    assert.deepEqual(valid.failures, []); assert.deepEqual(missing.failures, []);
    assert.equal(valid.glyphs.length, 1); assert.equal(valid.glyphs[0].isInFont, false);
    assert.deepEqual(valid.glyphs, missing.glyphs);
    assert.deepEqual(valid.fonts, missing.fonts);
    function originalGlyphId(file: string) {
        const bytes = readFileSync(new URL(file, fixtures));
        const source = bytes.toString('latin1');
        const id = /\/CIDToGIDMap (\d+) 0 R/.exec(source)![1];
        const object = bytes.indexOf(`${id} 0 obj\n`);
        assert.ok(object >= 0);
        const stream = bytes.indexOf('stream\n', object) + 7;
        assert.ok(stream > object);
        return bytes.readUInt16BE(stream + 64);
    }
    assert.equal(originalGlyphId('cid-ambiguity-space.pdf'), 1);
    assert.equal(originalGlyphId('cid-ambiguity-notdef.pdf'), 0);
});
test('the same synthetic corpus quantifies false refusals from a strict isInFont rule', t => {
    let baselineRefused = 0, strictRefused = 0, controlsRefused = 0;
    for (const row of manifest.filter(entry => entry.category !== 'review')) {
        const bytes = readFileSync(new URL(row.file, fixtures));
        assert.equal(createHash('sha256').update(bytes).digest('hex'), row.sha256);
        const result = inspect(row.file);
        const flagFalse = result.glyphs.some(glyph => glyph.isInFont !== true);
        assert.equal(flagFalse, row.flagFalse, row.file);
        for (const glyph of result.glyphs.filter(glyph => !glyph.isInFont)) assert.equal(glyph.unicode, ' ', row.file);
        if (result.failures.length) baselineRefused++;
        if (flagFalse || result.failures.length) strictRefused++;
        if (row.category === 'valid-encoding-control' && flagFalse) controlsRefused++;
    }
    assert.equal(manifest.filter(row => row.category !== 'review').length, 30);
    assert.equal(baselineRefused, 2);
    assert.equal(strictRefused, 18);
    assert.equal(controlsRefused, 2);
    t.diagnostic(JSON.stringify({ legitimate: 30, baselineRefused, strictRefused, controlsRefused }));
});
