import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const line = (text, index) => text.slice(0, index).split('\n').length;
const cleanComments = text => text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, match => match.replace(/[^\n]/g, ' '));
const chromatic = 'red|orange|yellow|green|blue|purple|pink|cyan|mint|indigo|teal';
function rawSwiftColors(file, source) {
    if (file.endsWith('/Lume.swift')) return [];
    const text = cleanComments(source);
    const spans = [];
    const add = (m, value) => spans.push({ file, line: line(text, m.index), value });
    for (const m of text.matchAll(new RegExp(`\\bColor\\.(?:${chromatic})\\b`, 'g'))) add(m, m[0]);
    for (const m of text.matchAll(/\.(?:foregroundStyle|foregroundColor|tint|fill|stroke|background)\(([^\n]*)/g)) {
        for (const c of m[1].matchAll(new RegExp(`(?<![\\w.])\\.(?:${chromatic})\\b`, 'g'))) add(m, c[0]);
    }
    for (const m of text.matchAll(/(?:var|func)\s+\w+[^\n]*?(?::|->)\s*Color\s*\{/g)) {
        let depth = 1, end = m.index + m[0].length;
        while (end < text.length && depth) { if (text[end] === '{') depth++; if (text[end] === '}') depth--; end++; }
        const block = text.slice(m.index + m[0].length, end - 1);
        for (const c of block.matchAll(new RegExp(`\\breturn\\s+\\.(?:${chromatic})\\b`, 'g'))) {
            const at = m.index + m[0].length + c.index;
            spans.push({ file, line: line(text, at), value: c[0] });
        }
    }
    return spans.filter((x, i, a) => a.findIndex(y => y.line === x.line && y.value === x.value) === i);
}

function scan(dir) {
    return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => {
        const file = path.posix.join(dir, entry.name);
        return entry.isDirectory() ? scan(file)
            : file.endsWith('.swift') ? rawSwiftColors(file, fs.readFileSync(path.join(root, file), 'utf8')) : [];
    });
}
if (process.argv.includes('--self-test')) {
    assert.equal(rawSwiftColors('View.swift', 'var tone: Color { return .red }\nText(error).foregroundStyle(.red)').length, 2);
    assert.equal(rawSwiftColors('View.swift', 'Text(error).foregroundStyle(PlatformColors.signal(.critical))\nlet pill = AgendaPill.green').length, 0);
    assert.equal(rawSwiftColors('Lume.swift', 'Text(error).foregroundStyle(.red)').length, 1);
    assert.equal(rawSwiftColors('Shared/Lume.swift', 'Text(error).foregroundStyle(.red)').length, 0);
    console.log('PASS: fixture negative e positive Apple');
} else {
    const violations = scan('native/MediFlowMac/Sources');
    for (const item of violations) console.error(item);
    assert.equal(violations.length, 0, 'Colori SwiftUI fuori dai token Lume');
    console.log('PASS: apple, 0 colori SwiftUI fuori dai token');
}
