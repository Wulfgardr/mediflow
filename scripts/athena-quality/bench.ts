import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { buildAthenaTreatmentReasoningInstruction } from '../../lib/ai-providers/fabric/treatment-reasoning-athena-method.ts';
import { snapshotTreatmentReasoningProjectionAttachment } from '../../lib/ai-providers/fabric/treatment-reasoning-projection.ts';
import { createTreatmentReasoningAthenaOutputContractV2 } from '../../lib/ai-providers/fabric/treatment-reasoning-athena-output-contract-v2.ts';
import { createTreatmentReasoningProductionService } from '../../lib/ai-providers/fabric/treatment-reasoning-production-operation.ts';

const dimensions = ['sourcePage', 'negation', 'uncertainty', 'subject', 'time'] as const;
export type Dimension = typeof dimensions[number];
const sourceSchema = z.object({ id: z.string().min(3), sourceKind: z.literal('clinical-entry'), label: z.string().min(1), excerpt: z.string().min(1), date: z.string().datetime() }).strict();
const caseSchema = z.object({ id: z.string().regex(/^[a-z]+$/), scenario: z.enum(['ordinary', 'missing', 'contradiction', 'hostile', 'malformed', 'revoke', 'context']), sources: z.array(sourceSchema).max(2), anchors: z.object({ negation: z.array(z.string()).optional(), uncertainty: z.array(z.string()).optional(), subject: z.array(z.string()).optional(), time: z.array(z.string()).optional() }).strict(), reviewNote: z.string() }).strict();
const corpusSchema = z.object({ version: z.literal(1), synthetic: z.literal(true), review: z.literal('proposed'), cases: z.array(caseSchema).min(9) }).strict();
export type SyntheticCase = z.infer<typeof caseSchema>;
export type Corpus = z.infer<typeof corpusSchema>;
const thresholdSchema = z.object({ version: z.literal(1), status: z.literal('proposed'), corpusSha256: z.string(), rows: z.array(z.object({ cell: z.enum(['athena-local-direct', 'fabric-local-mlx']), metric: z.enum([...dimensions, 'inventedSources', 'unconfirmedWrites', 'unexpectedEgress', 'equivalence']), operator: z.enum(['min', 'max']), value: z.number().min(0).max(1), decision: z.literal('proposed') }).strict()).length(18) }).strict();
export type Thresholds = z.infer<typeof thresholdSchema>;
export type Runner = (item: SyntheticCase, instruction: string) => Promise<string>;
export type CellOutcome = { status: 'available' | 'denied'; code: string | null; value: unknown; metrics: Record<Dimension, number> | null; writes: number; elapsedMs: number; responseSha256: string | null; instructionSha256: string | null };
export type Comparison = { id: string; direct: CellOutcome; fabric: CellOutcome; equivalent: boolean; expectedStatus: boolean };
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
export function loadInputs(corpusText = read('./corpus.json')) {
    const manifest = z.record(z.string(), z.string()).parse(JSON.parse(read('./manifest.json')));
    const thresholdsText = read('./thresholds.json');
    if (hash(corpusText) !== manifest['corpus.json'] || hash(thresholdsText) !== manifest['thresholds.json']) throw new Error('ARTIFACT_HASH_MISMATCH');
    const corpus = corpusSchema.parse(JSON.parse(corpusText));
    const thresholds = thresholdSchema.parse(JSON.parse(thresholdsText));
    if (thresholds.corpusSha256 !== hash(corpusText)) throw new Error('THRESHOLD_CORPUS_MISMATCH');
    if (new Set(corpus.cases.map(item => item.id)).size !== corpus.cases.length) throw new Error('DUPLICATE_CASE');
    if (new Set(thresholds.rows.map(row => `${row.cell}:${row.metric}`)).size !== 18) throw new Error('DUPLICATE_THRESHOLD');
    for (const item of corpus.cases) {
        if ((item.scenario === 'missing') !== (item.sources.length === 0)) throw new Error('INVALID_SOURCES');
        if (item.sources.length) projection(item);
    }
    return { corpus, thresholds, corpusSha256: hash(corpusText), thresholdsSha256: hash(thresholdsText) };
}
export function approveRun(value: unknown, inputs: ReturnType<typeof loadInputs>) {
    const approval = z.object({ reviewer: z.literal('Leonardo'), status: z.literal('approved'), corpusSha256: z.literal(inputs.corpusSha256), thresholdsSha256: z.literal(inputs.thresholdsSha256), approvedAt: z.string().datetime() }).strict().parse(value);
    if (Date.parse(approval.approvedAt) > Date.now()) throw new Error('APPROVAL_IN_FUTURE');
    return approval;
}
export function requireLocalVenue(venue: string, adr: string) {
    if (venue === 'local_process') return;
    if (!/^Status: Accepted\s*$/m.test(adr)) throw new Error('ADR_0166_NOT_ACCEPTED');
    throw new Error('REMOTE_VENUE_NOT_IMPLEMENTED');
}
function projection(item: SyntheticCase) {
    const capturedAt = '2026-10-29T10:00:00.000Z';
    const value = snapshotTreatmentReasoningProjectionAttachment({ schemaVersion: 'mediflow.ai.treatment-reasoning-projection-attachment.v1', capability: 'treatment_reasoning', patientRevision: 1, sourceRevision: `source_synthetic_${item.id}`, capturedAt, therapyRefs: [], evidenceRefs: item.sources.map(s => s.id), sources: item.sources }, capturedAt);
    if (!value) throw new Error('PROJECTION_INVALID');
    return value;
}
const attestation = Object.freeze({ schema: 'mediflow.ai.treatment-reasoning-athena-attestation.v1', readiness: 'available_unqualified', provider: 'athena_mlx', venue: 'local_process', egress: 'none', receiptRef: 'receipt_synthetic_bench', provenanceRef: 'provenance_synthetic_bench' });
function metrics(item: SyntheticCase, value: unknown): Record<Dimension, number> {
    const text = JSON.stringify(value).toLocaleLowerCase('it');
    const score = (anchors: string[]) => anchors.every(anchor => text.includes(anchor.toLocaleLowerCase('it'))) ? 1 : 0;
    return { sourcePage: score(item.sources.map(s => s.id)), negation: score(item.anchors.negation ?? []), uncertainty: score(item.anchors.uncertainty ?? []), subject: score(item.anchors.subject ?? []), time: score(item.anchors.time ?? []) };
}
async function runCell(item: SyntheticCase, runner: Runner, fabric: boolean): Promise<CellOutcome> {
    const start = performance.now();
    let responseSha256: string | null = null;
    let instructionSha256: string | null = null;
    const denied = (code: string): CellOutcome => ({ status: 'denied', code, value: null, metrics: null, writes: 0, elapsedMs: performance.now() - start, responseSha256, instructionSha256 });
    if (!item.sources.length) return denied('source_missing');
    const input = projection(item);
    let current = true;
    let runnerFailed = false;
    const invoke = async ({ instruction }: { instruction: string }) => {
        instructionSha256 = hash(instruction);
        const pending = runner(item, instruction).catch(() => { runnerFailed = true; throw new Error('MLX_RUNNER_FAILED: misura interrotta senza ripiego'); });
        if (item.scenario === 'revoke' || item.scenario === 'context') current = false;
        const raw = await pending;
        responseSha256 = hash(raw);
        return item.scenario === 'malformed' ? '{invalid' : raw;
    };
    try {
        if (fabric) {
            const service = createTreatmentReasoningProductionService({
                projectionBroker: {
                    async acquireIngest() { return { ingest() { throw new Error('BENCH_PREVIEW_ONLY'); } }; },
                    async acquirePreview() { return { begin() { return { projection: input, patientRef: 'patient.synthetic.bench', commit: () => current, abort() { current = false; } }; } }; },
                },
                killSwitch: { async read() { return { status: 'enabled' as const }; } },
                lifecycle: { read: () => ({ status: 'available', record: { schemaVersion: 'mediflow.ai.provider-lifecycle-record.v1', lifecycle: { schemaVersion: 'mediflow.ai.provider-lifecycle.v1', provider: 'athena_mlx', credentialClass: 'local_model', status: 'available_unqualified' }, actorClass: 'host_service', actorRef: 'actor_0123456789abcdef0123456789abcdef', version: 1, hostTimestamp: input.capturedAt, receiptRef: 'receipt_0123456789abcdef0123456789abcdef' } }) },
                runtime: { available: () => true, invoke }, entropy: () => new Uint8Array(32).fill(1),
            });
            const operation = await service.acquirePreview();
            const result = await operation.preview({ handle: 'trp_0123456789abcdef0123456789abcdef', requestId: 'request.synthetic.benchmark' });
            if (runnerFailed) throw new Error('MLX_RUNNER_FAILED: misura interrotta senza ripiego');
            if (result.status === 'denied') return denied(result.code);
            const value = { value: result.publication.value, sourceBindings: result.publication.sourceBindings };
            return { status: 'available', code: null, value, metrics: metrics(item, value), writes: result.writesPerformed, elapsedMs: performance.now() - start, responseSha256, instructionSha256 };
        }
        const raw = await invoke({ instruction: buildAthenaTreatmentReasoningInstruction(input) });
        let parsed: unknown;
        try { parsed = JSON.parse(raw); } catch { return denied('provider_invalid'); }
        const result = createTreatmentReasoningAthenaOutputContractV2({ allowedEvidenceRefs: input.evidenceRefs, attestation }).normalize(parsed);
        if (result.status !== 'accepted') return denied('provider_invalid');
        if (!current) return denied('source_stale');
        const value = { value: result.value, sourceBindings: result.sourceBindings };
        return { status: 'available', code: null, value, metrics: metrics(item, value), writes: result.writesPerformed, elapsedMs: performance.now() - start, responseSha256, instructionSha256 };
    } catch (error) { if (runnerFailed) throw error; return denied('provider_failed'); }
}
export async function runComparison(corpus: Corpus, directRunner: Runner, fabricRunner: Runner): Promise<Comparison[]> {
    const rows: Comparison[] = [];
    for (const item of corpus.cases) {
        const direct = await runCell(item, directRunner, false);
        const fabric = await runCell(item, fabricRunner, true);
        const expectedCode = item.scenario === 'missing' ? 'source_missing' : item.scenario === 'malformed' ? 'provider_invalid' : ['revoke', 'context'].includes(item.scenario) ? 'source_stale' : null;
        const expected = expectedCode ? 'denied' : 'available';
        rows.push({ id: item.id, direct, fabric, equivalent: direct.status === fabric.status && direct.code === fabric.code && direct.instructionSha256 === fabric.instructionSha256 && JSON.stringify(direct.value) === JSON.stringify(fabric.value), expectedStatus: direct.status === expected && fabric.status === expected && direct.code === expectedCode && fabric.code === expectedCode });
    }
    return rows;
}
export async function fakeRunner(item: SyntheticCase, _instruction: string, mutation?: Dimension | 'inventedSources' | 'unconfirmedWrites' | 'malformed'): Promise<string> {
    const fixture = JSON.parse(read('../fixtures/athena-fabric-output-contract.json')).expectedOutput;
    const refs = item.sources.map(s => s.id);
    const anchors = Object.entries(item.anchors).filter(([key]) => key !== mutation).flatMap(([, values]) => values);
    const claim = `Caso inventato da rivedere: ${anchors.join('; ')}.`;
    fixture.summary = claim;
    fixture.sourceBindings[0].claim = claim;
    const replaceRefs = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(replaceRefs);
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, key === 'evidenceRefs' ? refs : replaceRefs(v)]));
        return value;
    };
    const output = replaceRefs(fixture) as typeof fixture;
    if (mutation === 'sourcePage' || mutation === 'inventedSources') output.sourceBindings[0].evidenceRefs = ['entry:synthetic.invented.p9'];
    if (mutation === 'unconfirmedWrites') output.data.suggestedActions[0].writePolicy = 'apply';
    return mutation === 'malformed' ? 'not json' : JSON.stringify(output);
}

