import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { CL_SCENARIOS, deriveCellQualification, HISTORICAL_2026_11_14_CONTRACT_SHA256, I4_RECEIPT_SCHEMA, LOCAL_RUN_RECEIPT_SCHEMA, ReceiptRejectedError, SURFACE_RECEIPT_SCHEMA } from './release-register-qualification';

const SHA = 'a'.repeat(40);
const DIGEST = 'b'.repeat(64);
const register = { sourceRevision: SHA, localProfile: { modelIdentifier: 'Mac17,10', osBuild: '26C5047e' } };
const historicalRegister = { ...register, contractSha256: HISTORICAL_2026_11_14_CONTRACT_SHA256 };
const common = { method: 'real', plan: 'contract', sourceRevision: SHA, buildId: 'build', profile: { model: 'Mac17,10', osBuild: '26C5047e' } };
const fids = Object.keys(CL_SCENARIOS);

function localReceipt() {
    const functions = Object.fromEntries(Object.entries(CL_SCENARIOS).map(([fid, scenarios]) => [fid, {
        i2: { complete: 'available', error: 'rejected', cancel: { publication: 'denied', physical: 'proved' }, revoke: { publication: 'denied', physical: 'proved' } },
        cl: {
            groups: scenarios.flatMap(scenario => ['cold', 'warm'].map(mode => ({ scenario, mode, n: 30, errors: 0, timeouts: 0, p95Ms: 1000 }))),
            functionBudget: { latencyMs: 1200, rssBytes: 1000 },
            verification: [{ kind: 'cl-verify', available: true, withinLatencyBudget: true, withinRssBudget: true }],
        },
        memory: {
            rss: { source: 'process_tree_rss', budgetBytes: 1000 },
            modelAllocation: { source: 'ollama_api_ps_size_vram', peakBytes: 900 } as { source: string; peakBytes: number | null },
            systemGpu: { source: 'ioreg_AGXAccelerator_PerformanceStatistics', attribution: 'system_wide', inUsePeakBytes: 700 } as Record<string, unknown> | null,
            summed: false,
        },
    }]));
    return { schema: LOCAL_RUN_RECEIPT_SCHEMA, ...common, path: 'web_production_host_api', surface: 'bench_cli', host: { ollamaVersion: '0.40.16' }, modelIdentity: { name: 'qwen', digest: DIGEST }, admission: { status: 'passed' }, functions };
}
function i4Receipt() {
    const f = { model: 'gpt', catalogSha256: 'c'.repeat(64), consent: true, sourcesShown: true, generation: 'reviewed', applied: false, cancelObserved: true, revokeObserved: true, productReceiptSha256: 'd'.repeat(64), at: '2026-11-21T10:00:00Z' };
    return { schema: I4_RECEIPT_SCHEMA, venue: 'host_subscription', ...common, path: 'web_ui_chatgpt_subscription', surface: 'web', host: { app: 'MediFlow Web' }, attestedBy: 'leonardo', functions: Object.fromEntries(fids.map(fid => [fid, { ...f }])) };
}
function surfaceReceipt(criterion: 'G-5' | 'C-7', client = criterion === 'G-5' ? 'gpui' : 'claude_desktop') {
    const f = { proposalShown: true, sourcesShown: true, consent: true, revokeObserved: true, outputChecked: true, unavailabilityShown: true, malformedRejected: true, staleContextRejected: true, applied: false, productReceiptSha256: 'e'.repeat(64), at: '2026-11-21T11:00:00Z' };
    return { schema: SURFACE_RECEIPT_SCHEMA, criterion, ...common, path: criterion === 'G-5' ? 'gpui_installed_client' : 'chat_host_channel', surface: criterion === 'G-5' ? 'gpui' : 'chat',
        host: { client }, attestedBy: 'leonardo', functions: Object.fromEntries(fids.map(fid => [fid, { ollama: { ...f }, chatgpt: { ...f } }])) };
}
function derive(receipts: readonly object[], cell: Record<string, unknown>, reg: Record<string, unknown> = register) {
    const files = new Map(receipts.map((r, i) => [`r${i}.json`, Buffer.from(JSON.stringify(r))]));
    const refs = [...files].map(([path, bytes]) => ({ path, sha256: createHash('sha256').update(bytes).digest('hex') }));
    const provider = cell.provider as string;
    const full = { functionId: 'smart_import', venue: provider === 'ollama' ? 'local_process' : 'host_subscription', modelIdentity: provider === 'ollama' ? { digest: DIGEST } : null, blockedBy: [], ...cell, receipts: refs };
    return deriveCellQualification(reg, full, path => files.get(path)!);
}
const ollama = { provider: 'ollama' };
const chatgpt = { provider: 'chatgpt' };
const chat = () => [surfaceReceipt('C-7'), surfaceReceipt('C-7', 'codex_desktop')] as const;
const local = () => [localReceipt(), ...chat()] as const;

