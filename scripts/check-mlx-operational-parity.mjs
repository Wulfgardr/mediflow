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
    file: 'lib/ai-providers/base-url.ts',
    mustContain: [
      "export const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434'",
      "baseUrl.includes(':8080')",
      'baseUrl = legacyUrl || defaultUrl',
    ],
    parity: 'Ollama remains the operational app runtime; stale MLX URLs must fall back to loopback Ollama.',
  },
  {
    id: 'runtime-provider-surface-ollama-only',
    file: 'lib/ai-providers/provider.ts',
    mustContain: [
      "export type AIProvider = 'ollama'",
    ],
    parity: 'The product provider surface remains fail-closed to the local Ollama adapter.',
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
    id: 'native-runtime-fallback-no-ocr',
    // Fase 0 (76fb55ab6) deleted the dead Swift AISettingsResolver; the native
    // macOS app now ships the bundled WebRuntime, so the explicit fallback and
    // runtime fallback it guarded lives in lib/ai-service.ts.
    //
    // ac0322e43 ("instrada i servizi nel provider registry") then moved the
    // provider pinning itself out of this file: the literal
    // `const provider: AIProvider = 'ollama'` became a registry resolution
    // (`this.provider = resolution.receipt.provider`). What stays here is the
    // loopback fallback for stale MLX URLs; the provider pinning is
    // asserted by registry-provider-binding-fail-closed below, where it now
    // lives. The check was relocated, not relaxed.
    file: 'lib/ai-service.ts',
    mustContain: [
      'resolveOllamaBaseUrl(genericUrl?.value, legacyUrl?.value, DEFAULT_OLLAMA_BASE_URL)',
    ],
    mustNotContain: [
      "task === 'ocr'",
      'DEFAULT_OCR_MODEL',
      "AIService.create('ocr')",
    ],
    parity: 'The bundled runtime keeps the loopback Ollama fallback for general AI roles and exposes no OCR execution task.',
  },
  {
    id: 'registry-provider-binding-fail-closed',
    // Successore di native-runtime-fallback-explicit per la parte di pinning.
    // Asserisce il rifiuto, non solo il default: un default puo' essere
    // scavalcato da un setting, un throw no. Le due bindings per task devono
    // restare esplicite, perche' un task nuovo senza binding cadrebbe altrimenti
    // su undefined invece che su ollama.
    //
    // Non asserisce i valori `execution: 'local'` ed `egress: 'none'`: sono
    // dichiarati come tipi letterali (`readonly egress: 'none'`, righe 14-16 e
    // 31-33), quindi li difende gia' `tsc` — verificato per falsificazione,
    // cambiarli produce TS2322. Cercarli qui come stringhe sarebbe per giunta
    // inefficace, perche' ricorrono quattro volte nel file e una sola modifica
    // lascerebbe il guard verde. Cio' che il tipo NON puo' difendere, e che
    // percio' si asserisce qui, e' che il controllo a runtime esista.
    file: 'lib/ai-providers/registry.ts',
    mustContain: [
      "if (provider !== 'ollama') throw new ProviderRegistryError('provider_not_registered')",
      "export const AI_SERVICE_TASKS = ['clinical', 'reasoning'] as const",
      "clinical: 'ollama'",
      "reasoning: 'ollama'",
      "if (OLLAMA_MANIFEST_BASE.execution !== 'local' || OLLAMA_MANIFEST_BASE.egress !== 'none')",
    ],
    mustNotContain: [
      "ocr: 'ollama'",
      "['clinical', 'reasoning', 'ocr']",
    ],
    parity: 'General AI roles remain fail-closed to Ollama while the retired OCR task cannot re-enter the registry.',
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
      'OCR non disponibile',
      'ATHENA',
      'Treatment Reasoning',
      'WUL-165',
    ],
    mustNotContain: [
      'OCR resta Ollama-only',
      'DeepSeek/Ollama resta primario',
      'fallback Apple Vision',
    ],
    parity: 'The contract separates generic MLX benchmark visibility, governed ATHENA execution, and retired OCR.',
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
  const forbidden = (check.mustNotContain ?? []).filter((needle) => text.includes(needle));
  if (missing.length > 0) {
    failures.push(`${check.id}: ${check.file} is missing ${missing.map((item) => JSON.stringify(item)).join(', ')}`);
  }
  if (forbidden.length > 0) {
    failures.push(`${check.id}: ${check.file} still contains ${forbidden.map((item) => JSON.stringify(item)).join(', ')}`);
  }

  return {
    id: check.id,
    file: check.file,
    status: missing.length === 0 && forbidden.length === 0 ? 'pass' : 'fail',
    parity: check.parity,
    missing,
    forbidden,
  };
});

const report = {
  schemaVersion: 'mediflow.mlx-operational-parity.v1',
  generatedAt: new Date().toISOString(),
  scope: {
    issue: 'WUL-165',
    defaultRuntime: 'ollama',
    mlxStatus: 'benchmark-visible-with-governed-athena-lane',
    ocrRuntime: 'unavailable',
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
