/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import Database from 'better-sqlite3';

const root = process.cwd();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-aip-audit-port-'));
const databasePath = path.join(dataDir, 'medical.db');
process.env.MEDIFLOW_DATA_DIR = dataDir;

const bootstrap = new Database(databasePath);
for (const name of fs.readdirSync(path.join(root, 'drizzle')).filter((item) => item.endsWith('.sql')).sort()) {
  bootstrap.exec(fs.readFileSync(path.join(root, 'drizzle', name), 'utf8')
    .replace(/^-->\s+statement-breakpoint\s*$/gmu, ''));
}
bootstrap.close();

const { createPortableSupervisorAipAuditPortV1 } = await import('./portable-supervisor-aip-audit-port.ts');

const HOST_TIME = 1_800_000_100_000;
const INPUT_TIME = 1_700_000_000_000;
const USER_REF = `user.${'a'.repeat(64)}`;
const PARENT_REF = `parent.${'b'.repeat(64)}`;
const AGENT_HASH = `sha256:${'c'.repeat(64)}`;
const LEASE_HASH = `sha256:${'d'.repeat(64)}`;
const PEER_HASH = `sha256:${'e'.repeat(64)}`;
const RUNTIME_HASH = `sha256:${'f'.repeat(64)}`;
const OWNER_HASH = `sha256:${'1'.repeat(64)}`;
const RECEIPT_HASH = `sha256:${'2'.repeat(64)}`;
const SOURCE_RECEIPT_HASH = `sha256:${'3'.repeat(64)}`;

function canonical<Value extends Record<string, unknown>>(value: Value): Readonly<Value> {
  return Object.freeze(Object.assign(Object.create(null), value)) as Readonly<Value>;
}

function context(overrides: Record<string, unknown> = {}) {
  return canonical({
    status: 'available', userRef: USER_REF, parentRef: PARENT_REF, purposeCode: 'care_coordination',
    patientId: 'synthetic-patient-aip-audit', ambulatoryId: 'synthetic-ambulatory-aip-audit',
    generation: 7, revocationGeneration: 2, selectionEpoch: 11, restartGeneration: 1,
    parentGeneration: 3, policyGeneration: 5, expiresAt: HOST_TIME + 60_000,
    bootstrapExpiresAt: HOST_TIME + 30_000, ...overrides,
  });
}

function authorizationAllowed() {
  return Object.freeze({
    schemaVersion: 'mediflow.aip.audit.v1', eventType: 'authorization', outcome: 'allowed',
    operation: 'mediflow.terminology.search.v1', capabilityId: 'mediflow.terminology.search.v1',
    agentRefHash: AGENT_HASH, leaseRefHash: LEASE_HASH, purposeCode: 'care_coordination',
    maxStage: 'read_only', generation: 7, selectionEpoch: 11, timestamp: INPUT_TIME,
    denialCode: null, budgetUsed: 1,
  });
}

function bootstrapAllowed() {
  return Object.freeze({
    schemaVersion: 'mediflow.aip.ipc.audit.v1', eventType: 'bootstrap', outcome: 'allowed',
    transport: 'inherited_child_ipc', peerRefHash: PEER_HASH, runtimeRefHash: RUNTIME_HASH,
    timestamp: INPUT_TIME, denialCode: null,
  });
}

function terminologyAllowed() {
  return canonical({
    schemaVersion: 'mediflow.aip.audit.v1', eventType: 'terminology_search', outcome: 'allowed',
    operation: 'mediflow.terminology.search.v1', capabilityId: 'mediflow.terminology.search.v1',
    receiptRef: `aipr_${'4'.repeat(64)}`, system: 'LOINC', resultCount: 3, maxStage: 'read_only',
    egress: 'none', writesPerformed: 0, timestamp: INPUT_TIME, denialCode: null,
  });
}

function openLoopsAllowed() {
  return canonical({
    schemaVersion: 'mediflow.aip.audit.v1', eventType: 'patient_open_loops_read', outcome: 'allowed',
    operation: 'mediflow.patient.open_loops.read.v1', capabilityId: 'mediflow.patient.open_loops.read.v1',
    purposeCode: 'care_coordination', maxStage: 'read_only', ownerRefHash: OWNER_HASH,
    leaseRefHash: LEASE_HASH, receiptRefHash: RECEIPT_HASH, generation: 7, revocationGeneration: 2,
    selectionEpoch: 11, snapshotRevision: 9, itemCount: 2, truncated: false, egress: 'none',
    writesPerformed: 0, timestamp: INPUT_TIME, denialCode: null,
  });
}