test('sul contratto corrente qualifica senza ricevuta GPUI G-5, tenendo distinte Web, chat e headless', () => {
    const d = derive(local(), { ...ollama, blockedBy: ['gpu_memory_not_measured', 'surfaces_not_verified'] });
    assert.equal(d.qualification, 'qualified');
    assert.deepEqual(d.blockedBy, []);
    assert.ok(!('G-5' in d.criteria));
    assert.deepEqual(d.surfaces, { web: 'not_verified', gpui: 'not_verified', chat: 'verified', headless: 'not_verified' });
    const remote = derive([i4Receipt(), ...chat()], { ...chatgpt, blockedBy: ['local_only_task', 'surfaces_not_verified'] });
    assert.equal(remote.qualification, 'qualified');
    assert.deepEqual(remote.blockedBy, []);
    assert.ok(!('G-5' in remote.criteria));
    assert.deepEqual(remote.surfaces, { web: 'verified', gpui: 'not_verified', chat: 'verified', headless: 'not_verified' });
    const onlyLocal = derive([localReceipt()], ollama);
    assert.equal(onlyLocal.qualification, 'not_qualified');
    assert.deepEqual(onlyLocal.blockedBy, ['C-7_surface_not_proved']);
    assert.deepEqual(onlyLocal.surfaces, { web: 'not_verified', gpui: 'not_verified', chat: 'not_verified', headless: 'not_verified' });
    const withG5InsteadOfC7 = derive([localReceipt(), surfaceReceipt('G-5')], ollama);
    assert.equal(withG5InsteadOfC7.qualification, 'not_qualified');
    assert.deepEqual(withG5InsteadOfC7.blockedBy, ['C-7_surface_not_proved']);
    assert.equal(withG5InsteadOfC7.surfaces.gpui, 'not_verified');
});

test('un caso simulato, tecnico, diagnostico, di altra revisione, profilo o modello non qualifica', () => {
    const cases: Array<[string, (r: ReturnType<typeof localReceipt>) => void]> = [
        ['simulated', r => { r.method = 'simulated'; }],
        ['technical', r => { r.method = 'technical'; }],
        ['plan_not_contract', r => { r.plan = 'diagnostic'; }],
        ['revision_mismatch', r => { r.sourceRevision = 'e'.repeat(40); }],
        ['profile_mismatch', r => { r.profile = { model: 'Mac17,10', osBuild: '26C5035r' }; }],
        ['model_mismatch', r => { r.modelIdentity = { name: 'qwen', digest: 'f'.repeat(64) }; }],
    ];
    for (const [reason, mutate] of cases) {
        const [receipt, ...rest] = local(); mutate(receipt);
        const d = derive([receipt, ...rest], ollama);
        assert.equal(d.qualification, 'not_qualified', reason);
        assert.ok(d.criteria['C-L'].reasons.includes(reason), reason);
    }
});

