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

function allowedAudit(overrides: Record<string, unknown> = {}) {
  return record({ ...allowedIntent(), durationMs: 17, timestamp: TIMESTAMP, ...overrides });
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

function deniedAudit(overrides: Record<string, unknown> = {}) {
  return record({ ...deniedIntent(), timestamp: TIMESTAMP + 1, ...overrides });
}

function port(overrides: { now?: () => unknown; readHostContext?: () => unknown } = {}) {
  let clockReads = 0;
  return createPortableSupervisorSemanticAuditPortV1({
    now: overrides.now ?? (() => TIMESTAMP + Math.min(clockReads++, 1)),
    readHostContext: overrides.readHostContext ?? (() => context()),
  });
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
  const commit = port();
  const intent = allowedIntent();
  const terminal = allowedAudit();
  let decisions = 0;

  const committed = commit(intent, () => { decisions += 1; return terminal; });

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
  const commit = port();
  const terminal = deniedAudit();

  assert.equal(commit(deniedIntent(), () => terminal), terminal);

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
  const commit = port({
    readHostContext: () => context({ selectionEpoch: 12 }),
  });
  let decisions = 0;

  assert.throws(() => commit(allowedIntent(), () => { decisions += 1; return allowedAudit(); }), (error) => {
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
  const commit = port({ readHostContext: () => invalidContext });

  assert.throws(() => commit(allowedIntent(), () => { decisions += 1; return allowedAudit(); }), (error) => {
    assert.equal((error as { code?: unknown }).code, 'context_unavailable');
    return true;
  });
  assert.equal(decisions, 0);
  assert.equal(auditCount(), before);
});

test('rejects non-canonical or extended terminal audit shapes', () => {
  const before = auditCount();
  const commit = port();
  let decisions = 0;
  const mutable = { ...allowedAudit() };

  assert.throws(() => commit(allowedIntent(), () => { decisions += 1; return mutable; }), (error) => {
    assert.equal((error as { code?: unknown }).code, 'audit_unavailable');
    return true;
  });
  assert.throws(() => commit(allowedIntent(), () => {
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
  const commit = port();
  let decisions = 0;

  assert.throws(() => commit(allowedIntent(), () => { decisions += 1; throw failure; }),
    (error) => error === failure);
  assert.equal(decisions, 1);
  assert.equal(auditCount(), before);
});

test('is synchronous and rejects async or Promise-returning sources fail closed', () => {
  const before = auditCount();
  const terminal = allowedAudit();
  const commit = port();
  let decisions = 0;

  assert.throws(() => commit(allowedIntent(), async () => terminal), (error) => {
    assert.equal((error as { code?: unknown }).code, 'audit_unavailable');
    return true;
  });
  assert.equal(decisions, 0);
  assert.throws(() => commit(allowedIntent(), () => { decisions += 1; return Promise.resolve(terminal); }), (error) => {
    assert.equal((error as { code?: unknown }).code, 'audit_unavailable');
    return true;
  });
  assert.equal(decisions, 1);
  assert.equal(auditCount(), before);

  const promiseContextPort = port({
    readHostContext: () => Promise.resolve(context()),
  });
  assert.throws(() => promiseContextPort(allowedIntent(), () => terminal), (error) => {
    assert.equal((error as { code?: unknown }).code, 'context_unavailable');
    return true;
  });
  assert.equal(auditCount(), before);
});

test('requires exact synchronous host clock and context sources', () => {
  const before = auditCount();
  const readHostContext = () => context();
  for (const sources of [null, {}, { readHostContext }, { now: () => TIMESTAMP },
    { now: () => TIMESTAMP, readHostContext, extra: true },
    { now: async () => TIMESTAMP, readHostContext },
    { now: new Proxy(() => TIMESTAMP, {}), readHostContext },
    { now: () => TIMESTAMP, readHostContext: async () => context() }]) {
    assert.throws(() => createPortableSupervisorSemanticAuditPortV1(sources), (error) => {
      assert.equal((error as { code?: unknown }).code, 'audit_unavailable');
      return true;
    });
  }
  assert.equal(auditCount(), before);
});

test('samples context and host clock on both sides of the single decision', () => {
  const events: string[] = [];
  let contextReads = 0;
  let clockReads = 0;
  const commit = createPortableSupervisorSemanticAuditPortV1({
    now: () => { events.push(`clock:${clockReads}`); return TIMESTAMP + Math.min(clockReads++, 1); },
    readHostContext: () => { events.push(`context:${contextReads}`); contextReads += 1; return context(); },
  });
  const terminal = allowedAudit();

  assert.equal(commit(allowedIntent(), () => { events.push('decision'); return terminal; }), terminal);
  assert.deepEqual(events, ['context:0', 'clock:0', 'decision', 'context:1', 'clock:1']);
  assert.deepEqual([contextReads, clockReads], [2, 2]);
});

test('rolls back when callback reentry revokes the host authority', () => {
  const before = auditCount();
  let current = context();
  let decisions = 0;
  const commit = port({ readHostContext: () => current });

  assert.throws(() => commit(allowedIntent(), () => {
    decisions += 1;
    current = context({ revocationGeneration: 3 });
    return allowedAudit();
  }), (error) => (error as { code?: unknown }).code === 'context_unavailable');
  assert.equal(decisions, 1);
  assert.equal(auditCount(), before);
});

test('rolls back when callback reentry advances the selection epoch', () => {
  const before = auditCount();
  let current = context();
  let decisions = 0;
  const commit = port({ readHostContext: () => current });

  assert.throws(() => commit(allowedIntent(), () => {
    decisions += 1;
    current = context({ selectionEpoch: 12 });
    return allowedAudit();
  }), (error) => (error as { code?: unknown }).code === 'context_unavailable');
  assert.equal(decisions, 1);
  assert.equal(auditCount(), before);
});

test('rejects every stable authority field changing across the decision', () => {
  const before = auditCount();
  const changes: Record<string, unknown>[] = [
    { userRef: `user.${'c'.repeat(64)}` }, { parentRef: `parent.${'d'.repeat(64)}` },
    { purposeCode: 'other' }, { patientId: 'synthetic-patient-other' },
    { ambulatoryId: 'synthetic-ambulatory-other' }, { generation: 8 },
    { restartGeneration: 2 }, { parentGeneration: 4 }, { policyGeneration: 6 },
    { expiresAt: TIMESTAMP + 61_000 },
  ];
  for (const change of changes) {
    let reads = 0;
    const commit = port({ readHostContext: () => reads++ === 0 ? context() : context(change) });
    let decisions = 0;
    assert.throws(() => commit(allowedIntent(), () => { decisions += 1; return allowedAudit(); }), (error) =>
      (error as { code?: unknown }).code === 'context_unavailable');
    assert.equal(decisions, 1);
  }
  assert.equal(auditCount(), before);
});

test('accepts a fresh monotonic bootstrap window from the same authority', () => {
  let reads = 0;
  const commit = port({ readHostContext: () => context({
    bootstrapExpiresAt: TIMESTAMP + 30_000 + Math.min(reads++, 1),
  }) });
  const terminal = allowedAudit();
  assert.equal(commit(allowedIntent(), () => terminal), terminal);
});

test('rejects a regressed bootstrap window after the decision', () => {
  const before = auditCount();
  let reads = 0;
  const commit = port({ readHostContext: () => context({
    bootstrapExpiresAt: TIMESTAMP + (reads++ === 0 ? 30_000 : 29_999),
  }) });
  let decisions = 0;

  assert.throws(() => commit(allowedIntent(), () => { decisions += 1; return allowedAudit(); }), (error) =>
    (error as { code?: unknown }).code === 'context_unavailable');
  assert.equal(decisions, 1);
  assert.equal(auditCount(), before);
});

test('rejects a terminal timestamp before the pre-commit host clock', () => {
  const before = auditCount();
  const commit = port({ now: (() => { const samples = [TIMESTAMP, TIMESTAMP + 10];
    return () => samples.shift() ?? TIMESTAMP + 10; })() });
  let decisions = 0;

  assert.throws(() => commit(allowedIntent(), () => {
    decisions += 1; return allowedAudit({ timestamp: TIMESTAMP - 1 });
  }), (error) => (error as { code?: unknown }).code === 'context_unavailable');
  assert.equal(decisions, 1);
  assert.equal(auditCount(), before);
});

test('rejects a terminal timestamp after the post-commit host clock', () => {
  const before = auditCount();
  const commit = port({ now: (() => { const samples = [TIMESTAMP, TIMESTAMP + 10];
    return () => samples.shift() ?? TIMESTAMP + 10; })() });
  let decisions = 0;

  assert.throws(() => commit(allowedIntent(), () => {
    decisions += 1; return allowedAudit({ timestamp: TIMESTAMP + 11 });
  }), (error) => (error as { code?: unknown }).code === 'context_unavailable');
  assert.equal(decisions, 1);
  assert.equal(auditCount(), before);
});

test('rejects a terminal timestamp at the half-open authority expiry', () => {
  const before = auditCount();
  const commit = port({
    now: (() => { const samples = [TIMESTAMP, TIMESTAMP + 10];
      return () => samples.shift() ?? TIMESTAMP + 10; })(),
    readHostContext: () => context({ expiresAt: TIMESTAMP + 10, bootstrapExpiresAt: TIMESTAMP + 9 }),
  });
  let decisions = 0;

  assert.throws(() => commit(allowedIntent(), () => {
    decisions += 1; return allowedAudit({ timestamp: TIMESTAMP + 10 });
  }), (error) => (error as { code?: unknown }).code === 'context_unavailable');
  assert.equal(decisions, 1);
  assert.equal(auditCount(), before);
});

test('rejects an expired bootstrap context before invoking the decision', () => {
  const before = auditCount();
  const commit = port({ readHostContext: () => context({ bootstrapExpiresAt: TIMESTAMP }) });
  let decisions = 0;

  assert.throws(() => commit(allowedIntent(), () => { decisions += 1; return allowedAudit(); }), (error) =>
    (error as { code?: unknown }).code === 'context_unavailable');
  assert.equal(decisions, 0);
  assert.equal(auditCount(), before);
});

test('rejects host clock rollback after invoking the decision once', () => {
  const before = auditCount();
  const samples = [TIMESTAMP + 1, TIMESTAMP];
  const commit = port({ now: () => samples.shift() ?? TIMESTAMP });
  let decisions = 0;

  assert.throws(() => commit(allowedIntent(), () => {
    decisions += 1; return allowedAudit({ timestamp: TIMESTAMP + 1 });
  }), (error) => (error as { code?: unknown }).code === 'audit_unavailable');
  assert.equal(decisions, 1);
  assert.equal(auditCount(), before);
});

test('rejects a throwing host clock before invoking the decision', () => {
  const before = auditCount();
  const failure = new Error('synthetic host clock failure');
  const commit = port({ now: () => { throw failure; } });
  let decisions = 0;

  assert.throws(() => commit(allowedIntent(), () => { decisions += 1; return allowedAudit(); }), (error) =>
    (error as { code?: unknown }).code === 'audit_unavailable');
  assert.equal(decisions, 0);
  assert.equal(auditCount(), before);
});

test('rejects a throwing host clock after invoking the decision once', () => {
  const before = auditCount();
  let reads = 0;
  const failure = new Error('synthetic post-decision host clock failure');
  const commit = port({ now: () => { if (reads++ === 0) return TIMESTAMP; throw failure; } });
  let decisions = 0;

  assert.throws(() => commit(allowedIntent(), () => { decisions += 1; return allowedAudit(); }), (error) =>
    (error as { code?: unknown }).code === 'audit_unavailable');
  assert.equal(decisions, 1);
  assert.equal(auditCount(), before);
});

test('rejects Promise clocks before and after the single decision', () => {
  const before = auditCount();
  let decisions = 0;
  const beforeCommit = port({ now: () => Promise.resolve(TIMESTAMP) });
  assert.throws(() => beforeCommit(allowedIntent(), () => { decisions += 1; return allowedAudit(); }), (error) =>
    (error as { code?: unknown }).code === 'audit_unavailable');
  assert.equal(decisions, 0);

  let reads = 0;
  const afterCommit = port({ now: () => reads++ === 0 ? TIMESTAMP : Promise.resolve(TIMESTAMP + 1) });
  assert.throws(() => afterCommit(allowedIntent(), () => { decisions += 1; return allowedAudit(); }), (error) =>
    (error as { code?: unknown }).code === 'audit_unavailable');
  assert.equal(decisions, 1);
  assert.equal(auditCount(), before);
});

test('rolls back when the post-decision context rejects or returns a Promise', () => {
  const before = auditCount();
  for (const post of [() => { throw new Error('synthetic post-context failure'); },
    () => Promise.resolve(context())]) {
    let reads = 0;
    let decisions = 0;
    const commit = port({ readHostContext: () => reads++ === 0 ? context() : post() });
    assert.throws(() => commit(allowedIntent(), () => { decisions += 1; return allowedAudit(); }));
    assert.equal(decisions, 1);
  }
  assert.equal(auditCount(), before);
});

test('does not let a denied null binding bypass authority revocation', () => {
  const before = auditCount();
  let current = context();
  let decisions = 0;
  const commit = port({ readHostContext: () => current });

  assert.throws(() => commit(deniedIntent(), () => {
    decisions += 1;
    current = context({ revocationGeneration: 3 });
    return deniedAudit();
  }), (error) => (error as { code?: unknown }).code === 'context_unavailable');
  assert.equal(decisions, 1);
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
  const commit = port();
  let decisions = 0;
  try {
    assert.throws(() => commit(allowedIntent(), () => {
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
  const commit = port();
  let decisions = 0;
  try {
    assert.throws(() => commit(allowedIntent(), () => {
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
