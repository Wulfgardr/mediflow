import assert from 'node:assert/strict';
import { COMPLIANCE_EVIDENCE_INVENTORY } from '../../../lib/compliance-evidence-inventory.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildFabricStatusSnapshot } from '../../../lib/ai-providers/fabric/status.ts';
import { buildObservabilitySnapshot, observeVenue } from '../../../lib/ai-providers/fabric/routing-observability.ts';
import { ensureAiModelParliamentArtifactDirectory, readAiModelParliamentArtifact } from '../../../lib/ai-model-parliament-storage.ts';
import { ensureAiRolloutReadinessArtifactDirectory, buildAiRolloutReadinessArtifactsPayload } from '../../../lib/ai-rollout-readiness-storage.ts';

const complianceFixture = new URL('./compliance.json', import.meta.url);
if (process.argv.includes('--check')) {
    assert.deepEqual(JSON.parse(fs.readFileSync(complianceFixture, 'utf8')), COMPLIANCE_EVIDENCE_INVENTORY);
} else {
    fs.writeFileSync(complianceFixture, `${JSON.stringify(COMPLIANCE_EVIDENCE_INVENTORY, null, 2)}\n`);
}

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-g2-governance-'));
const previous = process.env.MEDIFLOW_DATA_DIR;
process.env.MEDIFLOW_DATA_DIR = directory;
try {
    const parliamentPaths = ensureAiModelParliamentArtifactDirectory();
    fs.writeFileSync(parliamentPaths.jsonPath, JSON.stringify({ parliament: {
        readiness: 'hold', baselineModel: 'synthetic-model', challengerModels: ['synthetic-alternative'],
        rationale: 'Prove sintetiche da completare.', protectedModels: ['synthetic-model'],
        recommendedPruneModels: [],
    }, scorecard: { lanes: [{ lane: 'patient_insight', capability: 'synthesis', state: 'hold',
        tasks: ['synthetic-task'], totalCandidates: 2, runnableCandidates: 1, benchmarkedCandidates: 1,
        focusCandidateLabel: 'Modello sintetico', focusCandidateModel: 'synthetic-model',
        blockers: ['Accettazione ancora aperta.'], focusNote: 'Nessuna sostituzione automatica.' }] } }));
    const rolloutPaths = ensureAiRolloutReadinessArtifactDirectory('patient_insight');
    fs.writeFileSync(rolloutPaths.jsonPath, JSON.stringify({ status: 'shadow-ready', currentState: 'hold',
        selectedModel: 'synthetic-model', blockers: [], warnings: [{ id: 'synthetic-warning', message: 'Solo osservazione.' }],
        evidence: { benchmarkFresh: true, owner: 'synthetic-owner' } }));
    const artifact = readAiModelParliamentArtifact();
    const rollout = buildAiRolloutReadinessArtifactsPayload();
    for (const lane of rollout.lanes) {
        if (lane.available) lane.updatedAt = '2026-10-31T00:00:00.000Z';
        if (lane.jsonPath) lane.jsonPath = 'synthetic/latest.json';
        if (lane.markdownPath) lane.markdownPath = 'synthetic/latest.md';
    }
    const payload = {
        registry: buildFabricStatusSnapshot(),
        observations: buildObservabilitySnapshot([
            observeVenue('local_process', 'available', null),
            observeVenue('home_base', 'unknown', 'not_probed'),
            observeVenue('on_device', 'unknown', 'not_implemented'),
            observeVenue('cloud', 'offline', 'egress_profile_closed'),
        ]),
        parliament: { updatedAt: '2026-10-31T00:00:00.000Z', jsonPath: 'synthetic/latest.json',
            markdownPath: 'synthetic/latest.md', report: artifact.report },
        rollout,
    };
    const fixture = new URL('./governance.json', import.meta.url);
    const generated = `${JSON.stringify(payload, null, 2)}\n`;
    if (process.argv.includes('--check')) {
        if (fs.readFileSync(fixture, 'utf8') !== generated) throw new Error('Governance fixture differs from the current host builders and report storage.');
        console.log('Governance fixture matches current host builders and synthetic report storage.');
    } else fs.writeFileSync(fixture, generated);
} finally {
    if (previous === undefined) delete process.env.MEDIFLOW_DATA_DIR;
    else process.env.MEDIFLOW_DATA_DIR = previous;
    fs.rmSync(directory, { recursive: true, force: true });
}
