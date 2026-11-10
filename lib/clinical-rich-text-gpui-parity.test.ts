/* Il testo semplice di una voce di diario è lo stesso nel Web e in GPUI: i casi di
 * `rich_text_plain.json` passano qui per `clinicalRichTextToPlainText` e in Rust per
 * `rich_text_plain` (transport/src/local_host/rich_text.rs). Con MEDIFLOW_WRITE_FIXTURES
 * il file si riscrive dall'uscita Web. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { clinicalRichTextToPlainText } from './clinical-rich-text.ts';

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FILE = path.join(ROOT_DIR, 'experiments/gpui-patient-pilot/transport/tests/fixtures/rich_text_plain.json');

test('i casi condivisi con GPUI hanno il testo semplice del Web', () => {
    const cases = JSON.parse(fs.readFileSync(FILE, 'utf8')) as { name: string; input: string; plain: string }[];
    const built = cases.map((item) => ({ ...item, plain: clinicalRichTextToPlainText(item.input) }));
    if (process.env.MEDIFLOW_WRITE_FIXTURES !== undefined) fs.writeFileSync(FILE, `${JSON.stringify(built, null, 2)}\n`);
    for (const [index, item] of built.entries()) assert.equal(cases[index].plain, item.plain, item.name);
    assert.ok(built.every((item) => !/<\/?[a-z]/iu.test(item.plain) || item.name === 'tag non chiuso' || item.name === 'testo senza html'));
});