function proposalAllowed() {
  return canonical({
    schemaVersion: 'mediflow.aip.audit.v1', eventType: 'patient_open_loops_follow_up_proposal',
    outcome: 'allowed', operation: 'mediflow.patient.open_loops.follow_up.propose.v1',
    capabilityId: 'mediflow.patient.open_loops.follow_up.propose.v1', proposalRefHash: OWNER_HASH,
    receiptRefHash: RECEIPT_HASH, sourceReceiptRefHash: SOURCE_RECEIPT_HASH, basedOnSnapshotRevision: 9,
    itemCount: 2, maximumStage: 'proposal_only', reviewRequired: true, writesPerformed: 0,
    apply: 'none', egress: 'none', timestamp: INPUT_TIME, denialCode: null,
  });
}

function writer(overrides: { now?: () => unknown; readHostContext?: () => unknown } = {}) {
  let reads = 0;
  return createPortableSupervisorAipAuditPortV1({
    now: overrides.now ?? (() => HOST_TIME + Math.min(reads++, 1)),
    readHostContext: overrides.readHostContext ?? (() => context()),
  });
}

function database(): Database.Database { return new Database(databasePath); }

function auditCount(): number {
  const sqlite = database();
  try {
    return (sqlite.prepare(`SELECT COUNT(*) AS count FROM audit_events
      WHERE event_type = 'agent.operation.attempted'`).get() as { count: number }).count;
  } finally { sqlite.close(); }
}

after(() => { fs.rmSync(dataDir, { recursive: true, force: true }); });

test('persists an allowed authorization as a host-timestamped non-terminal attempt', async () => {
  const writeAudit = writer();
  const pending = writeAudit(authorizationAllowed());
  assert.equal(pending instanceof Promise, true);
  await pending;

  const sqlite = database();
  try {
    const row = sqlite.prepare(`SELECT event_type AS eventType, occurred_at AS occurredAt, outcome,
      actor_ref AS actorRef, subject_ref AS subjectRef, redacted_metadata AS metadata
      FROM audit_events WHERE event_type = 'agent.operation.attempted'`).get() as Record<string, unknown>;
    assert.equal(row.outcome, 'success');
    assert.equal(row.occurredAt, Math.floor((HOST_TIME + 1) / 1_000));
    assert.match(row.actorRef as string, /^sha256:[0-9a-f]{16}$/u);
    assert.match(row.subjectRef as string, /^sha256:[0-9a-f]{16}$/u);
    const metadata = JSON.parse(row.metadata as string) as { flags: string[]; counts: number };
    assert.deepEqual(metadata.flags.slice(0, 8), [
      'family:authorization', 'operation:mediflow.terminology.search.v1',
      'capability:mediflow.terminology.search.v1', 'aip_outcome:allowed',
      'purpose:care_coordination', 'max_stage:read_only', 'generation:7', 'selection_epoch:11',
    ]);
    assert.equal(metadata.counts, 1);
    assert.match(metadata.flags[8]!, /^agent_ref:sha256:[0-9a-f]{16}$/u);
    assert.match(metadata.flags[9]!, /^lease_ref:sha256:[0-9a-f]{16}$/u);
    assert.doesNotMatch(JSON.stringify(row), new RegExp(`${AGENT_HASH}|${LEASE_HASH}|synthetic-patient|synthetic-ambulatory`, 'u'));
  } finally { sqlite.close(); }
});

test('persists the other four canonical AIP audit families through the same closed port', async () => {
  const writeAudit = writer();
  for (const value of [bootstrapAllowed(), terminologyAllowed(), openLoopsAllowed(), proposalAllowed()]) {
    await writeAudit(value);
  }

  const sqlite = database();
  try {
    const rows = sqlite.prepare(`SELECT redacted_metadata AS metadata FROM audit_events
      WHERE event_type = 'agent.operation.attempted' ORDER BY rowid DESC LIMIT 4`).all() as Array<{ metadata: string }>;
    const families = rows.map((row) => (JSON.parse(row.metadata) as { flags: string[] }).flags[0]).sort();
    assert.deepEqual(families, [
      'family:bootstrap', 'family:patient_open_loops_follow_up_proposal',
      'family:patient_open_loops_read', 'family:terminology_search',
    ]);
    for (const row of rows) {
      const metadata = JSON.parse(row.metadata) as Record<string, unknown>;
      assert.deepEqual(Object.keys(metadata).every((key) => ['flags', 'counts', 'resourceVersion', 'reasonCode'].includes(key)), true);
    }
    assert.doesNotMatch(JSON.stringify(rows), new RegExp([
      PEER_HASH, RUNTIME_HASH, OWNER_HASH, LEASE_HASH, RECEIPT_HASH, SOURCE_RECEIPT_HASH,
      'aipr_', 'synthetic-patient', 'synthetic-ambulatory',
    ].join('|'), 'u'));
  } finally { sqlite.close(); }
});

