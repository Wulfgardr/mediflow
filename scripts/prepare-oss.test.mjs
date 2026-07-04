/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    replaceBoundedSectionOrThrow,
    sanitizeContributingForOss,
    sanitizeSecurityForOss,
} = require('./prepare-oss.js');

function withTempDir(fn) {
    const dir = mkdtempSync(path.join(tmpdir(), 'mediflow-prepare-oss-'));
    try {
        return fn(dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

test('replaceBoundedSectionOrThrow strips a closed private section', () => {
    const input = [
        '# Public',
        '',
        '## Attribution (Codex / agent)',
        'private agent-only body',
        '---',
        '## Public Section',
        'safe body',
        '',
    ].join('\n');

    const output = replaceBoundedSectionOrThrow(input, {
        filePath: 'CONTRIBUTING.md',
        sectionName: 'Attribution (Codex / agent)',
        startPattern: /(?:^|\n)## [^\n]*Attribution \(Codex \/ agent\)[^\n]*\n/m,
        endPattern: /---\n/,
    });

    assert.doesNotMatch(output, /private agent-only body/);
    assert.match(output, /## Public Section/);
});

test('replaceBoundedSectionOrThrow rejects an unclosed private section', () => {
    const input = [
        '# Public',
        '',
        '## Attribution (Codex / agent)',
        'private agent-only body without terminator',
        '## Public Section',
        'safe body',
        '',
    ].join('\n');

    assert.throws(
        () => replaceBoundedSectionOrThrow(input, {
            filePath: 'CONTRIBUTING.md',
            sectionName: 'Attribution (Codex / agent)',
            startPattern: /(?:^|\n)## [^\n]*Attribution \(Codex \/ agent\)[^\n]*\n/m,
            endPattern: /---\n/,
        }),
        /Unclosed private OSS section/
    );
});

test('sanitizeContributingForOss fails instead of exporting unclosed attribution material', () => {
    withTempDir((dir) => {
        writeFileSync(path.join(dir, 'CONTRIBUTING.md'), [
            '# Contribuire',
            '',
            '## Attribution (Codex / agent)',
            'private agent-only body without terminator',
            '## Public Section',
            'safe body',
            '',
        ].join('\n'));

        assert.throws(
            () => sanitizeContributingForOss(dir),
            /Unclosed private OSS section in CONTRIBUTING\.md: Attribution/
        );
    });
});

test('sanitizeContributingForOss strips closed attribution material', () => {
    withTempDir((dir) => {
        const filePath = path.join(dir, 'CONTRIBUTING.md');
        writeFileSync(filePath, [
            '# Contribuire',
            '',
            '## Attribution (Codex / agent)',
            'private agent-only body',
            '---',
            '',
            '## Public Section',
            'safe body',
            '',
        ].join('\n'));

        sanitizeContributingForOss(dir);
        const output = readFileSync(filePath, 'utf8');
        assert.doesNotMatch(output, /private agent-only body/);
        assert.match(output, /## Public Section/);
    });
});

test('sanitizeSecurityForOss fails on an unclosed cloud comparator section', () => {
    withTempDir((dir) => {
        const filePath = path.join(dir, 'SECURITY.md');
        writeFileSync(filePath, [
            '# Security',
            '',
            '## Comparator cloud opt-in',
            'private comparator body',
            '## Logging e redazione',
            'safe body',
            '',
        ].join('\n'));

        assert.throws(
            () => sanitizeSecurityForOss(dir),
            /Unclosed private OSS section in SECURITY\.md: Comparator cloud opt-in/
        );
    });
});
