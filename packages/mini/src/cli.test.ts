/* @Codex */
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createAipOperationRpcChildEnvironmentV1, createAipOperationRpcHostV1 } from '../../aip/src/operation-rpc.ts';

const CLI = fileURLToPath(new URL('./cli.ts', import.meta.url));
const LOADER = process.env.MEDIFLOW_TEST_STRIP_TYPES_LOADER
  ?? fileURLToPath(new URL('../../../scripts/register-strip-types-loader.mjs', import.meta.url));
const TEST_MODULE_ENV = process.env.MEDIFLOW_TEST_NODE_PATH
  ? { NODE_PATH: process.env.MEDIFLOW_TEST_NODE_PATH } : {};
const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SCHEMA = 'mediflow.mini.transport.v1';
const capabilities = [{ operationId: 'mediflow.terminology.search.v1', capabilityId: 'mediflow.terminology.search.v1',
  maximumStage: 'read_only', inputSchema: 'mediflow.terminology.search.input.v1',
  outputSchema: 'mediflow.terminology.search.output.v1' }, {
  operationId: 'mediflow.patient.open_loops.read.v1', capabilityId: 'mediflow.patient.open_loops.read.v1',
  maximumStage: 'read_only', inputSchema: 'mediflow.patient.open_loops.read.input.v1',
  outputSchema: 'mediflow.patient.open_loops.read.result.v1',
}, {
  operationId: 'mediflow.patient.open_loops.follow_up.propose.v1',
  capabilityId: 'mediflow.patient.open_loops.follow_up.propose.v1', maximumStage: 'proposal_only',
  inputSchema: 'mediflow.patient.open_loops.follow_up.propose.input.v1',
  outputSchema: 'mediflow.patient.open_loops.follow_up.proposal.v1',
}];
const capabilityCatalog = { schemaVersion: 'mediflow.system.capabilities.v1', operations: capabilities };
const status = { schemaVersion: 'mediflow.system.headless-status.v1', candidateVersion: '0.8.5',
  protocolVersion: '2026-07-28', dataScope: 'non_phi_system_status', writes: 0, apply: 'none' };
const terminology = { schemaVersion: 'mediflow.terminology.search.output.v1',
  operationId: 'mediflow.terminology.search.v1', capabilityId: 'mediflow.terminology.search.v1',
  applicationServiceRef: 'AipTerminologySearchServiceV1', outcome: 'read',
  items: [{ system: 'LOINC', code: 'synthetic-code', display: 'Synthetic display', version: null }],
  receipt: { schemaVersion: 'mediflow.terminology.search.receipt.v1', receiptRef: 'aiptr_synthetic_0001',
    operationId: 'mediflow.terminology.search.v1', capabilityId: 'mediflow.terminology.search.v1', outcome: 'read',
    system: 'LOINC', resultCount: 1, catalogSource: 'local-pilot-catalog', egress: 'none', writesPerformed: 0,
    fabricDependency: 'none', timestamp: 1_000 } };
const loops = { schemaVersion: 'mediflow.patient.open_loops.read.result.v1',
  operationId: 'mediflow.patient.open_loops.read.v1', capabilityId: 'mediflow.patient.open_loops.read.v1', outcome: 'read',
  items: [{ loopRef: `aipl_${'1'.repeat(64)}`, kind: 'results_pending', temporalState: 'open', openedAt: 900,
    dueAt: 1_100, revision: 1 }], truncated: false, snapshotRevision: 7,
  receipt: { schemaVersion: 'mediflow.patient.open_loops.read.receipt.v1', receiptRef: `aipr_${'2'.repeat(64)}`,
    operationId: 'mediflow.patient.open_loops.read.v1', capabilityId: 'mediflow.patient.open_loops.read.v1', outcome: 'read',
    ownerRefHash: `sha256:${'3'.repeat(64)}`, leaseRefHash: `sha256:${'4'.repeat(64)}`,
    receiptRefHash: `sha256:${'5'.repeat(64)}`, generation: 1, revocationGeneration: 0, selectionEpoch: 2,
    snapshotRevision: 7, itemCount: 1, truncated: false, timestamp: 1_000 } };
