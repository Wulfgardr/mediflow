/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import Database from 'better-sqlite3';

const root = process.cwd();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-semantic-audit-port-'));
const databasePath = path.join(dataDir, 'medical.db');
process.env.MEDIFLOW_DATA_DIR = dataDir;

const bootstrap = new Database(databasePath);
for (const fileName of fs.readdirSync(path.join(root, 'drizzle')).filter((name) => name.endsWith('.sql')).sort()) {
  bootstrap.exec(fs.readFileSync(path.join(root, 'drizzle', fileName), 'utf8')
    .replace(/^-->\s+statement-breakpoint\s*$/gmu, ''));
}
bootstrap.close();

const { createPortableSupervisorSemanticAuditPortV1 } =
  await import('./portable-supervisor-semantic-audit-port.ts');
const { listAuditEvents } = await import('./audit.ts');
const { ensureAuditSqliteSchema } = await import('./audit-db.ts');
const { dbServer } = await import('../db-server.ts');
const { settings } = await import('../schema.ts');

const USER_REF = `user.${'a'.repeat(64)}`;
const PARENT_REF = `parent.${'b'.repeat(64)}`;
const PATIENT_ID = 'synthetic-patient-semantic-audit';
const AMBULATORY_ID = 'synthetic-ambulatory-semantic-audit';
const TIMESTAMP = 1_800_000_000_000;

function record<Value extends Record<string, unknown>>(value: Value): Readonly<Value> {
  return Object.freeze(Object.assign(Object.create(null), value)) as Readonly<Value>;
}

function context(overrides: Record<string, unknown> = {}) {
  return record({
    status: 'available', userRef: USER_REF, parentRef: PARENT_REF, purposeCode: 'care_coordination',
    patientId: PATIENT_ID, ambulatoryId: AMBULATORY_ID, generation: 7, revocationGeneration: 2,
    selectionEpoch: 11, restartGeneration: 1, parentGeneration: 3, policyGeneration: 5,
    expiresAt: TIMESTAMP + 60_000, bootstrapExpiresAt: TIMESTAMP + 30_000, ...overrides,
  });
}

function binding() {
  return record({ generation: 7, revocationGeneration: 2, selectionEpoch: 11 });
}

function allowedIntent() {
  return record({
    schemaVersion: 'mediflow.aip.audit.v1', eventType: 'semantic_query_plan_execution', outcome: 'allowed',
    operation: 'mediflow.semantic_query_plan.execute.v1',
    capabilityId: 'mediflow.semantic_query_plan.execute.v1', policyDecision: 'allowed',
    revisionBinding: binding(), operationCount: 2, writesPerformed: 0, applyPolicy: 'none', denialCode: null,
  });
}

function allowedAudit() {
  return record({ ...allowedIntent(), durationMs: 17, timestamp: TIMESTAMP });
}

function deniedIntent() {
  return record({
    schemaVersion: 'mediflow.aip.audit.v1', eventType: 'semantic_query_plan_execution', outcome: 'denied',
    operation: 'mediflow.semantic_query_plan.execute.v1',
    capabilityId: 'mediflow.semantic_query_plan.execute.v1', policyDecision: 'denied',
    revisionBinding: null, operationCount: 0, durationMs: 0, writesPerformed: 0,
    applyPolicy: 'none', denialCode: 'plan_denied',
  });
}

function deniedAudit() {
  return record({ ...deniedIntent(), timestamp: TIMESTAMP + 1 });
}

function database(): Database.Database {
  return new Database(databasePath);
}

function auditCount(): number {
  const sqlite = database();
  try {
    return (sqlite.prepare(`SELECT COUNT(*) AS count FROM audit_events
      WHERE event_type = 'agent.semantic_query.executed'`).get() as { count: number }).count;
  } finally { sqlite.close(); }
}

after(() => { fs.rmSync(dataDir, { recursive: true, force: true }); });

