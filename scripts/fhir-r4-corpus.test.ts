import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { corpusInputs, generateCorpus } from './fhir-r4-corpus';

test('corpus serializes the real Web mapper and retains current branch behavior', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'mediflow-fhir-corpus-'));
  try {
    const artifacts = generateCorpus(directory);
    assert.equal(artifacts.length, 22);
    assert.equal(new Set(artifacts.map(item => item.file)).size, artifacts.length);
    for (const artifact of artifacts) {
      assert.deepEqual(JSON.parse(readFileSync(path.join(directory, artifact.file), 'utf8')), artifact.bundle);
      assert.equal(artifact.bundle.type, 'collection');
      assert.equal(artifact.producer, 'web');
    }
    const bundle = (id: string) => artifacts.find(item => item.id === id)!.bundle;
    assert.equal(bundle('scale-zero').entry[2].resource.valueInteger, 0);
    assert.equal(bundle('scale-fraction').entry[2].resource.valueInteger, 1.5);
    assert.equal(bundle('scale-nonfinite').entry.length, 2);
    assert.equal(bundle('encounters').entry.length, 4);
    assert.equal(bundle('diagnosis-unknown').entry[1].resource.code.coding, undefined);
    assert.equal(bundle('therapy-suspended').entry[1].resource.status, 'on-hold');
    assert.equal(bundle('observation-text').entry[1].resource.valueString, 'Synthetic text');
    assert.deepEqual(corpusInputs(), corpusInputs());
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
