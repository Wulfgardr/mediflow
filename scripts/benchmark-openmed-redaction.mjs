#!/usr/bin/env node

/* @Codex */
import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_CORPUS_PATH = path.join(__dirname, 'fixtures', 'openmed-redaction-corpus.json');

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.OPENMED_BASE_URL || 'http://127.0.0.1:18080',
    corpus: DEFAULT_CORPUS_PATH,
    out: null,
    lang: 'it',
    extractThreshold: 0.5,
    tunedThreshold: 0.5,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--base-url' && argv[index + 1]) {
      args.baseUrl = argv[index + 1];
      index += 1;
    } else if (value === '--corpus' && argv[index + 1]) {
      args.corpus = path.resolve(argv[index + 1]);
      index += 1;
    } else if (value === '--out' && argv[index + 1]) {
      args.out = path.resolve(argv[index + 1]);
      index += 1;
    } else if (value === '--lang' && argv[index + 1]) {
      args.lang = argv[index + 1];
      index += 1;
    } else if (value === '--extract-threshold' && argv[index + 1]) {
      args.extractThreshold = Number(argv[index + 1]);
      index += 1;
    } else if (value === '--tuned-threshold' && argv[index + 1]) {
      args.tunedThreshold = Number(argv[index + 1]);
      index += 1;
    }
  }

  return args;
}

function readCorpus(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function percentile(values, ratio) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * ratio) - 1);
  return Number(sorted[index].toFixed(1));
}

function toRate(numerator, denominator) {
  if (denominator === 0) return 1;
  return Number((numerator / denominator).toFixed(3));
}

function normalizeText(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function findMentionSpan(text, mention) {
  const start = text.indexOf(mention);
  if (start === -1) {
    throw new Error(`Mention "${mention}" not found in benchmark text.`);
  }
  return { start, end: start + mention.length };
}

function overlaps(leftStart, leftEnd, rightStart, rightEnd) {
  return Math.max(leftStart, rightStart) < Math.min(leftEnd, rightEnd);
}

async function fetchJson(url, init) {
  const startedAt = performance.now();
  const response = await fetch(url, init);
  const latencyMs = Number((performance.now() - startedAt).toFixed(1));
  const text = await response.text();
  let body = null;

  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { rawText: text };
  }

  return { ok: response.ok, status: response.status, latencyMs, body };
}

function buildHealthLane(result) {
  return {
    lane: 'service-smoke',
    status: result.ok ? 'completed' : 'error',
    metrics: {
      latencyMs: result.latencyMs,
    },
    response: result.body,
  };
}

function scoreExtractCase(entry, body) {
  const entities = Array.isArray(body?.entities) ? body.entities : [];
  const matchedEntityIndexes = new Set();
  const expected = entry.expected.map((item) => {
    const span = findMentionSpan(entry.text, item.text);
    const entityIndex = entities.findIndex((entity) => {
      if (typeof entity?.start === 'number' && typeof entity?.end === 'number') {
        return overlaps(span.start, span.end, entity.start, entity.end);
      }
      return normalizeText(entity?.text || '') === normalizeText(item.text);
    });
    const matched = entityIndex >= 0;
    if (matched) matchedEntityIndexes.add(entityIndex);

    return {
      ...item,
      matched,
    };
  });

  const falsePositives = entities
    .map((entity, index) => ({ index, entity }))
    .filter(({ index }) => !matchedEntityIndexes.has(index))
    .map(({ entity }) => ({
      text: entity.text,
      label: entity.label,
      confidence: entity.confidence,
    }));

  return {
    expected,
    falsePositives,
    missed: expected.filter((item) => !item.matched),
    predictedCount: entities.length,
    labels: entities.map((entity) => entity.label).filter(Boolean),
  };
}

function scoreDeidentifyCase(entry, body) {
  const deidentifiedText = typeof body?.deidentified_text === 'string' ? body.deidentified_text : '';
  const expected = entry.expected.map((item) => ({
    ...item,
    matched: !normalizeText(deidentifiedText).includes(normalizeText(item.text)),
  }));

  return {
    expected,
    leaked: expected.filter((item) => !item.matched),
    deidentifiedText,
    predictedCount: Array.isArray(body?.pii_entities) ? body.pii_entities.length : 0,
  };
}

function summarizeLaneCases(cases, includePrecision = false) {
  const latencies = cases.map((entry) => entry.latencyMs);
  const totals = cases.reduce((accumulator, entry) => {
    for (const item of entry.expected) {
      accumulator.total += 1;
      if (item.critical) accumulator.critical += 1;
      if (item.matched) accumulator.hits += 1;
      if (item.critical && item.matched) accumulator.criticalHits += 1;
    }

    accumulator.falsePositives += entry.falsePositives?.length || 0;
    accumulator.predicted += entry.predictedCount || 0;
    return accumulator;
  }, {
    total: 0,
    critical: 0,
    hits: 0,
    criticalHits: 0,
    falsePositives: 0,
    predicted: 0,
  });

  const metrics = {
    recall: toRate(totals.hits, totals.total),
    criticalRecall: toRate(totals.criticalHits, totals.critical),
    avgLatencyMs: Number((latencies.reduce((sum, value) => sum + value, 0) / Math.max(1, latencies.length)).toFixed(1)),
    p95LatencyMs: percentile(latencies, 0.95),
  };

  if (includePrecision) {
    metrics.precision = toRate(totals.hits, totals.predicted);
    metrics.falsePositiveCount = totals.falsePositives;
  }

  return metrics;
}

