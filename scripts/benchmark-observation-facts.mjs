#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import { fileURLToPath } from 'url';
import { resolveStaticTerminology } from '../lib/terminology.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_CORPUS_PATH = path.join(__dirname, 'fixtures', 'clinical-facts-observation-corpus.json');

const UNIT_ALIASES = new Map([
  ['mmhg', 'mm[Hg]'],
  ['mm[hg]', 'mm[Hg]'],
  ['bpm', '/min'],
  ['/min', '/min'],
  ['%', '%'],
  ['°c', 'Cel'],
  ['c', 'Cel'],
  ['cel', 'Cel'],
  ['kg', 'kg'],
  ['mg/dl', 'mg/dL'],
]);

const OBSERVATION_PATTERNS = [
  {
    label: 'blood-pressure',
    code: '8480-6',
    unitCode: 'mm[Hg]',
    reviewableWhenUnitMissing: true,
    regex: /\b(?:pa|bp|pressione(?: arteriosa)?)\b[^0-9]{0,12}(\d{2,3})\s*\/\s*(\d{2,3})(?:\s*(mmhg|mm\[hg\]))?/i,
    buildMatches: (match) => ([
      { code: '8480-6', value: match[1], rawUnit: match[3] ?? null },
      { code: '8462-4', value: match[2], rawUnit: match[3] ?? null },
    ]),
  },
  {
    label: 'heart-rate',
    code: '8867-4',
    unitCode: '/min',
    reviewableWhenUnitMissing: true,
    regex: /\b(?:fc|frequenza cardiaca|heart rate|hr)\b[^0-9]{0,12}(\d{2,3})(?:\s*(bpm|\/min))?/i,
    buildMatches: (match) => ([{ code: '8867-4', value: match[1], rawUnit: match[2] ?? null }]),
  },
  {
    label: 'spo2',
    code: '59408-5',
    unitCode: '%',
    reviewableWhenUnitMissing: true,
    regex: /\b(?:spo2|sat(?:urazione)?(?:\s*o2)?|saturimetria)\b[^0-9]{0,12}(\d{2,3})(?:\s*(%))?/i,
    buildMatches: (match) => ([{ code: '59408-5', value: match[1], rawUnit: match[2] ?? null }]),
  },
  {
    label: 'temperature',
    code: '8310-5',
    unitCode: 'Cel',
    reviewableWhenUnitMissing: true,
    regex: /\b(?:temperatura(?: corporea)?)\b[^0-9]{0,12}(\d{2}(?:[.,]\d)?)(?:\s*(°c|c|cel))?/i,
    buildMatches: (match) => ([{ code: '8310-5', value: match[1], rawUnit: match[2] ?? null }]),
  },
  {
    label: 'weight',
    code: '29463-7',
    unitCode: 'kg',
    reviewableWhenUnitMissing: true,
    regex: /\b(?:peso)\b[^0-9]{0,12}(\d{2,3}(?:[.,]\d)?)(?:\s*(kg))?/i,
    buildMatches: (match) => ([{ code: '29463-7', value: match[1], rawUnit: match[2] ?? null }]),
  },
  {
    label: 'glucose',
    code: '2339-0',
    unitCode: 'mg/dL',
    reviewableWhenUnitMissing: true,
    regex: /\b(?:glicemia|glucos(?:e|io))\b[^0-9]{0,12}(\d{2,3})(?:\s*(mg\/dl))?/i,
    buildMatches: (match) => ([{ code: '2339-0', value: match[1], rawUnit: match[2] ?? null }]),
  },
];

function normalizeValue(value) {
  return String(value).replace(',', '.').trim();
}

function canonicalUnit(rawUnit) {
  if (!rawUnit) return null;
  return UNIT_ALIASES.get(rawUnit.trim().toLowerCase()) || null;
}

function extractRules(text) {
  return OBSERVATION_PATTERNS.flatMap((pattern) => {
    const match = pattern.regex.exec(text);
    if (!match) return [];

    return pattern.buildMatches(match).map((item) => ({
      codeSystem: 'LOINC',
      code: item.code,
      unitSystem: 'UCUM',
      unitCode: item.rawUnit ? item.rawUnit.trim() : null,
      value: normalizeValue(item.value),
      reviewable: !item.rawUnit && pattern.reviewableWhenUnitMissing,
      source: 'rules',
    }));
  });
}

function extractHybrid(text) {
  return OBSERVATION_PATTERNS.flatMap((pattern) => {
    const match = pattern.regex.exec(text);
    if (!match) return [];

    return pattern.buildMatches(match).map((item) => {
      const normalizedUnit = canonicalUnit(item.rawUnit) || (!item.rawUnit ? pattern.unitCode : null);
      return {
        codeSystem: 'LOINC',
        code: item.code,
        unitSystem: 'UCUM',
        unitCode: normalizedUnit,
        value: normalizeValue(item.value),
        reviewable: !item.rawUnit && pattern.reviewableWhenUnitMissing,
        source: 'hybrid',
      };
    });
  });
}