test('un percorso parziale resta espresso criterio per criterio e non qualifica', () => {
    const cases: Array<[string, string, (r: ReturnType<typeof localReceipt>) => void]> = [
        ['C-L', 'smart-import-load/cold_incomplete', r => { r.functions.smart_import.cl.groups[0].n = 29; }],
        ['C-L', 'smart-import-load/warm_errors', r => { r.functions.smart_import.cl.groups[1].errors = 1; }],
        ['C-L', 'smart-import-load/cold_timeouts', r => { r.functions.smart_import.cl.groups[0].timeouts = 1; }],
        ['C-L', 'function_budget_absent', r => { r.functions.smart_import.cl.functionBudget.latencyMs = null as unknown as number; }],
        ['C-L', 'verification_outside_budget', r => { r.functions.smart_import.cl.verification[0].withinLatencyBudget = false; }],
        ['C-L', 'verification_absent', r => { r.functions.smart_import.cl.verification = []; }],
        ['I-2', 'revoke_publication_not_denied', r => { r.functions.smart_import.i2.revoke.publication = 'published'; }],
        ['I-2-arresto', 'revoke_physical_stop_not_proved', r => { r.functions.smart_import.i2.revoke.physical = 'not_proved'; }],
        ['memoria', 'model_allocation_not_recorded', r => { r.functions.smart_import.memory.modelAllocation.peakBytes = null; }],
        ['memoria', 'memory_sources_summed', r => { (r.functions.smart_import.memory as Record<string, unknown>).summed = true; }],
        ['memoria', 'system_gpu_misattributed', r => { r.functions.smart_import.memory.systemGpu = { source: 'ioreg_AGXAccelerator_PerformanceStatistics', attribution: 'process', inUsePeakBytes: 700 }; }],
        ['C-L', 'smart-import-load/warm_latency_unmeasured', r => { delete (r.functions.smart_import.cl.groups[1] as Record<string, unknown>).p95Ms; }],
        ['C-L', 'function_budget_not_derived_from_measurements', r => { r.functions.smart_import.cl.functionBudget.latencyMs = -1; }],
        ['C-L', 'function_budget_not_derived_from_measurements', r => { r.functions.smart_import.cl.functionBudget.latencyMs = 1199; }],
        ['memoria', 'rss_budget_absent', r => { r.functions.smart_import.cl.functionBudget.rssBytes = null as unknown as number; }],
    ];
    for (const [criterion, reason, mutate] of cases) {
        const [receipt, ...rest] = local(); mutate(receipt);
        const d = derive([receipt, ...rest], ollama);
        assert.equal(d.qualification, 'not_qualified', reason);
        assert.equal(d.criteria[criterion].status, 'not_met', reason);
        assert.ok(d.criteria[criterion].reasons.includes(reason), reason);
    }
    const unobserved = localReceipt(); unobserved.functions.smart_import.memory.systemGpu = null;
    assert.equal(derive([unobserved, ...chat()], ollama).criteria.memoria.status, 'met');
});

test('sul contratto storico del 14/11 G-5 resta obbligatoria e verificabile', () => {
    const withoutG5 = derive(local(), { ...ollama, blockedBy: ['surfaces_not_verified'] }, historicalRegister);
    assert.equal(withoutG5.qualification, 'not_qualified');
    assert.deepEqual(withoutG5.blockedBy, ['surfaces_not_verified', 'G-5_surface_not_proved']);
    assert.equal(withoutG5.surfaces.gpui, 'not_verified');
    const g5 = surfaceReceipt('G-5'); g5.functions.smart_import.ollama.revokeObserved = false;
    const partial = derive([localReceipt(), g5, ...chat()], ollama, historicalRegister);
    assert.deepEqual(partial.blockedBy, ['G-5_surface_not_proved']);
    assert.equal(partial.surfaces.gpui, 'not_verified');
    const swapped = { ...surfaceReceipt('G-5'), surface: 'chat' };
    assert.ok(derive([localReceipt(), swapped, ...chat()], ollama, historicalRegister).criteria['G-5'].reasons.includes('surface_mismatch'));
    const complete = derive([localReceipt(), surfaceReceipt('G-5'), ...chat()], { ...ollama, blockedBy: ['surfaces_not_verified'] }, historicalRegister);
    assert.equal(complete.qualification, 'qualified');
    assert.equal(complete.surfaces.gpui, 'verified');
});