const proposal = { schemaVersion: 'mediflow.patient.open_loops.follow_up.proposal.v1',
  operationId: 'mediflow.patient.open_loops.follow_up.propose.v1',
  capabilityId: 'mediflow.patient.open_loops.follow_up.propose.v1',
  applicationServiceRef: 'PatientOpenLoopsFollowUpProposalServiceV1', outcome: 'proposed',
  maximumStage: 'proposal_only', reviewRequired: true, writesPerformed: 0, apply: 'none',
  proposalRef: `aipfp_${'6'.repeat(64)}`, basedOnSnapshotRevision: 7,
  items: [{ loopRef: `aipl_${'1'.repeat(64)}`, action: 'review_result' }],
  receipt: { schemaVersion: 'mediflow.patient.open_loops.follow_up.proposal.receipt.v1',
    receiptRef: `aipfr_${'7'.repeat(64)}`,
    operationId: 'mediflow.patient.open_loops.follow_up.propose.v1',
    capabilityId: 'mediflow.patient.open_loops.follow_up.propose.v1',
    applicationServiceRef: 'PatientOpenLoopsFollowUpProposalServiceV1', outcome: 'proposed',
    proposalRefHash: `sha256:${'8'.repeat(64)}`, receiptRefHash: `sha256:${'9'.repeat(64)}`,
    sourceReceiptRefHash: `sha256:${'a'.repeat(64)}`, basedOnSnapshotRevision: 7,
    itemCount: 1, truncated: false, maximumStage: 'proposal_only', reviewRequired: true,
    writesPerformed: 0, apply: 'none', egress: 'none', timestamp: 1_001 } };
const success = (result: unknown) => `${JSON.stringify({ schemaVersion: SCHEMA, ok: true, result })}\n`;
const failure = (code: string) => `${JSON.stringify({ schemaVersion: SCHEMA, ok: false, error: { code } })}\n`;

function runUnbound(input: string | Buffer, args: string[] = []) {
  return spawnSync(process.execPath, ['--experimental-strip-types', '--import', LOADER, CLI, ...args], {
    input, encoding: 'utf8', timeout: 5_000, env: { ...process.env, ...TEST_MODULE_ENV },
  });
}

type BoundOptions = { args?: string[]; timeoutMs?: number;
  trustedEnvironment?: boolean;
  terminology?: (input: unknown, signal: AbortSignal) => unknown;
  openLoops?: (input: unknown, signal: AbortSignal) => unknown;
  proposal?: (input: unknown, signal: AbortSignal) => unknown };
