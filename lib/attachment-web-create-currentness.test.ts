/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-web-attachment-create-'));
const dbPath = path.join(dataDir, 'medical.db');
process.env.MEDIFLOW_DATA_DIR = dataDir;

const migrationDb = new Database(dbPath);
try {
    migrationDb.pragma('foreign_keys = OFF');
    for (const file of fs.readdirSync(path.join(root, 'drizzle')).filter((name) => name.endsWith('.sql')).sort()) {
        migrationDb.exec(fs.readFileSync(path.join(root, 'drizzle', file), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gmu, ''));
    }
} finally {
    migrationDb.close();
}

const { createWebAttachment } = await import('../app/api/attachments/route.ts');

const patientId = 'patient.synthetic.currentness';
const sessionUsername = ['synthetic', 'web'].join('.');
const session = {
    id: 'session.synthetic', userId: 'user.synthetic', username: sessionUsername, role: 'admin',
    authChannel: 'web', createdAt: 1, expiresAt: Number.MAX_SAFE_INTEGER,
} as const;
const sourceRef = 'a'.repeat(64);

function reset(): void {
    const db = new Database(dbPath);
    try {
        db.exec('DELETE FROM attachments; DELETE FROM patients;');
        db.prepare('INSERT INTO patients (id, first_name, last_name, tax_code) VALUES (?, ?, ?, ?)')
            .run(patientId, 'Ada', 'Synthetic', 'SYNTHETIC00000000');
    } finally {
        db.close();
    }
}

function rows(): Array<Record<string, unknown>> {
    const db = new Database(dbPath, { readonly: true });
    try {
        return db.prepare('SELECT id, patient_id, document_source_ref, document_revision, document_freshness_epoch FROM attachments ORDER BY id').all() as Array<Record<string, unknown>>;
    } finally {
        db.close();
    }
}

function request(payload: Record<string, unknown>): Request {
    return new Request('http://localhost/api/attachments', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    });
}

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        patientId,
        name: 'synthetic.pdf',
        type: 'application/pdf',
        size: 1,
        path: 'attachments/synthetic.pdf',
        ...overrides,
    };
}

function initial(ref = sourceRef): { sourceRef: string; revision: 1; freshnessEpoch: 1 } {
    return { sourceRef: ref, revision: 1, freshnessEpoch: 1 };
}

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('web creation mints exactly once after validation and persists the exact initial host tuple', async () => {
    reset();
    let mints = 0;
    const response = await createWebAttachment(request(payload({ id: 'attachment.synthetic.currentness' })), session, () => {
        mints += 1;
        return initial();
    });

    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { id: 'attachment.synthetic.currentness' });
    assert.equal(mints, 1);
    assert.deepEqual(rows(), [{
        id: 'attachment.synthetic.currentness',
        patient_id: patientId,
        document_source_ref: sourceRef,
        document_revision: 1,
        document_freshness_epoch: 1,
    }]);
});

test('web creation denies absent auth, invalid input, currentness injection, and missing patients before minting', async () => {
    const rejected = [
        { session: null, body: payload() },
        { session, body: payload({ size: -1 }) },
        { session, body: payload({ documentSourceRef: sourceRef }) },
        { session, body: payload({ documentRevision: 1 }) },
        { session, body: payload({ documentFreshnessEpoch: 1 }) },
        { session, body: payload({ patientId: 'patient.synthetic.missing' }) },
    ];
    for (const item of rejected) {
        reset();
        let mints = 0;
        const response = await createWebAttachment(request(item.body), item.session, () => {
            mints += 1;
            return initial();
        });
        assert.ok([400, 401, 404].includes(response.status));
        assert.equal(mints, 0);
        assert.deepEqual(rows(), []);
    }
});

test('web creation rejects hostile host tuples without invoking accessors or inserting', async () => {
    const accessor = {} as Record<string, unknown>;
    let getterReads = 0;
    for (const [key, value] of Object.entries(initial())) {
        Object.defineProperty(accessor, key, { enumerable: true, get() { getterReads += 1; return value; } });
    }
    const inherited = Object.create(initial());
    const nonEnumerable = initial(); Object.defineProperty(nonEnumerable, 'sourceRef', { enumerable: false, value: sourceRef });
    const custom = Object.assign(Object.create({}), initial());
    const symbol = { ...initial(), [Symbol('synthetic')]: true };
    const proxy = new Proxy(initial(), {});
    const hostile: unknown[] = [
        null, accessor, inherited, nonEnumerable, custom, symbol, proxy,
        initial(''), { ...initial(), revision: Number.MAX_SAFE_INTEGER + 1 }, { ...initial(), freshnessEpoch: 2 },
    ];
    for (const value of hostile) {
        reset();
        const response = await createWebAttachment(request(payload()), session, () => value);
        assert.equal(response.status, 500);
        assert.deepEqual(await response.json(), { error: 'Create Failed' });
        assert.deepEqual(rows(), []);
    }
    assert.equal(getterReads, 0);
});

test('web creation keeps collision and storage failures atomic, and concurrent host refs unique', async () => {
    reset();
    const first = await createWebAttachment(request(payload({ id: 'attachment.synthetic.first' })), session, () => initial());
    assert.equal(first.status, 201);
    const collision = await createWebAttachment(request(payload({ id: 'attachment.synthetic.second' })), session, () => initial());
    assert.equal(collision.status, 500);
    assert.deepEqual(await collision.json(), { error: 'Create Failed' });
    const storage = await createWebAttachment(request(payload({ id: 'attachment.synthetic.third' })), session, () => { throw new Error('synthetic storage'); });
    assert.equal(storage.status, 500);
    assert.deepEqual(await storage.json(), { error: 'Create Failed' });
    assert.equal(rows().length, 1);

    reset();
    const responses = await Promise.all(Array.from({ length: 8 }, (_, index) =>
        createWebAttachment(request(payload({ id: `attachment.synthetic.concurrent.${index}` })), session),
    ));
    assert.deepEqual(responses.map((response) => response.status), Array(8).fill(201));
    const created = rows();
    assert.equal(created.length, 8);
    assert.equal(new Set(created.map((row) => row.document_source_ref)).size, 8);
    assert.ok(created.every((row) => row.document_revision === 1 && row.document_freshness_epoch === 1));
});
