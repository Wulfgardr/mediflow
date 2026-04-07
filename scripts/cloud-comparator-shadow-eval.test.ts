/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    emitDocumentIntelligenceReview,
    emitLocalEvolutionBriefs,
    emitLocalEvolutionBriefIndex,
    emitRecommendedNextSliceBrief,
    executeCloudComparator,
} from './cloud-comparator-shadow-eval.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXAMPLE_CASE_PACK = path.join(__dirname, 'fixtures', 'cloud-comparator-case-pack.example.json');

function writeFile(filePath: string, content: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
}

test('executeCloudComparator scores local vs cloud raw outputs and surfaces deltas', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-cloud-comparator-'));
    const localPatientInsightPath = path.join(tempDir, 'patient-insight.local.txt');
    const cloudPatientInsightPath = path.join(tempDir, 'patient-insight.cloud.txt');
    const localSmartImportPath = path.join(tempDir, 'smart-import.local.txt');
    const cloudSmartImportPath = path.join(tempDir, 'smart-import.cloud.txt');

    writeFile(localPatientInsightPath, JSON.stringify({
        schemaVersion: 'mediflow.ai.extract.v1',
        task: 'patient_insight',
        summary: 'baseline locale',
        data: {
            currentState: ['BPCO con dispnea recente [S3][S2]'],
            alerts: ['SpO2 91% [S5]'],
            nextSteps: ['Controllo MMG [S7]'],
            gaps: [],
        },
    }));
    writeFile(cloudPatientInsightPath, JSON.stringify({
        schemaVersion: 'mediflow.ai.extract.v1',
        task: 'patient_insight',
        summary: 'comparatore cloud',
        data: {
            currentState: ['BPCO con dispnea recente [S3][S2]'],
            alerts: ['SpO2 91% [S5]'],
            nextSteps: [
                'Controllo MMG per rivalutazione dispnea [S7]',
                'Follow-up pneumologico precoce [S8]',
            ],
            gaps: [],
        },
    }));
    writeFile(localSmartImportPath, JSON.stringify({
        schemaVersion: 'mediflow.ai.extract.v1',
        task: 'smart_import',
        summary: 'baseline locale',
        data: {
            diagnoses: [
                {
                    label: 'Diabete mellito tipo 2',
                    icdQuery: 'type 2 diabetes',
                    confidence: 'high',
                    evidence: 'documento recente',
                    sourceId: 'insight:diab-1',
                },
            ],
            therapies: [
                {
                    drugMention: 'Metformina 850 mg',
                    drugQuery: 'metformina',
                    dosage: '850 mg 1 cp x 2/die',
                    confidence: 'high',
                    evidence: 'visita',
                    therapyState: 'active',
                    sourceId: 'entry:visit-1',
                },
            ],
        },
    }));
    writeFile(cloudSmartImportPath, JSON.stringify({
        schemaVersion: 'mediflow.ai.extract.v1',
        task: 'smart_import',
        summary: 'comparatore cloud',
        data: {
            diagnoses: [
                {
                    label: 'Diabete mellito tipo 2',
                    icdQuery: 'type 2 diabetes',
                    confidence: 'high',
                    evidence: 'documento recente',
                    sourceId: 'insight:diab-1',
                },
                {
                    label: 'Ipertensione arteriosa essenziale',
                    icdQuery: 'essential hypertension',
                    confidence: 'high',
                    evidence: 'note paziente',
                    sourceId: 'patient-notes:1',
                },
            ],
            therapies: [
                {
                    drugMention: 'Metformina 850 mg',
                    drugQuery: 'metformina',
                    dosage: '850 mg 1 cp x 2/die',
                    confidence: 'high',
                    evidence: 'visita',
                    therapyState: 'active',
                    sourceId: 'entry:visit-1',
                },
                {
                    drugMention: 'Ramipril 5 mg',
                    drugQuery: 'ramipril',
                    dosage: '5 mg 1 cp/die',
                    confidence: 'high',
                    evidence: 'visita',
                    therapyState: 'active',
                    sourceId: 'entry:visit-1',
                },
            ],
        },
    }));

    const report = await executeCloudComparator({
        casePackPath: EXAMPLE_CASE_PACK,
        localPatientInsightPath,
        cloudPatientInsightPath,
        localSmartImportPath,
        cloudSmartImportPath,
        runLocal: false,
        runCloud: false,
        localModel: 'qwen3.5:35b-a3b',
        cloudModel: 'gpt-5.4',
        ollamaBaseUrl: 'http://127.0.0.1:11434',
        cloudReasoningEffort: 'high',
        cloudVerbosity: 'low',
    });

    assert.ok(report.patientInsight?.delta);
    assert.ok((report.patientInsight?.delta?.focusRecallDelta || 0) > 0);
    assert.ok(report.smartImport?.delta);
    assert.ok((report.smartImport?.delta?.diagnosisRecallDelta || 0) > 0);
    assert.deepEqual(report.distillation.learningObjectives, [
        'Capire se il comparatore cloud preserva meglio focus, recency e hierarchy rispetto alla baseline locale.',
        'Isolare quali gap del locale dipendono da euristiche, source hierarchy o render reviewable.',
    ]);
    assert.ok(report.distillation.failurePatterns.some((pattern) => pattern.includes('Patient Insight')));
    assert.ok(report.distillation.failurePatterns.some((pattern) => pattern.includes('Smart Import')));
    assert.ok(report.distillation.insights.some((insight) => (
        insight.lane === 'patient_insight' && insight.category === 'missing-local-heuristic'
    )));
    assert.ok(report.distillation.insights.some((insight) => (
        insight.lane === 'smart_import' && insight.category === 'missing-local-heuristic'
    )));
    assert.ok(report.distillation.insights.some((insight) => (
        insight.lane === 'cross-lane' && insight.category === 'reasoning-pattern'
    )));
    assert.ok(report.distillation.insights.some((insight) => (
        insight.category === 'synthetic-benchmark-gap'
    )));
    assert.ok(report.distillation.categoryCounts['missing-local-heuristic'] >= 2);
    assert.ok(report.distillation.layerCounts['post-processing'] >= 2);
    assert.ok(report.distillation.nextSyntheticTargets.includes('smart-import-diagnosis-recall'));
    assert.ok(report.distillation.recommendedWorkstreams.some((item) => item.includes('euristiche locali')));
    assert.ok(report.distillation.followupQuestions.some((question) => question.includes('policy condivisa')));
    assert.equal(report.distillation.recommendedNextSlice?.taskId, 'wul-151-distill-01');
    assert.equal(report.distillation.recommendedNextSlice?.suggestedBranch, 'codex/wul-151-patient-insight-focus-recency');
    assert.ok(report.distillation.documentIntelligenceReview.currentState.some((item) => item.includes('document_evidence_pack.v2')));
    assert.ok(report.distillation.documentIntelligenceReview.architectureGaps.some((item) => item.includes('evidence ledger')));
    assert.ok(report.distillation.documentIntelligenceReview.proposedPrinciples.some((item) => item.includes('recognition, source governance, decision layer e render/projection')));
    assert.ok(report.distillation.documentIntelligenceReview.recommendedThinSlices.some((slice) => (
        slice.slug === 'patient-insight-focus-recency'
    )));
    assert.ok(report.distillation.localEvolutionAgenda.length > 0);
    assert.ok(report.distillation.localEvolutionAgenda.some((task) => (
        task.primaryLayer === 'post-processing' && task.lane === 'patient_insight'
    )));
    assert.ok(report.distillation.localEvolutionAgenda.some((task) => (
        task.primaryLayer === 'benchmark-corpus' && task.category === 'synthetic-benchmark-gap'
    )));
    assert.ok(report.distillation.localEvolutionAgenda.some((task) => (
        task.workstreamSlug === 'patient-insight-focus-recency'
    )));
    assert.ok(report.distillation.localEvolutionAgenda.some((task) => (
        task.suggestedBranch === 'codex/wul-151-patient-insight-focus-recency'
    )));
    assert.ok(report.distillation.localEvolutionAgenda.some((task) => (
        task.coordination.branchTemplate === 'codex/<linear-issue-id>-patient-insight-focus-recency'
    )));
    assert.ok(report.distillation.localEvolutionAgenda.every((task) => (
        task.coordination.anchorIssueId === 'WUL-151'
    )));
    assert.ok(report.distillation.localEvolutionAgenda.every((task) => (
        task.coordination.executionMode === 'parallel-safe' || task.coordination.executionMode === 'serialized'
    )));
    assert.ok(report.distillation.localEvolutionAgenda.every((task) => (
        task.estimatedDiffSize === 'small' || task.estimatedDiffSize === 'medium'
    )));
    assert.ok(report.distillation.localEvolutionAgenda.every((task) => (
        task.riskLevel === 'low' || task.riskLevel === 'medium' || task.riskLevel === 'high'
    )));
    assert.ok(report.distillation.localEvolutionAgenda.every((task) => (
        task.suggestedCommands.some((command) => command.startsWith('git switch -c codex/wul-151-'))
    )));
    assert.ok(report.distillation.localEvolutionAgenda.every((task) => task.scopeSummary.length > 0));
    assert.ok(report.distillation.localEvolutionAgenda.every((task) => task.definitionOfDone.length > 0));
    assert.ok(report.distillation.localEvolutionAgenda.every((task) => task.nonGoals.some((goal) => goal.includes('runtime MediFlow'))));
    assert.ok(report.distillation.localEvolutionAgenda.some((task) => (
        task.repoTouchpoints.includes('scripts/cloud-comparator-shadow-eval.ts')
    )));
    assert.ok(report.distillation.localEvolutionAgenda.some((task) => (
        task.repoTouchpoints.includes('lib/ai-summary-service.ts')
    )));
    assert.ok(report.distillation.localEvolutionAgenda.every((task) => (
        task.validation.includes('npm run test:cloud-comparator')
    )));

    const briefsDir = path.join(tempDir, 'briefs');
    const briefPaths = emitLocalEvolutionBriefs(report, briefsDir);
    assert.equal(briefPaths.length, report.distillation.localEvolutionAgenda.length);
    assert.ok(briefPaths.every((briefPath) => fs.existsSync(briefPath)));
    assert.ok(report.distillation.briefArtifactPaths?.length);
    const firstBrief = fs.readFileSync(briefPaths[0], 'utf8');
    assert.ok(firstBrief.includes('Suggested branch: codex/wul-151-'));
    assert.ok(firstBrief.includes('Dedicated issue branch template: codex/<linear-issue-id>-'));
    assert.ok(firstBrief.includes('## Coordination'));
    assert.ok(firstBrief.includes('## Definition Of Done'));
    assert.ok(firstBrief.includes('## Non Goals'));

    const briefIndexPath = emitLocalEvolutionBriefIndex(report, briefsDir);
    assert.equal(report.distillation.briefIndexPath, briefIndexPath);
    assert.ok(fs.existsSync(briefIndexPath));
    const briefIndex = fs.readFileSync(briefIndexPath, 'utf8');
    assert.ok(briefIndex.includes('## Recommended Next Slice'));
    assert.ok(briefIndex.includes('codex/wul-151-patient-insight-focus-recency'));
    assert.ok(briefIndex.includes('codex/<linear-issue-id>-patient-insight-focus-recency'));

    const nextSlicePath = emitRecommendedNextSliceBrief(report, briefsDir);
    assert.equal(report.distillation.nextSliceBriefPath, nextSlicePath);
    assert.ok(nextSlicePath);
    const nextSlice = fs.readFileSync(nextSlicePath, 'utf8');
    assert.ok(nextSlice.includes('# Recommended Next Slice'));
    assert.ok(nextSlice.includes('`git switch -c codex/wul-151-patient-insight-focus-recency`'));
    assert.ok(nextSlice.includes('Dedicated issue branch template: codex/<linear-issue-id>-patient-insight-focus-recency'));

    const documentReviewPath = emitDocumentIntelligenceReview(report, briefsDir);
    assert.equal(report.distillation.documentIntelligenceReview.artifactPath, documentReviewPath);
    assert.ok(fs.existsSync(documentReviewPath));
    const documentReview = fs.readFileSync(documentReviewPath, 'utf8');
    assert.ok(documentReview.includes('# Document Intelligence Review'));
    assert.ok(documentReview.includes('## Architecture Gaps'));
});
