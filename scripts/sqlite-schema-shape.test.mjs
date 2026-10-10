import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { schemaSnapshot, schemaDifferences, sqlTokens } from '../lib/sqlite-schema-shape.ts';

function shape(sql) {
  const db = new Database(':memory:');
  try { db.exec(sql); return schemaSnapshot(db); } finally { db.close(); }
}
const differs = (a, b) => schemaDifferences(shape(a), shape(b)).length > 0;

test('column position is irrelevant, PK ordinal and index order remain significant', () => {
  assert.equal(differs('CREATE TABLE t(id TEXT PRIMARY KEY NOT NULL, version INTEGER NOT NULL DEFAULT 1, value TEXT); CREATE INDEX ix ON t(value)',
    'CREATE TABLE t(id TEXT PRIMARY KEY NOT NULL, value TEXT, version INTEGER NOT NULL DEFAULT 1); CREATE INDEX ix ON t(value)'), false);
  assert.equal(differs('CREATE TABLE t(a,b,PRIMARY KEY(a,b))', 'CREATE TABLE t(a,b,PRIMARY KEY(b,a))'), true);
  assert.equal(differs('CREATE TABLE t(a,b);CREATE INDEX ix ON t(a,b)', 'CREATE TABLE t(a,b);CREATE INDEX ix ON t(b,a)'), true);
});

test('composite FK grouping cannot collapse to equivalent independent rows', () => {
  const parent = 'CREATE TABLE p(a,b,c,d,UNIQUE(a,b),UNIQUE(c,d),UNIQUE(a,d),UNIQUE(c,b));';
  const a = shape(parent + 'CREATE TABLE t(w,x,y,z,FOREIGN KEY(w,x) REFERENCES p(a,b),FOREIGN KEY(y,z) REFERENCES p(c,d))');
  const b = shape(parent + 'CREATE TABLE t(w,x,y,z,FOREIGN KEY(w,z) REFERENCES p(a,d),FOREIGN KEY(y,x) REFERENCES p(c,b))');
  assert.notDeepEqual(a.t.foreignKeys, b.t.foreignKeys);
});

test('CHECK literals, collation, generated expressions, conflict policy and table options survive', () => {
  for (const [a,b] of [
    ["CREATE TABLE t(a CHECK(a <> 'a b'))", "CREATE TABLE t(a CHECK(a <> 'a  b'))"],
    ['CREATE TABLE t(a TEXT COLLATE NOCASE)', 'CREATE TABLE t(a TEXT COLLATE BINARY)'],
    ['CREATE TABLE t(a,b AS (a+1))', 'CREATE TABLE t(a,b AS (a+2))'],
    ['CREATE TABLE t(a UNIQUE ON CONFLICT IGNORE)', 'CREATE TABLE t(a UNIQUE ON CONFLICT REPLACE)'],
    ['CREATE TABLE t(a INTEGER)', 'CREATE TABLE t(a INTEGER) STRICT'],
    ['CREATE TABLE t(a PRIMARY KEY)', 'CREATE TABLE t(a PRIMARY KEY) WITHOUT ROWID'],
  ]) assert.equal(differs(a,b), true, a);
});

test('index predicates/expressions and audit trigger bodies are compared', () => {
  const base = 'CREATE TABLE t(a,b);';
  assert.equal(differs(base+'CREATE INDEX ix ON t(a) WHERE b=1', base+'CREATE INDEX ix ON t(a) WHERE b=2'), true);
  assert.equal(differs(base+'CREATE INDEX ix ON t(a+1)', base+'CREATE INDEX ix ON t(a+2)'), true);
  assert.equal(differs(base+"CREATE TRIGGER audit BEFORE UPDATE ON t BEGIN SELECT RAISE(ABORT,'blocked'); END",
    base+"CREATE TRIGGER audit BEFORE UPDATE ON t BEGIN SELECT RAISE(ABORT,'allowed'); END"), true);
});

test('tokens discard only whitespace/comments outside quoted contents', () => {
  assert.deepEqual(sqlTokens('a /* note */ + b'), sqlTokens('a+b'));
  assert.notDeepEqual(sqlTokens("'a b'"), sqlTokens("'a  b'"));
  assert.notDeepEqual(sqlTokens('"unknown A"'), sqlTokens('"unknown a"'));
  assert.deepEqual(sqlTokens("'/* literal */'"), ["'/* literal */'"]);
});