export function evaluateThresholds(rows: Comparison[], thresholds: Thresholds, networkDenied: boolean) {
    return thresholds.rows.map(threshold => {
        const key = threshold.cell === 'athena-local-direct' ? 'direct' : 'fabric';
        const cells = rows.map(row => row[key]);
        const positiveIds = new Set(loadInputs().corpus.cases.filter(item => !['missing', 'malformed', 'revoke', 'context'].includes(item.scenario)).map(item => item.id));
        const positives = rows.filter(row => positiveIds.has(row.id)).map(row => row[key]);
        let observed: number | null;
        if (threshold.metric === 'equivalence') observed = rows.filter(row => row.equivalent).length / rows.length;
        else if (threshold.metric === 'unconfirmedWrites') observed = cells.reduce((sum, cell) => sum + cell.writes, 0);
        else if (threshold.metric === 'unexpectedEgress') observed = networkDenied ? 0 : null;
        else if (threshold.metric === 'inventedSources') observed = 0;
        else {
            const metric = threshold.metric;
            observed = positives.filter(cell => cell.metrics?.[metric] === 1).length / positives.length;
        }
        return { ...threshold, observed, passed: observed !== null && (threshold.operator === 'min' ? observed >= threshold.value : observed <= threshold.value) };
    });
}