test('persists one canonical allowed terminal audit and returns the same object', async () => {
  const port = createPortableSupervisorSemanticAuditPortV1({ readHostContext: () => context() });
  const intent = allowedIntent();
  const terminal = allowedAudit();
  let decisions = 0;

  const committed = port(intent, () => { decisions += 1; return terminal; });

  assert.equal(decisions, 1);
  assert.equal(committed, terminal);
  assert.equal(Object.isFrozen(committed), true);
  assert.equal(Object.getPrototypeOf(committed), null);

  const sqlite = database();
  try {
    const row = sqlite.prepare(`SELECT schema_version AS schemaVersion, event_type AS eventType, outcome,
      actor_type AS actorType, actor_ref AS actorRef, subject_type AS subjectType, subject_ref AS subjectRef,
      source_surface AS sourceSurface, request_id AS requestId, redacted_metadata AS redactedMetadata
      FROM audit_events WHERE event_type = 'agent.semantic_query.executed'`).get() as Record<string, unknown>;
    assert.deepEqual({ ...row, redactedMetadata: JSON.parse(row.redactedMetadata as string) }, {
      schemaVersion: 1, eventType: 'agent.semantic_query.executed', outcome: 'success', actorType: 'user',
      actorRef: row.actorRef, subjectType: 'agent_operation', subjectRef: row.subjectRef,
      sourceSurface: 'api', requestId: null,
      redactedMetadata: {
        flags: ['operation:mediflow.semantic_query_plan.execute.v1',
          'capability:mediflow.semantic_query_plan.execute.v1', 'outcome:allowed', 'policy:allowed',
          'generation:7', 'revocation_generation:2', 'selection_epoch:11', 'duration_ms:17',
          'writes:0', 'apply:none'],
        counts: 2,
      },
    });
    assert.match(row.actorRef as string, /^sha256:[0-9a-f]{16}$/u);
    assert.match(row.subjectRef as string, /^sha256:[0-9a-f]{16}$/u);
    assert.notEqual(row.actorRef, USER_REF);
    assert.notEqual(row.subjectRef, PARENT_REF);
    const serialized = JSON.stringify(row);
    assert.doesNotMatch(serialized, /synthetic-patient|synthetic-ambulatory|patientId|ambulatoryId|sourceRefs/iu);
  } finally { sqlite.close(); }

  const listed = await listAuditEvents({ eventType: 'agent.semantic_query.executed' });
  assert.deepEqual(listed[0]?.redactedMetadata, {
    flags: ['operation:mediflow.semantic_query_plan.execute.v1',
      'capability:mediflow.semantic_query_plan.execute.v1', 'outcome:allowed', 'policy:allowed',
      'generation:7', 'revocation_generation:2', 'selection_epoch:11', 'duration_ms:17',
      'writes:0', 'apply:none'],
    counts: 2,
  });
});

test('persists a denied terminal audit without binding or clinical identifiers', () => {
  const port = createPortableSupervisorSemanticAuditPortV1({ readHostContext: () => context() });
  const terminal = deniedAudit();

  assert.equal(port(deniedIntent(), () => terminal), terminal);

  const sqlite = database();
  try {
    const row = sqlite.prepare(`SELECT outcome, actor_ref AS actorRef, subject_ref AS subjectRef,
      redacted_metadata AS metadata
      FROM audit_events WHERE event_type = 'agent.semantic_query.executed' AND outcome = 'denied'`).get() as {
        outcome: string; actorRef: string; subjectRef: string; metadata: string;
      };
    assert.equal(row.outcome, 'denied');
    assert.deepEqual(JSON.parse(row.metadata), {
      flags: ['operation:mediflow.semantic_query_plan.execute.v1',
        'capability:mediflow.semantic_query_plan.execute.v1', 'outcome:denied', 'policy:denied',
        'duration_ms:0', 'writes:0', 'apply:none'],
      counts: 0, reasonCode: 'plan_denied',
    });
    assert.doesNotMatch(row.metadata, /patient|ambulatory|sourceRefs/iu);
    const allowed = sqlite.prepare(`SELECT actor_ref AS actorRef, subject_ref AS subjectRef FROM audit_events
      WHERE event_type = 'agent.semantic_query.executed' AND outcome = 'success'`).get() as {
        actorRef: string; subjectRef: string;
      };
    assert.deepEqual({ actorRef: row.actorRef, subjectRef: row.subjectRef }, allowed);
  } finally { sqlite.close(); }
});

test('calls the decision once then rolls back when its binding is stale', () => {
  const before = auditCount();
  const port = createPortableSupervisorSemanticAuditPortV1({
    readHostContext: () => context({ selectionEpoch: 12 }),
  });
  let decisions = 0;

  assert.throws(() => port(allowedIntent(), () => { decisions += 1; return allowedAudit(); }), (error) => {
    assert.equal((error as { code?: unknown }).code, 'context_unavailable');
    return true;
  });
  assert.equal(decisions, 1);
  assert.equal(auditCount(), before);
});

test('rejects an invalid host context before calling the decision', () => {
  const before = auditCount();
  const invalidContext = Object.freeze({ ...context() });
  let decisions = 0;
  const port = createPortableSupervisorSemanticAuditPortV1({ readHostContext: () => invalidContext });

  assert.throws(() => port(allowedIntent(), () => { decisions += 1; return allowedAudit(); }), (error) => {
    assert.equal((error as { code?: unknown }).code, 'context_unavailable');
    return true;
  });
  assert.equal(decisions, 0);
  assert.equal(auditCount(), before);
});