test('persists denied attempts without converting them into terminal operation results', async () => {
  const writeAudit = writer();
  const denied = [
    Object.freeze({ ...authorizationAllowed(), outcome: 'denied', denialCode: 'budget_exhausted', budgetUsed: 1 }),
    Object.freeze({ ...bootstrapAllowed(), outcome: 'denied', transport: null, peerRefHash: null,
      runtimeRefHash: null, denialCode: 'peer_denied' }),
    canonical({ ...terminologyAllowed(), outcome: 'denied', receiptRef: null, resultCount: 0,
      denialCode: 'authorization_denied' }),
    canonical({
      schemaVersion: 'mediflow.aip.audit.v1', eventType: 'patient_open_loops_read', outcome: 'denied',
      operation: 'mediflow.patient.open_loops.read.v1', capabilityId: 'mediflow.patient.open_loops.read.v1',
      purposeCode: 'care_coordination', maxStage: 'read_only', ownerRefHash: null, leaseRefHash: null,
      receiptRefHash: null, itemCount: 0, truncated: false, egress: 'none', writesPerformed: 0,
      timestamp: INPUT_TIME, denialCode: 'authorization_denied',
    }),
    canonical({ ...proposalAllowed(), outcome: 'denied', proposalRefHash: null, receiptRefHash: null,
      sourceReceiptRefHash: null, basedOnSnapshotRevision: null, itemCount: 0,
      denialCode: 'authorization_denied' }),
  ];
  const before = auditCount();
  for (const value of denied) await writeAudit(value);

  const sqlite = database();
  try {
    const rows = sqlite.prepare(`SELECT event_type AS eventType, outcome, redacted_metadata AS metadata
      FROM audit_events WHERE event_type = 'agent.operation.attempted' ORDER BY rowid DESC LIMIT 5`).all() as
      Array<{ eventType: string; outcome: string; metadata: string }>;
    assert.equal(auditCount(), before + 5);
    assert.equal(rows.every((row) => row.eventType === 'agent.operation.attempted' && row.outcome === 'denied'), true);
    assert.equal(rows.every((row) => typeof (JSON.parse(row.metadata) as { reasonCode?: unknown }).reasonCode === 'string'), true);
  } finally { sqlite.close(); }
});

test('rejects mutable, extended, accessor, Proxy and Promise audit records', async () => {
  const writeAudit = writer();
  const before = auditCount();
  const mutable = { ...authorizationAllowed() };
  const extended = Object.freeze({ ...authorizationAllowed(), patientId: 'synthetic-patient-forbidden' });
  const accessor = Object.freeze(Object.defineProperty({ ...authorizationAllowed() }, 'timestamp', {
    enumerable: true, get: () => INPUT_TIME,
  }));
  const proxy = new Proxy(authorizationAllowed(), {});
  for (const value of [mutable, extended, accessor, proxy, Promise.resolve(authorizationAllowed())]) {
    await assert.rejects(writeAudit(value), (error) => {
      assert.equal((error as { code?: unknown }).code, 'audit_unavailable');
      return true;
    });
  }
  assert.equal(auditCount(), before);
});

test('rolls the insert back on context or clock drift', async () => {
  const before = auditCount();
  let contextReads = 0;
  const driftingContext = writer({
    readHostContext: () => contextReads++ === 0 ? context() : context({ selectionEpoch: 12 }),
  });
  await assert.rejects(driftingContext(authorizationAllowed()), (error) => {
    assert.equal((error as { code?: unknown }).code, 'context_unavailable');
    return true;
  });
  let clockReads = 0;
  const regressingClock = writer({ now: () => clockReads++ === 0 ? HOST_TIME : HOST_TIME - 1 });
  await assert.rejects(regressingClock(authorizationAllowed()), (error) => {
    assert.equal((error as { code?: unknown }).code, 'audit_unavailable');
    return true;
  });
  assert.equal(auditCount(), before);
});

test('rejects Promise-valued host sources and records no audit', async () => {
  const before = auditCount();
  await assert.rejects(writer({ readHostContext: () => Promise.resolve(context()) })(authorizationAllowed()),
    (error) => (error as { code?: unknown }).code === 'context_unavailable');
  await assert.rejects(writer({ now: () => Promise.resolve(HOST_TIME) })(authorizationAllowed()),
    (error) => (error as { code?: unknown }).code === 'audit_unavailable');
  assert.equal(auditCount(), before);
});
