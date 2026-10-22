import '../../../scripts/register-strip-types-loader.mjs';
import { registerHooks } from 'node:module';
import { evidenceHash, redactionIdentityDigest } from '../../../lib/ai-redaction-evidence.ts';
import * as constants from '../../../lib/redaction-runtime-identity.ts';
import corpus from '../../../scripts/fixtures/chat-card-corpus.json' with { type: 'json' };
export const SENTINEL = 'IDENTIFYING_SENTINEL_Serena_Falsa_17_04_1972';
const identity = { schema: constants.REDACTION_RUNTIME_SCHEMA, adapter: constants.REDACTION_RUNTIME_ADAPTER,
  model: constants.REDACTION_RUNTIME_MODEL, revision: constants.REDACTION_RUNTIME_REVISION,
  workerSha256: constants.REDACTION_WORKER_SHA256, pythonSha256: 'a'.repeat(64),
  packages: constants.REDACTION_RUNTIME_PACKAGES, files: constants.REDACTION_RUNTIME_FILES };
globalThis.__cardTestRunner = {
  readGlinerRuntimeObservation: () => identity,
  createGlinerRedactionRunner: () => ({
    async extract(text) {
      if (process.argv.includes('--slow')) await new Promise(resolve => setTimeout(resolve, 300));
      const spans = [];
      for (const entity of new Map(corpus.flatMap(entry => entry.gold.entities).map(entity => [entity.text, entity])).values()) {
        let start = text.indexOf(entity.text);
        while (start >= 0) {
          spans.push({ type: entity.type, start, end: start + entity.text.length, text: entity.text, confidence: 1 });
          start = text.indexOf(entity.text, start + entity.text.length);
        }
      }
      return spans;
    }, async close() {},
  }),
};
registerHooks({
  resolve(name, context, next) {
    if (name.startsWith('.') && context.parentURL && /\/lib\/gliner-redaction-runner(?:\.ts)?$/.test(new URL(name, context.parentURL).href)) return { url: 'mediflow-card-test:runner', shortCircuit: true };
    return next(name, context);
  },
  load(url, context, next) {
    if (url === 'mediflow-card-test:runner') return { format: 'commonjs', shortCircuit: true, source: 'module.exports = globalThis.__cardTestRunner;' };
    return next(url, context);
  },
});
const realFixtures = await import('../../../lib/chat-card/synthetic-fixtures.ts');
if (process.argv.includes('--poison')) {
  globalThis.__cardTestFixtures = { ...realFixtures, projectSyntheticCard(patient, selection, pseudonym, sourceRef) {
    const card = realFixtures.projectSyntheticCard(patient, selection, pseudonym, sourceRef); card.history[0].note += ' ' + SENTINEL; return card;
  } };
  registerHooks({
    resolve(name, context, next) {
      if (context.parentURL?.endsWith('/synthetic-card-broker.ts') && name === './synthetic-fixtures') return { url: 'mediflow-card-test:fixtures', shortCircuit: true };
      return next(name, context);
    },
    load(url, context, next) {
      if (url === 'mediflow-card-test:fixtures') return { format: 'commonjs', shortCircuit: true, source: 'module.exports = globalThis.__cardTestFixtures;' };
      return next(url, context);
    },
  });
}
export function testInstallation() {
  const generatedAt = new Date(Date.now() - 100).toISOString(), recallByType = {};
  for (const entry of corpus) for (const entity of entry.gold.entities) {
    const metric = recallByType[entity.type] ??= { criticalGoldCount: 0, criticalMatchedCount: 0, criticalRecall: 1 };
    metric.criticalGoldCount++; metric.criticalMatchedCount++;
  }
  const benchmark = { schemaVersion: 'mediflow.redaction.v1', adapter: constants.REDACTION_RUNTIME_ADAPTER, corpusSize: corpus.length,
    metrics: { contractValidRate: 1, offsetIntegrityRate: 1, criticalRecall: 1, forbiddenLeakRate: 0, recallByType },
    cases: corpus.map(entry => ({ id: entry.id, contractValid: true, criticalRecall: 1, offsetIntegrityRate: 1,
      forbiddenLeakCount: 0, leakedForbiddenTokens: [], missingEntities: [] })) };
  const validation = { schemaVersion: 'mediflow.redaction-runtime-validation.v1', generatedAt, adapterModule: constants.REDACTION_RUNTIME_ADAPTER,
    shadowReady: true, failures: [], benchmark, runtimeBinding: { identity, corpusSha256: evidenceHash(realFixtures.SYNTHETIC_CARD_CORPUS_JSON), benchmarkSha256: evidenceHash(JSON.stringify(benchmark)) } };
  const validationJson = JSON.stringify(validation);
  const rollout = { generatedAt, lane: 'redaction', status: 'shadow-ready', currentState: 'shadow-ready', selectedModel: constants.REDACTION_RUNTIME_MODEL,
    blockers: [], evidence: { fallbackWritten: true, licenseClear: true, owner: 'synthetic-test-only', maxAgeDays: 30, reportGeneratedAt: generatedAt },
    runtimeBinding: { validationSha256: evidenceHash(validationJson), identityDigest: redactionIdentityDigest(identity) } };
  return { runner: { pythonExecutable: '/synthetic/python', workerPath: '/synthetic/worker', modelDirectory: '/synthetic/model' }, evidence: { validationJson, rolloutJson: JSON.stringify(rollout) } };
}