test('rejects non-canonical or extended terminal audit shapes', () => {
  const before = auditCount();
  const port = createPortableSupervisorSemanticAuditPortV1({ readHostContext: () => context() });
  let decisions = 0;
  const mutable = { ...allowedAudit() };

  assert.throws(() => port(allowedIntent(), () => { decisions += 1; return mutable; }), (error) => {
    assert.equal((error as { code?: unknown }).code, 'audit_unavailable');
    return true;
  });
  assert.throws(() => port(allowedIntent(), () => {
    decisions += 1;
    return record({ ...allowedAudit(), patientId: PATIENT_ID });
  }), (error) => {
    assert.equal((error as { code?: unknown }).code, 'audit_unavailable');
    return true;
  });
  assert.equal(decisions, 2);
  assert.equal(auditCount(), before);
});

test('preserves a decision failure and never retries the callback', () => {
  const before = auditCount();
  const failure = new Error('synthetic terminal decision failure');
  const port = createPortableSupervisorSemanticAuditPortV1({ readHostContext: () => context() });
  let decisions = 0;

  assert.throws(() => port(allowedIntent(), () => { decisions += 1; throw failure; }),
    (error) => error === failure);
  assert.equal(decisions, 1);
  assert.equal(auditCount(), before);
});

test('is synchronous and rejects async or Promise-returning sources fail closed', () => {
  const before = auditCount();
  const terminal = allowedAudit();
  const port = createPortableSupervisorSemanticAuditPortV1({ readHostContext: () => context() });
  let decisions = 0;

  assert.throws(() => port(allowedIntent(), async () => terminal), (error) => {
    assert.equal((error as { code?: unknown }).code, 'audit_unavailable');
    return true;
  });
  assert.equal(decisions, 0);
  assert.throws(() => port(allowedIntent(), () => { decisions += 1; return Promise.resolve(terminal); }), (error) => {
    assert.equal((error as { code?: unknown }).code, 'audit_unavailable');
    return true;
  });
  assert.equal(decisions, 1);
  assert.equal(auditCount(), before);

  const promiseContextPort = createPortableSupervisorSemanticAuditPortV1({
    readHostContext: () => Promise.resolve(context()),
  });
  assert.throws(() => promiseContextPort(allowedIntent(), () => terminal), (error) => {
    assert.equal((error as { code?: unknown }).code, 'context_unavailable');
    return true;
  });
  assert.equal(auditCount(), before);
});

test('rolls back callback-side writes when the audit insert trigger fails', () => {
  const before = auditCount();
  const marker = 'semantic-audit-trigger-rollback';
  const sqlite = database();
  try {
    sqlite.exec(`CREATE TRIGGER semantic_audit_insert_failure BEFORE INSERT ON audit_events
      WHEN NEW.event_type = 'agent.semantic_query.executed'
      BEGIN SELECT RAISE(ABORT, 'synthetic semantic audit insert failure'); END;`);
  } finally { sqlite.close(); }
  const port = createPortableSupervisorSemanticAuditPortV1({ readHostContext: () => context() });
  let decisions = 0;
  try {
    assert.throws(() => port(allowedIntent(), () => {
      decisions += 1;
      dbServer.insert(settings).values({ key: marker, value: 'pending' }).run();
      return allowedAudit();
    }), /synthetic semantic audit insert failure/u);
  } finally {
    const cleanup = database();
    try { cleanup.exec('DROP TRIGGER IF EXISTS semantic_audit_insert_failure'); } finally { cleanup.close(); }
  }
  assert.equal(decisions, 1);
  const verified = database();
  try {
    assert.equal(verified.prepare('SELECT value FROM settings WHERE key = ?').get(marker), undefined);
  } finally { verified.close(); }
  assert.equal(auditCount(), before);
});

test('rolls back when an inserted audit row disappears before reread', () => {
  const before = auditCount();
  const marker = 'semantic-audit-reread-rollback';
  const sqlite = database();
  try {
    sqlite.exec(`DROP TRIGGER audit_events_no_delete;
      CREATE TRIGGER semantic_audit_reread_failure AFTER INSERT ON audit_events
      WHEN NEW.event_type = 'agent.semantic_query.executed'
      BEGIN DELETE FROM audit_events WHERE event_id = NEW.event_id; END;`);
  } finally { sqlite.close(); }
  const port = createPortableSupervisorSemanticAuditPortV1({ readHostContext: () => context() });
  let decisions = 0;
  try {
    assert.throws(() => port(allowedIntent(), () => {
      decisions += 1;
      dbServer.insert(settings).values({ key: marker, value: 'pending' }).run();
      return allowedAudit();
    }), (error) => {
      assert.equal((error as { code?: unknown }).code, 'audit_unavailable');
      return true;
    });
  } finally {
    const cleanup = database();
    try {
      cleanup.exec('DROP TRIGGER IF EXISTS semantic_audit_reread_failure');
      ensureAuditSqliteSchema(cleanup);
    } finally { cleanup.close(); }
  }
  assert.equal(decisions, 1);
  const verified = database();
  try {
    assert.equal(verified.prepare('SELECT value FROM settings WHERE key = ?').get(marker), undefined);
  } finally { verified.close(); }
  assert.equal(auditCount(), before);
});