test('C-7 si chiude solo con le prove in Claude Desktop e in Codex desktop', () => {
    const claudeOnly = derive([localReceipt(), surfaceReceipt('C-7')], ollama);
    assert.equal(claudeOnly.qualification, 'not_qualified');
    assert.ok(claudeOnly.criteria['C-7'].reasons.includes('host_missing:codex_desktop'));
    assert.equal(claudeOnly.surfaces.chat, 'not_verified');
    const twiceClaude = derive([localReceipt(), surfaceReceipt('C-7'), surfaceReceipt('C-7')], ollama);
    assert.equal(twiceClaude.criteria['C-7'].status, 'not_met');
    const other = derive([localReceipt(), surfaceReceipt('C-7'), surfaceReceipt('C-7', 'chatgpt_app')], ollama);
    assert.ok(other.criteria['C-7'].reasons.includes('host_not_required'));
    const codexPartial = surfaceReceipt('C-7', 'codex_desktop'); codexPartial.functions.smart_import.ollama.staleContextRejected = false;
    assert.ok(derive([localReceipt(), surfaceReceipt('C-7'), codexPartial], ollama).criteria['C-7'].reasons.includes('host_missing:codex_desktop'));
    assert.equal(derive(local(), ollama).surfaces.chat, 'verified');
});

test('una ricevuta mutata viene respinta e un\'etichetta non sostituisce il calcolo', () => {
    const bytes = Buffer.from(JSON.stringify(localReceipt()));
    const cell = { provider: 'ollama', venue: 'local_process', functionId: 'smart_import', modelIdentity: { digest: DIGEST }, blockedBy: [], receipts: [{ path: 'r.json', sha256: createHash('sha256').update(bytes).digest('hex') }] };
    const mutated = Buffer.from(bytes.toString().replace('"errors":0', '"errors":1'));
    assert.throws(() => deriveCellQualification(register, cell, () => mutated), (e: unknown) => e instanceof ReceiptRejectedError && e.reason === 'sha256_mismatch');
    const [labelled, ...rest] = local();
    labelled.functions.smart_import.cl.groups[0].errors = 3;
    Object.assign(labelled, { qualification: 'qualified', status: 'met' });
    assert.equal(derive([labelled, ...rest], ollama).qualification, 'not_qualified');
    for (const schema of ['mediflow.other.v1', undefined]) assert.throws(() => derive([{ ...localReceipt(), schema }], ollama), ReceiptRejectedError);
    assert.throws(() => derive([{ ...surfaceReceipt('G-5'), criterion: 'W-1' }], ollama), ReceiptRejectedError);
});

test('dopo la seduta una I-4 reale della sede approvata chiude il limite della campagna locale, una parziale no', () => {
    const before = derive([], { ...chatgpt, blockedBy: ['local_only_task', 'I-4'] });
    assert.deepEqual(before.blockedBy, ['local_only_task', 'I-4', 'C-7_surface_not_proved']);
    const onlyI4 = derive([i4Receipt()], { ...chatgpt, blockedBy: ['local_only_task', 'I-4'] });
    assert.deepEqual(onlyI4.blockedBy, ['C-7_surface_not_proved']);
    assert.equal(onlyI4.surfaces.web, 'verified');
    const after = derive([i4Receipt(), ...chat()], { ...chatgpt, blockedBy: ['local_only_task', 'I-4'] });
    assert.equal(after.qualification, 'qualified');
    const partials: Array<[string, (r: ReturnType<typeof i4Receipt>) => void]> = [
        ['product_receipt_missing', r => { r.functions.smart_import.productReceiptSha256 = ''; }],
        ['revokeObserved_false', r => { r.functions.smart_import.revokeObserved = false; }],
        ['applied_or_unknown', r => { (r.functions.smart_import as Record<string, unknown>).applied = null; }],
        ['generation_not_reviewed', r => { r.functions.smart_import.generation = 'failed'; }],
        ['venue_not_approved', r => { r.venue = 'api_key'; }],
        ['operator_not_attested', r => { r.attestedBy = 'operatore-di-prova'; }],
        ['simulated', r => { r.method = 'simulated'; }],
    ];
    for (const [reason, mutate] of partials) {
        const receipt = i4Receipt(); mutate(receipt);
        const d = derive([receipt, ...chat()], { ...chatgpt, blockedBy: ['local_only_task', 'I-4'] });
        assert.equal(d.qualification, 'not_qualified', reason);
        assert.deepEqual(d.blockedBy, ['local_only_task', 'I-4'], reason);
        assert.ok(d.criteria['I-4'].reasons.includes(reason), reason);
    }
    assert.deepEqual(derive([i4Receipt(), ...chat()], { ...chatgpt, blockedBy: ['product_veto'] }).blockedBy, ['product_veto']);
});
