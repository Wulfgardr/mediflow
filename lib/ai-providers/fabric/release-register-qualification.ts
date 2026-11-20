import { createHash } from 'node:crypto';

export const LOCAL_RUN_RECEIPT_SCHEMA = 'mediflow.intelligence-local-run-receipt.v1';
export const I4_RECEIPT_SCHEMA = 'mediflow.intelligence-i4-receipt.v1';
export const SURFACE_RECEIPT_SCHEMA = 'mediflow.intelligence-surface-receipt.v1';
const SCHEMAS = [LOCAL_RUN_RECEIPT_SCHEMA, I4_RECEIPT_SCHEMA, SURFACE_RECEIPT_SCHEMA];

/** Criteri per sede dal contratto 0.9.1: I-2 e C-L per la sede locale, I-4 per l'abbonamento ChatGPT, G-5 e C-7 per entrambe. */
export const CELL_CRITERIA = Object.freeze({
    ollama: Object.freeze(['I-2', 'I-2-arresto', 'C-L', 'memoria', 'G-5', 'C-7']),
    chatgpt: Object.freeze(['I-4', 'G-5', 'C-7']),
});

export const VENUES: Readonly<Record<string, string>> = Object.freeze({ ollama: 'local_process', chatgpt: 'host_subscription' });

export const CRITERION_BLOCKERS: Readonly<Record<string, string>> = Object.freeze({
    'I-2': 'I-2_incomplete',
    'I-2-arresto': 'physical_revocation_not_proved',
    'C-L': 'C-L_errors_or_incomplete_distribution',
    memoria: 'memory_not_recorded',
    'G-5': 'G-5_surface_not_proved',
    'C-7': 'C-7_surface_not_proved',
    'I-4': 'I-4',
});

/** Limiti di campagne passate: restano finché i criteri indicati non sono soddisfatti, non vengono mai aggiunti. */
export const CLOSABLE_LIMITS: Readonly<Record<string, readonly string[]>> = Object.freeze({
    local_only_task: Object.freeze(['I-4']),
    gpu_memory_not_measured: Object.freeze(['memoria']),
    surfaces_not_verified: Object.freeze(['G-5', 'C-7']),
});

export const CL_SCENARIOS: Readonly<Record<string, readonly string[]>> = Object.freeze({
    patient_insight: Object.freeze(['load-100-30-10', 'fragile-realistic']),
    smart_import: Object.freeze(['smart-import-load']),
    document_synthesis: Object.freeze(['pdf-text-10p-10MiB', 'pdf-scan-10p-10MiB']),
});

export const CL_MIN_SAMPLES = 30;

const SURFACE_OBLIGATIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
    'G-5': Object.freeze(['proposalShown', 'sourcesShown', 'consent', 'revokeObserved']),
    'C-7': Object.freeze(['sourcesShown', 'outputChecked', 'unavailabilityShown', 'malformedRejected', 'staleContextRejected', 'revokeObserved']),
});
const SURFACE_OF: Readonly<Record<string, string>> = Object.freeze({ 'G-5': 'gpui', 'C-7': 'chat' });

type Json = Record<string, any>;
export type ReceiptRef = { path: string; sha256: string };
export type CriterionResult = { status: 'met' | 'not_met' | 'not_executed'; reasons: string[]; receipt: string | null };
export type Surfaces = { web: string; gpui: string; chat: string; headless: string };
export type CellDerivation = { qualification: 'qualified' | 'not_qualified'; criteria: Record<string, CriterionResult>; blockedBy: string[]; vetoes: string[]; surfaces: Surfaces };

const HEX40 = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;

export class ReceiptRejectedError extends Error {
    constructor(readonly reason: string, readonly path: string) { super(`receipt_rejected:${reason}:${path}`); }
}

export function loadReceipt(ref: ReceiptRef, read: (path: string) => Buffer): Json {
    if (!ref || typeof ref.path !== 'string' || !HEX64.test(ref.sha256 ?? '')) throw new ReceiptRejectedError('reference_invalid', String(ref?.path));
    const bytes = read(ref.path);
    if (createHash('sha256').update(bytes).digest('hex') !== ref.sha256) throw new ReceiptRejectedError('sha256_mismatch', ref.path);
    const receipt = JSON.parse(bytes.toString('utf8'));
    if (!SCHEMAS.includes(receipt.schema)) throw new ReceiptRejectedError('schema_unknown', ref.path);
    if (!HEX40.test(receipt.sourceRevision ?? '')) throw new ReceiptRejectedError('source_revision_invalid', ref.path);
    if (!['real', 'simulated', 'technical'].includes(receipt.method)) throw new ReceiptRejectedError('method_invalid', ref.path);
    for (const key of ['path', 'surface']) if (typeof receipt[key] !== 'string' || !receipt[key]) throw new ReceiptRejectedError(`${key}_missing`, ref.path);
    for (const key of ['profile', 'host', 'functions']) if (!receipt[key] || typeof receipt[key] !== 'object') throw new ReceiptRejectedError(`${key}_missing`, ref.path);
    if (receipt.schema === SURFACE_RECEIPT_SCHEMA && !['G-5', 'C-7'].includes(receipt.criterion)) throw new ReceiptRejectedError('criterion_invalid', ref.path);
    return Object.freeze({ ...receipt, ref: ref.path });
}

