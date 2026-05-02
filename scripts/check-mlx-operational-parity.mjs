#!/usr/bin/env node

/* @Codex */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const checks = [
  {
    id: 'runtime-default-ollama-only',
    file: 'lib/ai-service.ts',
    mustContain: [
      "type AIProvider = 'ollama'",
      'url.includes(":8080")',
      'http://127.0.0.1:11434',
    ],
    parity: 'Ollama remains the operational app runtime; stale MLX URLs must fall back to loopback Ollama.',
  },
  {
    id: 'benchmark-runtime-symmetry',
    file: 'scripts/local-chat-runtime.ts',
    mustContain: [
      "export type LocalChatRuntime = 'ollama_chat' | 'mlx_chat'",
      '/api/chat',
      '/v1/chat/completions',
      '/v1/models',
    ],
    parity: 'Benchmark adapters can inspect and call both Ollama and MLX local chat runtimes.',
  },
  {
    id: 'model-stack-distinguishes-runtime',
    file: 'scripts/benchmark-model-stack.ts',
    mustContain: [
      'benchmarkedTargetKeys',
      'recommendedRuntime',
      'mlxBaseUrl',
    ],
    parity: 'Reports distinguish runtime+model pairs instead of flattening MLX and Ollama model IDs.',
  },
  {
    id: 'native-runtime-fallback-explicit',
    file: 'native/MediFlowMac/Sources/MediFlowMac/Services/AISettingsResolver.swift',
    mustContain: [
      'resolveRuntimeSnapshot',
      'provider == "mlx"',
      'persistOllamaFallback',
      'task == .ocr',
    ],
    parity: 'Native diagnostics expose effective runtime and keep OCR pinned to Ollama when MLX is configured.',
  },
  {
    id: 'homebase-optional-mlx-readonly',
    file: 'native/MediFlowMac/Sources/MediFlowAppleShared/HomeBaseOptionalServicesProbe.swift',
    mustContain: [
      'optional-mlx',
      'MLX (AI benchmark locale)',
      'http://127.0.0.1:8080/v1/models',
    ],
    parity: 'Packaged home-base diagnostics can see MLX when already running without managing it.',
  },
  {
    id: 'docs-benchmark-only-boundary',
    file: 'docs/mlx-operational-parity.md',
    mustContain: [
      'benchmark-visible',
      'non runtime clinico',
      'OCR resta Ollama-only',
      'WUL-165',
    ],
    parity: 'The operational contract is documented as parity of visibility and guardrails, not product promotion.',
  },
];

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const failures = [];
const matrix = checks.map((check) => {
  let text = '';
  try {
    text = readText(check.file);
  } catch (error) {
    failures.push(`${check.id}: missing file ${check.file}`);
    return { id: check.id, file: check.file, status: 'missing', parity: check.parity };
  }

  const missing = check.mustContain.filter((needle) => !text.includes(needle));
  if (missing.length > 0) {
    failures.push(`${check.id}: ${check.file} is missing ${missing.map((item) => JSON.stringify(item)).join(', ')}`);
  }

  return {
    id: check.id,
    file: check.file,
    status: missing.length === 0 ? 'pass' : 'fail',
    parity: check.parity,
    missing,
  };
});

const report = {
  schemaVersion: 'mediflow.mlx-operational-parity.v1',
  generatedAt: new Date().toISOString(),
  scope: {
    issue: 'WUL-165',
    defaultRuntime: 'ollama',
    mlxStatus: 'benchmark-visible',
    ocrRuntime: 'ollama-only',
    promotionPolicy: 'no runtime promotion without separate ADR, benchmark evidence, and rollout governance',
  },
  matrix,
};

console.log(JSON.stringify(report, null, 2));

if (failures.length > 0) {
  console.error('\nMLX operational parity guard failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
}
