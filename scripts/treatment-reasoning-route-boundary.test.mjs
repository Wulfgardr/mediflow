#!/usr/bin/env node
/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const routeSource = fs.readFileSync(
    path.join(repoRoot, 'app/api/system/treatment-reasoning/athena-mlx/route.ts'),
    'utf8',
);
const runtimeSource = fs.readFileSync(
    path.join(repoRoot, 'lib/athena-mlx-runtime.ts'),
    'utf8',
);

test('ATHENA treatment route keeps session-only and server-side kill switch boundary', () => {
    assert.match(routeSource, /requireSession\(\)/);
    assert.doesNotMatch(routeSource, /requireSessionOrLocalToken/);
    assert.match(routeSource, /AI_TREATMENT_REASONING_KILL_SWITCH_KEY/);
    assert.match(routeSource, /isAiTreatmentReasoningEnabledValue/);
    assert.match(routeSource, /status:\s*403/);
});

test('ATHENA treatment route stays schema-scoped instead of becoming a generic local oracle', () => {
    assert.match(routeSource, /TREATMENT_REASONING_SCHEMA_VERSION/);
    assert.match(routeSource, /prompt\.includes\(TREATMENT_REASONING_SCHEMA_VERSION\)/);
});

test('ATHENA MLX runtime keeps dependency and stderr handling clinical-safe', () => {
    assert.match(runtimeSource, /mlx-lm==0\.29\.1/);
    assert.match(runtimeSource, /HF_HUB_OFFLINE/);
    assert.match(runtimeSource, /TRANSFORMERS_OFFLINE/);
    assert.match(runtimeSource, /UV_OFFLINE/);
    assert.doesNotMatch(runtimeSource, /stderr\.slice/);
});