function eligibility(register: Json, cell: Json, receipt: Json): string[] {
    const reasons: string[] = [];
    if (receipt.method !== 'real') reasons.push(receipt.method);
    if (receipt.plan !== 'contract') reasons.push('plan_not_contract');
    if (receipt.sourceRevision !== register.sourceRevision) reasons.push('revision_mismatch');
    const profile = register.localProfile ?? {};
    if (receipt.profile.model !== profile.modelIdentifier || receipt.profile.osBuild !== profile.osBuild) reasons.push('profile_mismatch');
    if (receipt.schema === LOCAL_RUN_RECEIPT_SCHEMA && receipt.modelIdentity?.digest !== cell.modelIdentity?.digest) reasons.push('model_mismatch');
    if (receipt.schema !== LOCAL_RUN_RECEIPT_SCHEMA && receipt.attestedBy !== 'leonardo') reasons.push('operator_not_attested');
    if (receipt.schema === I4_RECEIPT_SCHEMA && receipt.venue !== VENUES.chatgpt) reasons.push('venue_not_approved');
    return reasons;
}

function i2Met(f: Json): string[] {
    const i2 = f?.i2 ?? {};
    const reasons: string[] = [];
    if (i2.complete !== 'available') reasons.push('complete_not_available');
    if (i2.error !== 'rejected') reasons.push('invalid_input_not_rejected');
    for (const scenario of ['cancel', 'revoke']) if (i2[scenario]?.publication !== 'denied') reasons.push(`${scenario}_publication_not_denied`);
    return reasons;
}

function stopMet(f: Json): string[] {
    return ['cancel', 'revoke'].filter(scenario => f?.i2?.[scenario]?.physical !== 'proved').map(scenario => `${scenario}_physical_stop_not_proved`);
}

function clMet(functionId: string, f: Json): string[] {
    const reasons: string[] = [];
    const groups: Json[] = Array.isArray(f?.cl?.groups) ? f.cl.groups : [];
    for (const scenario of CL_SCENARIOS[functionId] ?? []) for (const mode of ['cold', 'warm']) {
        const group = groups.find(g => g.scenario === scenario && g.mode === mode);
        if (!group) { reasons.push(`${scenario}/${mode}_missing`); continue; }
        if (!(Number.isInteger(group.n) && group.n >= CL_MIN_SAMPLES)) reasons.push(`${scenario}/${mode}_incomplete`);
        if (group.errors !== 0) reasons.push(`${scenario}/${mode}_errors`);
        if (group.timeouts !== 0) reasons.push(`${scenario}/${mode}_timeouts`);
    }
    if (!Number.isInteger(f?.cl?.functionBudget?.latencyMs)) reasons.push('function_budget_absent');
    const verification: Json[] = Array.isArray(f?.cl?.verification) ? f.cl.verification : [];
    if (!verification.length) reasons.push('verification_absent');
    if (verification.some(v => v.available !== true || v.withinLatencyBudget !== true || v.withinRssBudget !== true)) reasons.push('verification_outside_budget');
    return reasons;
}

function memoryMet(f: Json): string[] {
    const reasons: string[] = [];
    const memory = f?.memory ?? {};
    if (!Number.isInteger(f?.cl?.functionBudget?.rssBytes)) reasons.push('rss_budget_absent');
    if (memory.rss?.source !== 'process_tree_rss') reasons.push('rss_source_unidentified');
    if (!Number.isInteger(memory.modelAllocation?.peakBytes) || memory.modelAllocation?.source !== 'ollama_api_ps_size_vram') reasons.push('model_allocation_not_recorded');
    if (memory.systemGpu !== undefined && memory.systemGpu !== null && memory.systemGpu.attribution !== 'system_wide') reasons.push('system_gpu_misattributed');
    if (memory.summed !== false) reasons.push('memory_sources_summed');
    return reasons;
}