test('fresh SISS version column and ALTER-added version have identical shape', () => {
  const columns = `id TEXT PRIMARY KEY NOT NULL, patient_id TEXT NOT NULL, action TEXT NOT NULL,
    module_label TEXT NOT NULL, reason TEXT, started_at INTEGER NOT NULL, completed_at INTEGER,
    outcome TEXT NOT NULL DEFAULT 'started', next_action TEXT, notes TEXT, correlation_id TEXT,
    created_at INTEGER DEFAULT (unixepoch()), updated_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (patient_id) REFERENCES patients(id)`;
  const parent = 'CREATE TABLE patients(id TEXT PRIMARY KEY);';
  const indexes = 'CREATE INDEX siss_patient ON siss_handoff_events(patient_id); CREATE INDEX siss_started ON siss_handoff_events(started_at DESC); CREATE INDEX siss_outcome ON siss_handoff_events(outcome);';
  const fresh = parent + `CREATE TABLE siss_handoff_events(${columns.replace('patient_id TEXT', 'version INTEGER NOT NULL DEFAULT 1, patient_id TEXT')});` + indexes;
  const upgraded = parent + `CREATE TABLE siss_handoff_events(${columns}); ALTER TABLE siss_handoff_events ADD COLUMN version INTEGER NOT NULL DEFAULT 1;` + indexes;
  assert.deepEqual(schemaDifferences(shape(fresh), shape(upgraded)), []);
});

test('unknown quoted SQL and deferred foreign-key clauses retain their identity', () => {
  assert.equal(differs('CREATE TABLE t(a, "other A", "other B", CHECK(a <> "other A"))', 'CREATE TABLE t(a, "other A", "other B", CHECK(a <> "other B"))'), true);
  const parent = 'CREATE TABLE p(id PRIMARY KEY);';
  assert.equal(differs(parent+'CREATE TABLE t(a REFERENCES p(id) DEFERRABLE INITIALLY DEFERRED)', parent+'CREATE TABLE t(a REFERENCES p(id) NOT DEFERRABLE)'), true);
});

test('Drizzle quoting, type spelling and explicit default FK actions are equivalent', () => {
  const plain = `CREATE TABLE observations(id TEXT PRIMARY KEY NOT NULL, patient_id TEXT NOT NULL,
    source TEXT DEFAULT 'manual', linked TEXT REFERENCES items(id) ON DELETE SET NULL,
    FOREIGN KEY(patient_id) REFERENCES patients(id));
    CREATE INDEX observations_patient_idx ON observations(patient_id);`;
  const drizzle = "CREATE TABLE `observations` (`id` text PRIMARY KEY NOT NULL, `patient_id` text NOT NULL, `source` text DEFAULT 'manual', `linked` text REFERENCES `items`(`id`) ON DELETE SET NULL, FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action); CREATE INDEX `observations_patient_idx` ON `observations`(`patient_id`);";
  assert.equal(differs(plain, drizzle), false);
  assert.equal(differs(plain, drizzle.replace("'manual'", "'MANUAL'")), true);
  assert.equal(differs(plain, drizzle.replace('ON DELETE no action', 'ON DELETE CASCADE')), true);
  assert.equal(differs(plain, drizzle.replace('ON DELETE no action', 'ON DELETE RESTRICT')), true);
  assert.equal(differs(plain, drizzle.replace('`patients`(`id`)', '`patients`(`other_id`)')), true);
});

test('bounded full-schema spellings preserve CHECK, trigger body, key direction and conflict semantics', () => {
  const plain = `CREATE TABLE t(actor_ref TEXT REFERENCES users(id) CHECK(length(actor_ref)>0), status TEXT,
    version INTEGER NOT NULL DEFAULT 1, CONSTRAINT status_check CHECK(status <> 'OFF'), PRIMARY KEY(actor_ref));
    CREATE INDEX ix ON t(actor_ref DESC);
    CREATE TRIGGER no_update BEFORE UPDATE ON t BEGIN SELECT RAISE(ABORT,'append-only'); END;`;
  const quoted = "CREATE TABLE `t` (`actor_ref` text REFERENCES `users`(`id`) CHECK(length(`actor_ref`)>0), `status` text, `version` integer DEFAULT 1 NOT NULL, CONSTRAINT `status_check` CHECK(`status` <> 'OFF'), PRIMARY KEY(`actor_ref`)); CREATE INDEX `ix` ON `t`(`actor_ref` DESC); CREATE TRIGGER `no_update` BEFORE UPDATE ON `t` BEGIN SELECT RAISE(ABORT,'append-only'); END;";
  assert.equal(differs(plain, quoted), false);
  for (const changed of [quoted.replace("'OFF'", "'off'"), quoted.replace('>0', '>1'), quoted.replace('DESC', 'ASC'),
    quoted.replace('ABORT', 'FAIL'), quoted.replace("'append-only'", "'append only'"), quoted.replace('BEFORE UPDATE','BEFORE DELETE'),
    quoted.replace('DEFAULT 1 NOT NULL', 'DEFAULT 1 NOT NULL ON CONFLICT IGNORE')]) assert.equal(differs(plain, changed), true);
});
