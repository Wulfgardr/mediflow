/* @Codex: post-fix provenance rules only; every URL below is inert test data. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { isExternalUrlLiteralAllowed } from './check-never-regress.mjs';
import { NEVER_REGRESS_ALLOWLIST } from './never-regress-allowlist.mjs';

const sourceUrl = 'https://www.shropscommunityhealth.nhs.uk/content/doclib/10756.pdf';
const sources = [
    ['lib/scales/tinetti-poma28-v1.ts', `    "sourceUrl": "${sourceUrl}",`],
    ['native/MediFlowMac/Sources/MediFlowCore/TinettiPOMA28.swift', `        sourceUrl: "${sourceUrl}",`],
];
for (const [relative, property] of sources) {
    test(`provenance exception is exact to file/property/literal: ${relative}`, () => {
        const source = fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
        assert.equal(source.split(/\r?\n/).filter(line => line.includes(sourceUrl)).length, 1);
        assert.ok(source.split(/\r?\n/).includes(property), 'the original readable literal stays unchanged');
        const rules = NEVER_REGRESS_ALLOWLIST.externalUrls.filter(rule => rule.path === relative);
        assert.equal(rules.length, 1);
        assert.match(rules[0].reason, /ADR 0118/);
        assert.equal(isExternalUrlLiteralAllowed(relative, sourceUrl, property), true);
        assert.equal(isExternalUrlLiteralAllowed('lib/unrelated.ts', sourceUrl, property), false);
        assert.equal(isExternalUrlLiteralAllowed(relative, sourceUrl, `fetch("${sourceUrl}")`), false);
        assert.equal(isExternalUrlLiteralAllowed(relative, sourceUrl, property.replace('sourceUrl', 'endpoint')), false);
        assert.equal(isExternalUrlLiteralAllowed(relative, sourceUrl, sourceUrl), false);
        for (const other of [sourceUrl + '?download=1', sourceUrl + '#page=1', sourceUrl + '.other',
            sourceUrl.replace('10756.pdf', 'other.pdf'), sourceUrl.replace('https:', 'http:')]) {
            assert.equal(isExternalUrlLiteralAllowed(relative, other, property.replace(sourceUrl, other)), false);
        }
        assert.equal(isExternalUrlLiteralAllowed(relative, sourceUrl, `${property} fetch("${sourceUrl}")`), false);
    });
}

test('native provenance path contains value encoding/comparison, not network APIs', () => {
    for (const name of ['TinettiPOMA28', 'ClinicalScaleSubmission', 'ClinicalScales', 'ScaleHistoryPresentation']) {
        const source = fs.readFileSync(new URL(`../native/MediFlowMac/Sources/MediFlowCore/${name}.swift`, import.meta.url), 'utf8');
        assert.doesNotMatch(source, /\b(?:URLSession|URLRequest|WKWebView|openURL|NSWorkspace)\b|\b(?:Data|String)\s*\(\s*contentsOf\s*:/);
        assert.deepEqual([...source.matchAll(/^import (\w+)$/gm)].map(match => match[1]), ['Foundation']);
    }
});