function i4Met(f: Json): string[] {
    const reasons: string[] = [];
    if (typeof f?.model !== 'string' || !f.model) reasons.push('model_missing');
    if (!HEX64.test(f?.catalogSha256 ?? '')) reasons.push('catalog_missing');
    for (const key of ['consent', 'sourcesShown', 'cancelObserved', 'revokeObserved']) if (f?.[key] !== true) reasons.push(`${key}_false`);
    if (f?.generation !== 'reviewed') reasons.push('generation_not_reviewed');
    if (f?.applied !== false) reasons.push('applied_or_unknown');
    if (!HEX64.test(f?.productReceiptSha256 ?? '')) reasons.push('product_receipt_missing');
    return reasons;
}

function surfaceMet(criterion: string, receipt: Json, f: Json): string[] {
    const reasons: string[] = [];
    if (receipt.criterion !== criterion || receipt.surface !== SURFACE_OF[criterion]) reasons.push('surface_mismatch');
    for (const key of SURFACE_OBLIGATIONS[criterion]) if (f?.[key] !== true) reasons.push(`${key}_false`);
    if (f?.applied !== false) reasons.push('applied_or_unknown');
    if (!HEX64.test(f?.productReceiptSha256 ?? '')) reasons.push('product_receipt_missing');
    return reasons;
}

function candidates(criterion: string, cell: Json, receipts: Json[]): Json[] {
    const entry = (r: Json) => r.schema === SURFACE_RECEIPT_SCHEMA ? r.functions?.[cell.functionId]?.[cell.provider] : r.functions?.[cell.functionId];
    const schema = criterion === 'I-4' ? I4_RECEIPT_SCHEMA : ['G-5', 'C-7'].includes(criterion) ? SURFACE_RECEIPT_SCHEMA : LOCAL_RUN_RECEIPT_SCHEMA;
    return receipts.filter(r => r.schema === schema && (schema !== SURFACE_RECEIPT_SCHEMA || r.criterion === criterion) && entry(r)).map(r => ({ receipt: r, f: entry(r) }));
}

function evaluate(criterion: string, register: Json, cell: Json, receipts: Json[]): CriterionResult {
    const found = candidates(criterion, cell, receipts);
    if (!found.length) return { status: 'not_executed', reasons: ['no_receipt'], receipt: null };
    const reasons = new Set<string>();
    for (const { receipt, f } of found) {
        const failures = [
            ...eligibility(register, cell, receipt),
            ...(criterion === 'I-2' ? i2Met(f) : criterion === 'I-2-arresto' ? stopMet(f) : criterion === 'C-L' ? clMet(cell.functionId, f)
                : criterion === 'memoria' ? memoryMet(f) : criterion === 'I-4' ? i4Met(f) : surfaceMet(criterion, receipt, f)),
        ];
        if (!failures.length) return { status: 'met', reasons: [], receipt: receipt.ref };
        for (const reason of failures) reasons.add(reason);
    }
    return { status: 'not_met', reasons: [...reasons].sort(), receipt: null };
}

/** La qualifica si calcola da ricevute legate per hash; una cella non diventa mai qualificata per un'etichetta. */
export function deriveCellQualification(register: Json, cell: Json, read: (path: string) => Buffer): CellDerivation {
    const required = CELL_CRITERIA[cell.provider as keyof typeof CELL_CRITERIA];
    if (!required) throw new Error(`provider_unknown:${cell.provider}`);
    if (cell.venue !== VENUES[cell.provider]) throw new Error(`venue_unknown:${cell.venue}`);
    const receipts = (cell.receipts ?? []).map((ref: ReceiptRef) => loadReceipt(ref, read));
    const criteria: Record<string, CriterionResult> = {};
    for (const criterion of required) criteria[criterion] = evaluate(criterion, register, cell, receipts);
    const met = (c: string) => criteria[c]?.status === 'met';
    const derivable = new Set(Object.values(CRITERION_BLOCKERS));
    const declared: string[] = cell.blockedBy ?? [];
    const vetoes = declared.filter(b => !derivable.has(b) && !CLOSABLE_LIMITS[b]);
    const limits = declared.filter(b => CLOSABLE_LIMITS[b] && !CLOSABLE_LIMITS[b].every(met));
    const derived = required.filter(c => !met(c)).map(c => CRITERION_BLOCKERS[c]);
    const blockedBy = [...vetoes, ...limits, ...derived];
    const surfaces: Surfaces = {
        web: cell.provider === 'chatgpt' && met('I-4') ? 'verified' : 'not_verified',
        gpui: met('G-5') ? 'verified' : 'not_verified',
        chat: met('C-7') ? 'verified' : 'not_verified',
        headless: 'not_verified',
    };
    return { qualification: blockedBy.length ? 'not_qualified' : 'qualified', criteria, blockedBy, vetoes, surfaces };
}