async function runBound(input: string | Buffer, options: BoundOptions = {}) {
  const environment = createAipOperationRpcChildEnvironmentV1(`aipb_${'1'.repeat(32)}`);
  const child: ChildProcess = spawn(process.execPath,
    ['--experimental-strip-types', '--import', LOADER, CLI, ...(options.args ?? [])], {
      env: { ...(options.trustedEnvironment === false ? {} : environment), ...TEST_MODULE_ENV } as NodeJS.ProcessEnv,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  });
  const observed: unknown[] = [];
  const host = createAipOperationRpcHostV1({ operations: [{
    operationId: 'mediflow.terminology.search.v1', capabilityId: 'mediflow.terminology.search.v1',
    serviceRef: 'AipTerminologySearchServiceV1', maximumStage: 'read_only', timeoutMs: options.timeoutMs ?? 250,
    execute: options.terminology ?? ((value: unknown) => { observed.push(value); return terminology; }),
  }, {
    operationId: 'mediflow.patient.open_loops.read.v1', capabilityId: 'mediflow.patient.open_loops.read.v1',
    serviceRef: 'PatientOpenLoopsReadServiceV1', maximumStage: 'read_only', timeoutMs: options.timeoutMs ?? 250,
    execute: options.openLoops ?? ((value: unknown) => { observed.push(value); return loops; }),
  }, {
    operationId: 'mediflow.patient.open_loops.follow_up.propose.v1',
    capabilityId: 'mediflow.patient.open_loops.follow_up.propose.v1',
    serviceRef: 'PatientOpenLoopsFollowUpProposalServiceV1', maximumStage: 'proposal_only',
    timeoutMs: options.timeoutMs ?? 250,
    execute: options.proposal ?? ((value: unknown) => { observed.push(value); return proposal; }),
  }] });
  host.attach({ subscribe: (listener: (frame: unknown) => void) => {
    child.on('message', listener); return () => child.off('message', listener);
  }, publish: (frame: string) => { if (child.connected) child.send(frame); } });
  let stdout = ''; let stderr = '';
  child.stdout!.setEncoding('utf8'); child.stderr!.setEncoding('utf8');
  child.stdout!.on('data', (chunk: string) => { stdout += chunk; });
  child.stderr!.on('data', (chunk: string) => { stderr += chunk; });
  child.stdin!.end(input);
  const code = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Mini timed out')); }, 5_000);
    child.once('exit', (value) => { clearTimeout(timer); resolve(value); });
  });
  return { code, stdout, stderr, observed };
}

test('reads non-PHI status and the exact host-bound capability catalog over child IPC', async () => {
  const statusResult = await runBound('{"command":"status","args":{}}');
  assert.equal(statusResult.code, 0); assert.equal(statusResult.stdout, success(status));
  const result = await runBound('{"command":"capabilities","args":{}}');
  assert.equal(result.code, 0); assert.equal(result.stderr, '');
  assert.equal(result.stdout, success(capabilityCatalog));
  assert.equal(result.observed.length, 0);
});

test('executes the two explicit read commands without caller-supplied patient scope', async () => {
  const search = await runBound(JSON.stringify({ command: 'terminology search',
    args: { system: 'LOINC', query: '  synthetic   query ', limit: 3 } }));
  assert.equal(search.code, 0); assert.equal(search.stderr, ''); assert.equal(search.stdout, success(terminology));
  assert.deepEqual(search.observed.map((value) => ({ ...(value as object) })), [{
    schemaVersion: 'mediflow.terminology.search.input.v1', operationId: 'mediflow.terminology.search.v1',
    system: 'LOINC', query: 'synthetic query', limit: 3,
  }]);
  const openLoops = await runBound('{"command":"open-loops","args":{}}');
  assert.equal(openLoops.code, 0); assert.equal(openLoops.stdout, success(loops));
  assert.deepEqual(openLoops.observed.map((value) => ({ ...(value as object) })), [{
    schemaVersion: 'mediflow.patient.open_loops.read.input.v1', operationId: 'mediflow.patient.open_loops.read.v1',
  }]);
  assert.doesNotMatch(`${search.stdout}${openLoops.stdout}`, /patientId|patientName|birth|authority|provider/i);
});

test('requests one review-only follow-up proposal with an exact empty caller input', async () => {
  const result = await runBound('{"command":"follow-up-proposal","args":{}}');
  assert.equal(result.code, 0); assert.equal(result.stderr, ''); assert.equal(result.stdout, success(proposal));
  assert.deepEqual(result.observed.map((value) => ({ ...(value as object) })), [{
    schemaVersion: 'mediflow.patient.open_loops.follow_up.propose.input.v1',
    operationId: 'mediflow.patient.open_loops.follow_up.propose.v1',
  }]);
  assert.doesNotMatch(result.stdout, /patientId|patientName|birth|diagnosis|reasoning|prompt|authority|provider/iu);
});