async function runExtractLane(baseUrl, corpus, args) {
  const cases = [];

  for (const entry of corpus) {
    const result = await fetchJson(`${baseUrl}/pii/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: entry.text,
        lang: args.lang,
        confidence_threshold: args.extractThreshold,
      }),
    });

    if (!result.ok) {
      return {
        lane: 'extract',
        status: 'error',
        metrics: { latencyMs: result.latencyMs },
        error: result.body,
      };
    }

    const scored = scoreExtractCase(entry, result.body);
    cases.push({
      id: entry.id,
      latencyMs: result.latencyMs,
      modelName: result.body?.model_name || null,
      expected: scored.expected,
      missed: scored.missed,
      falsePositives: scored.falsePositives,
      predictedCount: scored.predictedCount,
      labels: scored.labels,
    });
  }

  return {
    lane: 'extract',
    status: 'completed',
    metrics: summarizeLaneCases(cases, true),
    cases,
  };
}

async function runDeidentifyLane(baseUrl, corpus, args, laneName, confidenceThreshold) {
  const cases = [];

  for (const entry of corpus) {
    const payload = {
      text: entry.text,
      lang: args.lang,
      method: 'mask',
    };

    if (typeof confidenceThreshold === 'number') {
      payload.confidence_threshold = confidenceThreshold;
    }

    const result = await fetchJson(`${baseUrl}/pii/deidentify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!result.ok) {
      return {
        lane: laneName,
        status: 'error',
        metrics: { latencyMs: result.latencyMs },
        error: result.body,
      };
    }

    const scored = scoreDeidentifyCase(entry, result.body);
    cases.push({
      id: entry.id,
      latencyMs: result.latencyMs,
      modelName: result.body?.model_name || null,
      expected: scored.expected,
      leaked: scored.leaked,
      falsePositives: [],
      predictedCount: scored.predictedCount,
      deidentifiedText: scored.deidentifiedText,
    });
  }

  return {
    lane: laneName,
    status: 'completed',
    metrics: summarizeLaneCases(cases, false),
    cases,
  };
}

async function warmService(baseUrl, corpus, args) {
  const firstEntry = corpus[0];
  if (!firstEntry) return null;

  const result = await fetchJson(`${baseUrl}/pii/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: firstEntry.text,
      lang: args.lang,
      confidence_threshold: args.extractThreshold,
    }),
  });

  return {
    lane: 'warmup',
    status: result.ok ? 'completed' : 'error',
    metrics: {
      latencyMs: result.latencyMs,
    },
    modelName: result.body?.model_name || null,
    error: result.ok ? null : result.body,
  };
}

function buildDecision(extractLane, deidentifyDefaultLane, deidentifyTunedLane, tunedThreshold) {
  const extractRecall = extractLane?.metrics?.criticalRecall ?? 0;
  const defaultRecall = deidentifyDefaultLane?.metrics?.criticalRecall ?? 0;
  const tunedRecall = deidentifyTunedLane?.metrics?.criticalRecall ?? 0;
  const tunedBetter = tunedRecall > defaultRecall;

  return {
    recommendedPath: 'benchmark_only_then_shadow_adapter',
    recommendedDeidentifyConfig: tunedBetter
      ? { method: 'mask', confidenceThreshold: tunedThreshold }
      : { method: 'mask', confidenceThreshold: 'default' },
    rationale: tunedBetter
      ? `OpenMed deidentify defaults under-mask critical Italian PII on this corpus (${defaultRecall}); lowering the threshold to ${tunedThreshold} restores the lane to ${tunedRecall} critical recall while extract stays at ${extractRecall}.`
      : `OpenMed defaults are already sufficient on this corpus (${defaultRecall} critical recall); keep the benchmark-only lane and defer runtime integration.`,
    futureHooks: [
      'lib/ai-context.ts',
      'lib/domain/documents/patient-smart-import-service.ts',
      'lib/domain/documents/document-synthesis-service.ts',
    ],
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const corpus = readCorpus(args.corpus);
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: args.baseUrl,
    corpusPath: args.corpus,
    corpusSize: corpus.length,
    language: args.lang,
    warmup: null,
    lanes: [],
    decision: null,
  };

  const health = await fetchJson(`${args.baseUrl}/health`, { method: 'GET' });
  report.lanes.push(buildHealthLane(health));

  if (!health.ok) {
    const serialized = JSON.stringify(report, null, 2);
    if (args.out) fs.writeFileSync(args.out, serialized);
    console.error(serialized);
    process.exit(1);
  }

  report.warmup = await warmService(args.baseUrl, corpus, args);
  if (report.warmup?.status !== 'completed') {
    const serialized = JSON.stringify(report, null, 2);
    if (args.out) fs.writeFileSync(args.out, serialized);
    console.error(serialized);
    process.exit(1);
  }

  const extractLane = await runExtractLane(args.baseUrl, corpus, args);
  const deidentifyDefaultLane = await runDeidentifyLane(args.baseUrl, corpus, args, 'deidentify-default', null);
  const deidentifyTunedLane = await runDeidentifyLane(args.baseUrl, corpus, args, 'deidentify-tuned', args.tunedThreshold);

  report.lanes.push(extractLane, deidentifyDefaultLane, deidentifyTunedLane);
  report.decision = buildDecision(extractLane, deidentifyDefaultLane, deidentifyTunedLane, args.tunedThreshold);

  const serialized = JSON.stringify(report, null, 2);
  if (args.out) fs.writeFileSync(args.out, serialized);
  console.log(serialized);

  if (report.lanes.some((lane) => lane.status !== 'completed')) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
