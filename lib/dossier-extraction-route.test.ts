import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import Database from 'better-sqlite3';
import { createDossierPorts } from './document-dossier-ports';
import { acquireDossierGroup, buildDossierInventory, type DossierInputFile } from './document-dossier-session';

// Archivio sintetico migrato: la route non deve scrivervi nulla.
const root = process.cwd();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-dossier-route-'));
const databasePath = path.join(dataDir, 'medical.db');
const migrationDb = new Database(databasePath);
migrationDb.pragma('foreign_keys = OFF');
for (const file of fs.readdirSync(path.join(root, 'drizzle')).filter((name) => name.endsWith('.sql')).sort()) {
    migrationDb.exec(fs.readFileSync(path.join(root, 'drizzle', file), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gmu, ''));
}
migrationDb.close();
process.env.MEDIFLOW_DATA_DIR = dataDir;

const route = await import('../app/api/documents/dossier-extraction/route.ts');
const requireCurrent = createRequire(import.meta.url);
const serverAuth = requireCurrent('./security/server-auth') as { requireSession: () => Promise<unknown> };
const post = route.POST as (request: Request) => Promise<Response>;
const session = Object.freeze({ id: 'session.synthetic.dossier', userId: 'user.synthetic.dossier', username: ['synthetic', 'dossier'].join('.'), role: 'clinician',
    authChannel: 'web', createdAt: 1, expiresAt: Number.MAX_SAFE_INTEGER });
const RTF = Buffer.from('{\\rtf1\\ansi Referto sintetico dossier. Glucosio 110 mg/dL 70-99.}', 'utf8');

after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

async function invoke(request: Request, authenticated: unknown = session) {
    const original = serverAuth.requireSession;
    serverAuth.requireSession = async () => authenticated;
    try { return await post(request); } finally { serverAuth.requireSession = original; }
}

const local = (body: BodyInit | null, headers: Record<string, string> = {}) => new Request('http://localhost:3000/api/documents/dossier-extraction', {
    method: 'POST', body, headers: { host: 'localhost:3000', origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin', 'content-type': 'application/octet-stream', ...headers },
});

function rowCounts() {
    const db = new Database(databasePath, { readonly: true });
    try {
        return Object.fromEntries(['attachments', 'audit_events', 'patients', 'entries'].map((table) => [table, (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n]));
    } finally { db.close(); }
}

test('authenticates before reading the request and answers no-store 401', async () => {
    let reads = 0;
    const request = new Proxy({}, { get() { reads += 1; throw new Error('synthetic trap'); } }) as Request;
    const response = await invoke(request, null);
    assert.equal(response.status, 401);
    assert.equal(reads, 0);
});

test('refuses cross-origin, non-loopback, query-bearing and non-web requests before extraction', async () => {
    // Origini estranee costruite sull'URL locale: documentation range RFC 5737 e un nome non loopback.
    const foreign = (hostname: string) => { const url = new URL('http://localhost:3000/api/documents/dossier-extraction'); url.hostname = hostname; return url; };
    const remote = foreign(['192', '0', '2', '1'].join('.'));
    const cases = [
        local(RTF, { origin: foreign(['attacker', 'example'].join('.')).origin }),
        new Request(remote, { method: 'POST', body: RTF, headers: { origin: remote.origin, 'content-type': 'application/octet-stream' } }),
        new Request('http://localhost:3000/api/documents/dossier-extraction?patientId=x', { method: 'POST', body: RTF, headers: { host: 'localhost:3000', origin: 'http://localhost:3000', 'content-type': 'application/octet-stream' } }),
    ];
    for (const request of cases) assert.equal((await invoke(request)).status, 403);
    assert.equal((await invoke(local(RTF), { ...session, authChannel: 'native' })).status, 403);
    assert.equal((await invoke(local(RTF, { 'content-type': 'application/json' }))).status, 400);
});

test('extracts with the local AnyDoc worker and writes nothing', async () => {
    const before = rowCounts();
    const response = await invoke(local(RTF));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json() as { status: string; markdown?: string; ocr?: unknown };
    assert.equal(body.status, 'extracted');
    assert.match(body.markdown!, /Glucosio 110 mg\/dL/u);
    assert.equal(body.ocr, null);
    assert.deepEqual(rowCounts(), before);
});

test('an unsupported source is a declared failure, not text', async () => {
    const response = await invoke(local(Buffer.from([0, 1, 2, 3, 4, 5])));
    assert.equal(response.status, 200);
    const body = await response.json() as { status: string; detail?: string; markdown?: string };
    assert.equal(body.status, 'failed');
    assert.equal(typeof body.detail, 'string');
    assert.equal(body.markdown, undefined);
});

test('D05: TXT is refused at selection through the real import producer; RTF still reaches the real route without writes', async () => {
    const before = rowCounts();
    const txt = fs.readFileSync(path.join(root, 'lib/domain/documents/fixtures/dossier-source-f09.txt'));
    const direct = await invoke(local(txt));
    assert.deepEqual(await direct.json(), { status: 'failed', detail: 'unsupported_format' });
    const requests: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
        assert.equal(input, '/api/documents/dossier-extraction');
        requests.push(String(input));
        return invoke(local(init!.body!));
    };
    const inputFile = (name: string, type: string, bytes: Uint8Array): DossierInputFile => ({
        name, type, size: bytes.byteLength, relativePath: `Sintetico/${name}`, lastModified: 0,
        read: async () => new Uint8Array(bytes),
    });
    const ports = { ...createDossierPorts(), exemptionCodes: async () => new Set<string>(),
        listPatients: async () => [{ id: 'synthetic-patient', firstName: 'Ada', lastName: 'Sintetica', taxCode: '', diagnoses: [], exemptions: [] }] };
    const live = { signal: new AbortController().signal, isCurrent: () => true };
    try {
        const [group] = await buildDossierInventory(ports, [
            inputFile('fonte.txt', 'text/plain', txt),
            inputFile('fonte-senza-estensione', 'text/plain; charset=utf-8', Buffer.concat([txt, Buffer.from('\n')])),
            inputFile('lettera.rtf', 'application/rtf', RTF),
        ], live);
        const source = group.sources[0];
        assert.equal(source.status, 'unsupported_format', 'TXT must be refused before extraction, not accepted and failed later');
        assert.equal(source.classification.extractable, false);
        assert.match(source.classification.reason, /TXT non ammesso.*PDF.*immagine.*Office/u);
        assert.deepEqual(source.extraction, { state: 'not_extracted', reason: 'text' });
        assert.equal(source.text, null);
        assert.deepEqual(source.facts, []);
        assert.equal(group.sources[1].status, 'unsupported_format');
        assert.equal(group.sources[1].classification.extractable, false);
        assert.equal(group.sources[2].status, 'ready');
        assert.equal(group.sources[2].extraction.state, 'extracted');
        assert.match(group.sources[2].text!, /Glucosio 110 mg\/dL/u);
        assert.equal(requests.length, 1, 'only the supported RTF reaches the real route');
        const rejectedOnly = { ...group, sources: [source] };
        const acquired = await acquireDossierGroup(ports, { group: rejectedOnly, patientId: 'synthetic-patient', confirmed: true, ...live });
        assert.deepEqual(acquired, [{ key: source.key, status: 'skipped', reason: 'unsupported_format' }]);
        assert.deepEqual(rowCounts(), before);
    } finally { globalThis.fetch = originalFetch; }
});
