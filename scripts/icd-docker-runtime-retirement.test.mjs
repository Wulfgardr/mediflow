// @Codex
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFileSync(new URL(path, root), 'utf8');
const retiredPattern = /127\.0\.0\.1:8888|optional-docker-icd|Docker\s*\/\s*ICD|docker compose up -d icd-api|mediflow-icd/iu;

test('macOS launcher never starts or manages the retired ICD container', () => {
    const launcher = source('Start_MediFlow.command');
    assert.doesNotMatch(launcher, retiredPattern);
    assert.doesNotMatch(launcher, /command -v docker|docker-compose|ICD-11 API \(Docker\)/iu);
});

test('native optional-service diagnostics no longer probe or render Docker ICD', () => {
    const probe = source('native/MediFlowMac/Sources/MediFlowAppleShared/HomeBaseOptionalServicesProbe.swift');
    const view = source('native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/HomeBaseRuntimeStatusView.swift');
    assert.doesNotMatch(probe, retiredPattern);
    assert.doesNotMatch(view, retiredPattern);
    assert.doesNotMatch(view, /Docker|container/iu);
});