function validateCoding(observation) {
  if (observation.codeSystem !== 'LOINC' || observation.unitSystem !== 'UCUM') return false;
  if (!resolveStaticTerminology('LOINC', observation.code)) return false;
  if (!observation.unitCode || !resolveStaticTerminology('UCUM', observation.unitCode)) return false;
  return Number.isFinite(Number(observation.value));
}

function observationKey(observation) {
  return [
    observation.code,
    observation.unitCode || 'missing-unit',
    normalizeValue(observation.value),
    observation.reviewable ? 'reviewable' : 'auto',
  ].join('|');
}

function scoreCase(predicted, expected) {
  const predictedKeys = new Set(predicted.map(observationKey));
  const expectedKeys = new Set(expected.map(observationKey));
  const exactMatches = expected.filter((item) => predictedKeys.has(observationKey(item)));
  const falsePositives = predicted.filter((item) => !expectedKeys.has(observationKey(item)));
  const missed = expected.filter((item) => !predictedKeys.has(observationKey(item)));
  const codingValid = predicted.filter(validateCoding);
  const reviewabilityMatches = expected.filter((item) => {
    const candidate = predicted.find((prediction) => prediction.code === item.code && normalizeValue(prediction.value) === normalizeValue(item.value));
    return candidate ? candidate.reviewable === item.reviewable : false;
  });

  return {
    exactMatches: exactMatches.length,
    expectedCount: expected.length,
    predictedCount: predicted.length,
    falsePositives,
    missed,
    codingValidCount: codingValid.length,
    reviewabilityMatches: reviewabilityMatches.length,
  };
}

function toRate(numerator, denominator) {
  if (denominator === 0) return 1;
  return Number((numerator / denominator).toFixed(3));
}

function runLane(name, corpus, extractor) {
  const startedAt = new Date().toISOString();
  let totalExpected = 0;
  let totalPredicted = 0;
  let totalExact = 0;
  let totalCodingValid = 0;
  let totalReviewabilityMatches = 0;
  let totalLatency = 0;

  const cases = corpus.map((entry) => {
    const start = performance.now();
    const predicted = extractor(entry.text);
    const latencyMs = Number((performance.now() - start).toFixed(3));
    const scored = scoreCase(predicted, entry.expected);

    totalExpected += scored.expectedCount;
    totalPredicted += scored.predictedCount;
    totalExact += scored.exactMatches;
    totalCodingValid += scored.codingValidCount;
    totalReviewabilityMatches += scored.reviewabilityMatches;
    totalLatency += latencyMs;

    return {
      id: entry.id,
      latencyMs,
      predicted,
      expected: entry.expected,
      exactMatches: scored.exactMatches,
      falsePositives: scored.falsePositives,
      missed: scored.missed,
    };
  });

  return {
    lane: name,
    status: 'completed',
    startedAt,
    metrics: {
      precision: toRate(totalExact, totalPredicted),
      recall: toRate(totalExact, totalExpected),
      codingAccuracy: toRate(totalCodingValid, totalPredicted),
      reviewabilityAccuracy: toRate(totalReviewabilityMatches, totalExpected),
      avgLatencyMs: Number((totalLatency / corpus.length).toFixed(3)),
    },
    cases,
  };
}

function buildDecision(lanes) {
  const rules = lanes.find((lane) => lane.lane === 'rules');
  const hybrid = lanes.find((lane) => lane.lane === 'hybrid');

  if (hybrid?.status === 'completed' && rules?.status === 'completed') {
    return {
      default: 'hybrid',
      fallback: 'rules',
      rejected: ['ai'],
      rationale: 'Hybrid keeps deterministic extraction while normalizing UCUM aliases and preserving reviewable cases; AI stays explicit but not run in this first headless slice.',
    };
  }

  return {
    default: 'rules',
    fallback: null,
    rejected: ['ai', 'hybrid'],
    rationale: 'Only the deterministic rules lane completed.',
  };
}

function readCorpus(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseArgs(argv) {
  const args = { corpus: DEFAULT_CORPUS_PATH, out: null };

  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--corpus' && argv[index + 1]) {
      args.corpus = path.resolve(argv[index + 1]);
      index += 1;
    } else if (value === '--out' && argv[index + 1]) {
      args.out = path.resolve(argv[index + 1]);
      index += 1;
    }
  }

  return args;
}

function main() {
  const args = parseArgs(process.argv);
  const corpus = readCorpus(args.corpus);
  const lanes = [
    runLane('rules', corpus, extractRules),
    runLane('hybrid', corpus, extractHybrid),
    {
      lane: 'ai',
      status: 'not-run',
      reason: 'Headless local AI benchmark runner is not wired in this repo yet; first slice keeps the lane explicit but skipped.',
    },
  ];

  const report = {
    generatedAt: new Date().toISOString(),
    corpusPath: args.corpus,
    corpusSize: corpus.length,
    lanes,
    decision: buildDecision(lanes),
  };

  const output = JSON.stringify(report, null, 2);
  if (args.out) {
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, output, 'utf8');
  }
  console.log(output);
}

main();