test('fails all valid commands closed when inherited host IPC is absent', () => {
  const requests = [{ command: 'status', args: {} }, { command: 'capabilities', args: {} }, { command: 'terminology search',
    args: { system: 'LOINC', query: 'synthetic', limit: 1 } }, { command: 'open-loops', args: {} },
  { command: 'follow-up-proposal', args: {} }];
  for (const request of requests) {
    const result = runUnbound(JSON.stringify(request));
    assert.equal(result.status, 69); assert.equal(result.stderr, '');
    assert.equal(result.stdout, failure('TRANSPORT_UNBOUND'));
  }
});

test('rejects oversized open stdin without waiting for EOF', async () => {
  const child = spawn(process.execPath, ['--experimental-strip-types', '--import', LOADER, CLI], {
    cwd: ROOT, env: TEST_MODULE_ENV as NodeJS.ProcessEnv, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = ''; let stderr = '';
  child.stdout!.setEncoding('utf8'); child.stderr!.setEncoding('utf8');
  child.stdout!.on('data', (chunk: string) => { stdout += chunk; });
  child.stderr!.on('data', (chunk: string) => { stderr += chunk; });
  child.stdin!.write(Buffer.alloc(16 * 1024 + 1, 0x78));
  const code = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Mini waited for EOF')); }, 3000);
    child.on('exit', (status) => { clearTimeout(timer); resolve(status); });
  });
  assert.equal(code, 2); assert.equal(stderr, ''); assert.equal(stdout, failure('INVALID_REQUEST'));
});

test('rejects a spoofable IPC parent when the launcher binding is absent', async () => {
  const result = await runBound('{"command":"capabilities","args":{}}', { trustedEnvironment: false });
  assert.equal(result.code, 69); assert.equal(result.stderr, '');
  assert.equal(result.stdout, failure('TRANSPORT_UNBOUND'));
  assert.equal(result.observed.length, 0);
});

test('rejects extra, duplicate and unknown caller fields before host service entry', async () => {
  const invalid = ['{"command":"open-loops","args":{"patientId":"sensitive-value"}}',
    '{"command":"follow-up-proposal","args":{"text":"forbidden"}}',
    '{"command":"terminology search","args":{"system":"LOINC","query":"x","limit":1,"authority":"caller"}}',
    '{"command":"open-loops","command":"capabilities","args":{}}',
    '{"command":"patient show","args":{}}', 'not-secret-json'];
  for (const input of invalid) {
    const result = await runBound(input);
    assert.equal(result.code, 2); assert.equal(result.stdout, failure('INVALID_REQUEST'));
    assert.doesNotMatch(result.stdout, /sensitive-value|not-secret-json|authority/u);
    assert.equal(result.observed.length, 0);
  }
});

test('maps host timeout to a typed PHI-safe denial and drops late completion', async () => {
  let finish: ((value: unknown) => void) | undefined;
  const result = await runBound('{"command":"terminology search","args":{"system":"LOINC","query":"x","limit":1}}', {
    timeoutMs: 15, terminology: () => new Promise((resolve) => { finish = resolve; }),
  });
  assert.equal(result.code, 70); assert.equal(result.stdout, failure('OPERATION_DENIED'));
  finish?.(terminology);
});

test('keeps help, format and input budgets deterministic', async () => {
  const help = spawnSync(process.execPath, ['--experimental-strip-types', '--import', LOADER, CLI, '--help'], {
    cwd: ROOT, encoding: 'utf8', timeout: 5_000, env: TEST_MODULE_ENV as NodeJS.ProcessEnv,
  });
  assert.equal(help.status, 0); assert.equal(help.stderr, '');
  assert.equal(help.stdout, 'Usage: mediflow-mini [--format json|ndjson] < request.json\n');
  const formatted = await runBound('{ "args": {}, "command": "capabilities" }', { args: ['--format', 'ndjson'] });
  assert.equal(formatted.stdout, success(capabilityCatalog));
  const oversized = runUnbound(Buffer.alloc(16 * 1024 + 1, 0x78));
  assert.equal(oversized.status, 2); assert.equal(oversized.stdout, failure('INVALID_REQUEST'));
});
