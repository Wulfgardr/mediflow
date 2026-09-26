/* @Codex */
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateDocumentQualityDevelopmentCorpus } from './document-quality-corpus.mjs';

const source = new URL('../../../scripts/fixtures/document-quality-development-corpus.json', import.meta.url);
const fixture = () => JSON.parse(readFileSync(source, 'utf8'));
const broken = (change) => { const value = fixture(); change(value); return value; };

test('validates all 12 unreviewed development cases and reports stable per-class source identities', () => {
  const first = validateDocumentQualityDevelopmentCorpus(fixture());
  const second = validateDocumentQualityDevelopmentCorpus(fixture());
  assert.deepEqual(first, second);
  assert.equal(first.cases.length, 12);
  assert.equal(first.partition, 'DEVELOPMENT_ONLY');
  assert.equal(first.corpusVersion, '1.0.0-development');
  assert.equal(first.clinicalReadiness, 'HOLD');
  assert.deepEqual(first.byClass['prompt injection'], ['Q11']);
  assert.deepEqual(first.byClass['mixed-subject'], ['Q12']);
  assert.match(first.corpusDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.ok(first.cases.every((item) => item.reviewStatus === 'pending'
    && /^sha256:[a-f0-9]{64}$/u.test(item.sourceDigest)));
});

test('rejects a missing source page and a broken exact span', () => {
  assert.throws(() => validateDocumentQualityDevelopmentCorpus(broken((data) => {
    data.cases[4].proposedFacts[1].evidence[0].page = 3;
  })), /source page missing/u);
  assert.throws(() => validateDocumentQualityDevelopmentCorpus(broken((data) => {
    data.cases[0].proposedFacts[0].evidence[0].start += 1;
  })), /broken source span/u);
  assert.throws(() => validateDocumentQualityDevelopmentCorpus(broken((data) => {
    const span = data.cases[1].proposedFacts[0].evidence[0];
    assert.equal(span.end, data.cases[1].pages[0].text.length, 'fixture quote reaches the source end');
    span.end = data.cases[1].pages[0].text.length + 1;
  })), /broken source span/u);
});

test('rejects a wrong patient or mixed-subject laundering', () => {
  assert.throws(() => validateDocumentQualityDevelopmentCorpus(broken((data) => {
    data.cases[2].proposedFacts[0].subjectRef = 'synthetic-B';
  })), /wrong fact subject/u);
  assert.throws(() => validateDocumentQualityDevelopmentCorpus(broken((data) => {
    data.cases[11].proposedFacts[0].evidence.pop();
  })), /must cite both subjects/u);
});

test('rejects changed critical classes and incomplete case coverage', () => {
  assert.throws(() => validateDocumentQualityDevelopmentCorpus(broken((data) => {
    data.cases[10].classes = ['status'];
  })), /critical class coverage/u);
  assert.throws(() => validateDocumentQualityDevelopmentCorpus(broken((data) => {
    data.cases.pop();
  })), /complete cases/u);
});

test('rejects missing review metadata and any claim of completed review', () => {
  assert.throws(() => validateDocumentQualityDevelopmentCorpus(broken((data) => {
    delete data.review;
  })), /expected exact keys/u);
  assert.throws(() => validateDocumentQualityDevelopmentCorpus(broken((data) => {
    data.review.status = 'accepted';
  })), /must remain pending/u);
  assert.throws(() => validateDocumentQualityDevelopmentCorpus(broken((data) => {
    delete data.cases[6].review;
  })), /expected exact keys/u);
});

test('rejects missing or altered version identity', () => {
  assert.throws(() => validateDocumentQualityDevelopmentCorpus(broken((data) => {
    delete data.cases[0].caseVersion;
  })), /expected exact keys/u);
  assert.throws(() => validateDocumentQualityDevelopmentCorpus(broken((data) => {
    data.corpusVersion = '2.0.0';
  })), /unsupported corpus version/u);
});
test('CLI refuses an input path without emitting a corpus report', () => {
  const script = new URL('../../../scripts/document-quality-corpus.mjs', import.meta.url);
  const result = spawnSync(process.execPath, [script.pathname, '/tmp/user-data.json'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /no arguments/u);
});
