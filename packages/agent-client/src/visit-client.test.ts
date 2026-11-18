import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { agentCassetteFixture } from '../../../lib/test-fixtures/agent-cassette';
import { readAgentRegistration, saveAgentCredential, saveAgentRegistration } from './credentials';
import { agentRequest, prepareAgentVisit, prepareAndDepositAgentVisit, resumeAgentVisit, AgentClientError } from './visit-client';
import { parseAgentCommand, agentCommandFailure } from './commands';
import { agentBytes, openAgentItem } from '../../../lib/agent-cassette-crypto';
import { decryptData } from '../../../lib/security/security';
import { MANDATE_MAX_DURATION_MS } from '../../../lib/agent-mandate-contract';

const cf = 'RSSMRA80A01H501U', sentinel = 'SYNTHETIC_CLI_VISIT_ONLY_6742';
async function fixture() {
    const f = await agentCassetteFixture(), root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-agent-command-'));
    const files = path.join(root, 'input'), credentials = path.join(root, 'private'); fs.mkdirSync(files); fs.mkdirSync(credentials, { mode: 0o700 });
    const pdf = Buffer.from('%PDF-1.4\nCodice fiscale paziente: ' + cf + '\n' + sentinel);
    fs.writeFileSync(path.join(files, 'nota-visita.pdf'), pdf);
    const extraction = { schema: 'mediflow.dossier_prepared_extraction.v1', preparedAt: '2026-11-17T08:00:00Z', preparedBy: 'Synthetic fixture', sources: [{
        sha256: createHash('sha256').update(pdf).digest('hex'), fileName: 'nota-visita.pdf', patient: { taxCode: cf }, documentDate: '2026-11-17', documentType: 'visita_specialistica',
        facts: [{ kind: 'document_entry', values: { text: sentinel, date: '2026-11-17' }, quote: 'Passo sintetico della nota' },
            { kind: 'therapy', values: { drugName: 'Principio inventato', dosage: '5 mg sintetici', status: 'active' }, quote: 'Principio inventato 5 mg sintetici' },
            { kind: 'diagnosis', values: { description: 'Condizione inventata' }, quote: 'Condizione inventata per prova' },
            { kind: 'service_prescription', values: { serviceName: 'Prestazione inventata' }, quote: 'Prestazione inventata per prova' },
            { kind: 'exemption', values: { code: 'ZZ01' }, quote: 'Codice sintetico ZZ01' }], coverage: { complete: false, unreadablePages: [], pages: 1, note: 'Solo fixture' } }] };
    const transcription = path.join(files, 'trascrizione.txt'); fs.writeFileSync(transcription, 'Trascrizione sintetica della visita ' + sentinel);
    const file = path.join(files, 'estrazione-preparata.json'); fs.writeFileSync(file, JSON.stringify(extraction));
    const bodies: string[] = [], events: string[] = [];
    let afterNote: (() => void) | undefined;
    let drop = false, denied = false, operations = f.principal.operations, pulls = 0;
    const longToken = 'mfr_' + 'X'.repeat(43);
    const server = http.createServer(async (request, response) => {
        if (request.url?.startsWith('/api/agent/v1/pairings')) {
            try {
                if (request.method === 'POST') {
                    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk);
                    const body = JSON.parse(Buffer.concat(chunks).toString());
                    const result = f.pairings.request(body.name, body.operations);
                    response.writeHead(201, { 'Content-Type': 'application/json' }).end(JSON.stringify({ receipt: result.request, pairingCredential: { claim: result.claim } }));
                } else {
                    const id = new URL(request.url, 'http://127.0.0.1').searchParams.get('requestId')!;
                    const claim = request.headers.authorization?.slice('Pairing '.length) ?? '';
                    const result = f.pairings.poll(id, claim);
                    response.writeHead(result.receipt.status === 'pending' ? 202 : 200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
                }
            } catch { response.writeHead(401, { 'Content-Type': 'application/json' }).end('{}'); }
            return;
        }
        if (request.url === '/api/agent/v1/mandate' && request.headers.authorization === 'Bearer ' + longToken) {
            pulls++;
            const issuedAt = Date.now();
            response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
                receipt: { agentRef: f.principal.agentRef, mandateRef: f.mandate.id, issuedAt, expiresAt: issuedAt + MANDATE_MAX_DURATION_MS },
                credential: { token: f.token },
            }));
            return;
        }
        if (request.headers.authorization !== 'Bearer ' + f.token) { response.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ secret: f.token })); return; }
        if (request.url === '/api/agent/v1/context') { response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ...f.principal, operations, actorRef: undefined, wrappedPrivateKey: undefined })); return; }
        const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk);
        const raw = Buffer.concat(chunks).toString(); bodies.push(raw);
        const body = JSON.parse(raw); events.push(body.operation);
        if (denied) { response.writeHead(403, { 'Content-Type': 'application/json' }).end(JSON.stringify({ secret: f.token, text: sentinel })); return; }
        try {
            const receipt = f.run(() => body.operation === 'visita.apri' ? f.store.open(f.principal, body.visitId, body.anchor)
                : body.operation === 'visita.chiudi' ? f.store.close(f.principal, body.visitId, body.expectedRevision)
                    : f.store.add(f.principal, body.visitId, body.expectedRevision, body.item));
            if (body.operation === 'visita.nota') afterNote?.();
            if (drop && body.operation === 'visita.nota') { drop = false; response.destroy(); return; }
            response.writeHead(201, { 'Content-Type': 'application/json' }).end(JSON.stringify({ receipt }));
        } catch { response.writeHead(409, { 'Content-Type': 'application/json' }).end('{}'); }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
    saveAgentCredential(credentials, { agentRef: f.principal.agentRef, mandateRef: f.mandate.id, token: f.token, expiresAt: f.mandate.expiresAt, origin });
    return { ...f, longToken, pulls: () => pulls,
        installRegistration: () => saveAgentRegistration(credentials, { agentRef: f.principal.agentRef, origin, token: longToken }),
        root, files, credentials, file, transcription, extraction, bodies, events, origin, afterNote: (action: () => void) => { afterNote = action; }, drop: () => { drop = true; }, deny: () => { denied = true; }, scope: () => { operations = ['visita.apri', 'visita.nota', 'visita.chiudi']; },
        async cleanup() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); f.database.close(); fs.rmSync(root, { recursive: true, force: true }); } };
}
async function cli(args: string[], data: string, environment: Partial<NodeJS.ProcessEnv> = {}, input?: string) {
    const child = spawn(process.execPath, ['scripts/run-strip-types.mjs', 'packages/agent-client/src/cli.ts', ...args], {
        env: { ...process.env, ...environment, MEDIFLOW_DATA_DIR: path.join(data, 'unused-clinical') }, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    if (input !== undefined) { assert.ok(child.stdin); child.stdin.end(input); }
    assert.ok(child.stdout); assert.ok(child.stderr);
    let stdout = '', stderr = ''; child.stdout.on('data', bytes => { stdout += bytes; }); child.stderr.on('data', bytes => { stderr += bytes; });
    const timeout = setTimeout(() => child.kill('SIGTERM'), 15000);
    const code = await new Promise<number | null>(resolve => child.once('close', resolve)); clearTimeout(timeout);
    return { code, stdout, stderr };
}
test('the real CLI reuses the kit extraction and deposits separate encrypted PDF, note and structured proposals without a cookie', async () => {
    const f = await fixture();
    try {
        const result = await cli(['deposita', '--credenziali', f.credentials, '--agente', f.principal.agentRef, '--estrazione', f.file, '--cf', cf, '--visita', randomUUID(), '--trascrizione', f.transcription], f.root);
        assert.equal(result.code, 0, result.stderr); const receipt = JSON.parse(result.stdout);
        assert.equal(receipt.status, 'closed'); assert.equal(receipt.itemCount, 7); assert.equal(f.rows().length, 1);
        assert.ok(!JSON.stringify(result).includes(f.token)); assert.ok(!JSON.stringify(result).includes(sentinel)); assert.ok(!JSON.stringify(result).includes(cf));
        assert.ok(f.bodies.every(body => !body.includes(sentinel) && !body.includes(cf) && !body.includes('Principio inventato')));
        const row = f.rows()[0], wrapped = row.wrappedPrivateKey.split(':');
        const privateBytes = agentBytes(await decryptData(wrapped[2], wrapped[1], f.masterKey) as string);
        try {
            const key = await crypto.subtle.importKey('pkcs8', privateBytes, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
            const items = JSON.parse(row.itemsCiphertext);
            assert.deepEqual(items.map((item: { kind: string }) => item.kind), ['pdf', 'note', 'therapy', 'diagnosis', 'service', 'exemption', 'transcription']);
            const opened = JSON.parse(new TextDecoder().decode(await openAgentItem(key, { mandateRef: row.mandateRef, visitId: row.id, itemId: items[2].id, kind: 'therapy' }, items[2].envelope)));
            assert.deepEqual(opened.values, f.extraction.sources[0].facts[1].values);
        } finally { privateBytes.fill(0); }
        const saved = fs.readFileSync(path.join(f.credentials, 'visit-' + receipt.visitId + '.json'), 'utf8');
        assert.ok(!saved.includes(sentinel)); assert.ok(!saved.includes(cf)); assert.ok(!saved.includes(f.token));
        if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(f.credentials, 'visit-' + receipt.visitId + '.json')).mode & 0o777, 0o600);
    } finally { await f.cleanup(); }
});
test('lost response after a committed element resumes the immutable encrypted plan without duplicate elements or audit', async () => {
    const f = await fixture();
    try {
        f.drop(); let visitId: string | undefined;
        await assert.rejects(prepareAndDepositAgentVisit(f.credentials, f.principal.agentRef, f.file, cf), error => {
            assert.ok(error instanceof AgentClientError); visitId = error.visitId; return error.code === 'AGENT_HTTP_UNAVAILABLE';
        });
        assert.ok(visitId); const snapshot = fs.readFileSync(path.join(f.credentials, 'visit-' + visitId + '.json'));
        fs.writeFileSync(path.join(f.files, 'nota-visita.pdf'), 'changed after the first attempt');
        const receipt = await resumeAgentVisit(f.credentials, f.principal.agentRef, visitId); assert.equal(receipt.status, 'closed'); assert.equal(receipt.itemCount, 6);
        const count = f.database.prepare('SELECT count(*) FROM audit_events').pluck().get();
        assert.deepEqual(await resumeAgentVisit(f.credentials, f.principal.agentRef, visitId), receipt);
        assert.equal(f.database.prepare('SELECT count(*) FROM audit_events').pluck().get(), count);
        assert.deepEqual(fs.readFileSync(path.join(f.credentials, 'visit-' + visitId + '.json')), snapshot);
        assert.equal(f.events.filter(value => value === 'visita.nota').length, 2);
    } finally { await f.cleanup(); }
});
for (const mutation of ['hash', 'foreign-patient', 'unsupported-fact', 'symlink', 'scope'] as const) test(`${mutation} is refused before the first deposit POST`, async () => {
    const f = await fixture();
    try {
        if (mutation === 'hash') fs.writeFileSync(path.join(f.files, 'nota-visita.pdf'), '%PDF-1.4 changed');
        if (mutation === 'foreign-patient') { f.extraction.sources[0].patient.taxCode = 'BNCGNN80A01F205U'; fs.writeFileSync(f.file, JSON.stringify(f.extraction)); }
        if (mutation === 'unsupported-fact') { f.extraction.sources[0].facts[1].kind = 'prosthetic'; fs.writeFileSync(f.file, JSON.stringify(f.extraction)); }
        if (mutation === 'symlink') { fs.renameSync(path.join(f.files, 'nota-visita.pdf'), path.join(f.files, 'original.pdf')); fs.symlinkSync('original.pdf', path.join(f.files, 'nota-visita.pdf')); }
        if (mutation === 'scope') f.scope();
        await assert.rejects(prepareAndDepositAgentVisit(f.credentials, f.principal.agentRef, f.file, cf));
        assert.deepEqual(f.events, []); assert.equal(f.rows().length, 0);
        assert.ok(fs.readdirSync(f.credentials).every(name => !name.startsWith('visit-')));
    } finally { await f.cleanup(); }
});
test('HTTP denials cannot leak the bearer or clinical text through CLI errors', async () => {
    const f = await fixture();
    try {
        f.deny(); const result = await cli(['deposita', '--credenziali', f.credentials, '--agente', f.principal.agentRef, '--estrazione', f.file, '--cf', cf, '--visita', randomUUID()], f.root);
        assert.equal(result.code, 1); assert.equal(result.stdout, '');
        assert.ok(!result.stderr.includes(f.token)); assert.ok(!result.stderr.includes(sentinel));
        assert.equal(JSON.parse(result.stderr).status, 403); assert.equal(f.rows().length, 0);
    } finally { await f.cleanup(); }
});
test('foreign origins, paths and extra secret flags are rejected and failures contain only fixed fields', () => {
    for (const origin of ['https://127.0.0.1:1234', 'http://localhost:1234', 'http://example.invalid', 'http://127.0.0.1:1234/path', 'http://user:secret@127.0.0.1:1234']) assert.throws(() => agentRequest(origin, '/api/agent/v1/context'));
    assert.throws(() => parseAgentCommand(['deposita', '--agente', 'synthetic', '--pin', 'SYNTHETIC_SECRET']));
    assert.deepEqual(agentCommandFailure(new Error(sentinel)), { error: 'AGENT_INPUT_INVALID' });
});
test('preparation keeps each source hash and rejects a note converted from a structured fact', async () => {
    const f = await fixture();
    try {
        f.extraction.sources[0].fileName = 'other.pdf'; fs.renameSync(path.join(f.files, 'nota-visita.pdf'), path.join(f.files, 'other.pdf')); fs.writeFileSync(f.file, JSON.stringify(f.extraction));
        assert.throws(() => prepareAgentVisit(f.mandate.publicKey, f.principal.agentRef, f.mandate.id, f.file, cf), /AGENT_INPUT_INVALID/);
        assert.equal(f.rows().length, 0);
    } finally { await f.cleanup(); }
});

test('repeating the same explicit visit command reuses the original envelopes and rejects changed prepared input', async () => {
    const f = await fixture(), visitId = randomUUID();
    try {
        const first = await prepareAndDepositAgentVisit(f.credentials, f.principal.agentRef, f.file, cf, undefined, visitId);
        const bytes = fs.readFileSync(path.join(f.credentials, 'visit-' + visitId + '.json'));
        const audits = f.database.prepare('SELECT count(*) FROM audit_events').pluck().get();
        assert.deepEqual(await prepareAndDepositAgentVisit(f.credentials, f.principal.agentRef, f.file, cf, undefined, visitId), first);
        assert.deepEqual(fs.readFileSync(path.join(f.credentials, 'visit-' + visitId + '.json')), bytes);
        assert.equal(f.database.prepare('SELECT count(*) FROM audit_events').pluck().get(), audits);
        f.extraction.preparedAt = '2026-11-17T09:00:00Z'; fs.writeFileSync(f.file, JSON.stringify(f.extraction));
        await assert.rejects(prepareAndDepositAgentVisit(f.credentials, f.principal.agentRef, f.file, cf, undefined, visitId), /AGENT_STATE_INVALID/);
        assert.deepEqual(fs.readFileSync(path.join(f.credentials, 'visit-' + visitId + '.json')), bytes);
    } finally { await f.cleanup(); }
});

test('MCP stdio uses the same deposit contract and opens no clinical database, measured on the running process', async () => {
    const f = await fixture(), coverage = path.join(f.root, 'coverage'), loader = path.resolve('scripts/register-strip-types-loader.mjs');
    const child = spawn(process.execPath, ['--experimental-strip-types', '--import', loader, 'scripts/agent-visit-mcp-stdio.mjs', '--credenziali', f.credentials], {
        env: { ...process.env, NODE_V8_COVERAGE: coverage, MEDIFLOW_DATA_DIR: path.join(f.root, 'mcp-unused-data') }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
    const pending = new Map<number, (value: Record<string, unknown>) => void>();
    let buffer = '', stderr = '', sequence = 0; const output: string[] = [];
    child.stdout.on('data', chunk => {
        buffer += chunk.toString();
        for (;;) {
            const end = buffer.indexOf('\n'); if (end < 0) break;
            const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); if (!line) continue;
            output.push(line); const message = JSON.parse(line);
            pending.get(message.id)?.(message); pending.delete(message.id);
        }
    });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    const send = async (method: string, params: Record<string, unknown> = {}) => {
        const id = ++sequence;
        const response = new Promise<Record<string, unknown>>((resolve, reject) => {
            const timer = setTimeout(() => { pending.delete(id); reject(new Error('SYNTHETIC_MCP_RESPONSE_TIMEOUT')); }, 10000);
            pending.set(id, value => { clearTimeout(timer); resolve(value); });
        });
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params: { ...params, _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {},
            'io.modelcontextprotocol/clientInfo': { name: 'synthetic-visit-test', version: '1.0.0' },
        } } }) + '\n');
        return response;
    };
    const descriptors = async () => {
        const { execFile } = await import('node:child_process');
        return await new Promise<string>((resolve, reject) => execFile('lsof', ['-a', '-p', String(child.pid), '-Fn'], { encoding: 'utf8' }, (error, stdout) => error ? reject(error) : resolve(stdout)));
    };
    try {
        const listed = await send('tools/list');
        assert.ok(listed.result, JSON.stringify(listed));
        assert.deepEqual((listed.result as { tools: { name: string }[] }).tools.map(tool => tool.name).sort(),
            ['mediflow_collega', 'mediflow_completa_collegamento', 'mediflow_deposita_visita', 'mediflow_riprendi_visita', 'mediflow_ritira_mandato'].sort());
        assert.doesNotMatch(await descriptors(), /\.db(?:-wal|-shm)?(?:\n|$)/u);
        const cliResult = await cli(['deposita', '--credenziali', f.credentials, '--agente', f.principal.agentRef, '--estrazione', f.file, '--cf', cf, '--visita', randomUUID(), '--trascrizione', f.transcription], f.root);
        assert.equal(cliResult.code, 0, cliResult.stderr); const cliReceipt = JSON.parse(cliResult.stdout);
        f.installRegistration();
        const retrieved = await send('tools/call', { name: 'mediflow_ritira_mandato', arguments: { agentRef: f.principal.agentRef } });
        const pull = retrieved.result as { isError?: boolean; structuredContent: { mandateRef: string } };
        assert.notEqual(pull.isError, true, JSON.stringify(retrieved));
        assert.equal(pull.structuredContent.mandateRef, f.mandate.id);
        assert.equal(f.pulls(), 1);
        assert.ok(!JSON.stringify(retrieved).includes(f.longToken));
        const visitId = randomUUID();
        const called = await send('tools/call', { name: 'mediflow_deposita_visita', arguments: { agentRef: f.principal.agentRef, extraction: f.file, fiscalCode: cf, visitId, transcription: f.transcription } });
        const result = called.result as { isError?: boolean; structuredContent: { visitId: string; status: string; itemCount: number } };
        assert.notEqual(result.isError, true, JSON.stringify(called)); assert.equal(result.structuredContent.status, 'closed'); assert.equal(result.structuredContent.itemCount, 7);
        for (const key of ['status', 'revision', 'itemCount', 'modelProvider', 'allowsClinicalEgress', 'mandateRef', 'agentRef']) assert.equal(Reflect.get(result.structuredContent, key), cliReceipt[key]);
        for (const operation of ['visita.apri', 'visita.allega', 'visita.trascrizione', 'visita.proponi.terapia', 'visita.chiudi']) assert.ok(f.events.includes(operation));
        const replay = await send('tools/call', { name: 'mediflow_riprendi_visita', arguments: { agentRef: f.principal.agentRef, visitId } });
        assert.deepEqual((replay.result as { structuredContent: unknown }).structuredContent, result.structuredContent);
        assert.doesNotMatch(await descriptors(), /\.db(?:-wal|-shm)?(?:\n|$)/u);
        assert.ok(!JSON.stringify(output).includes(f.token)); assert.ok(!JSON.stringify(output).includes(sentinel)); assert.ok(!JSON.stringify(output).includes(cf));
        assert.ok(!stderr.includes(f.token)); assert.ok(!fs.existsSync(path.join(f.root, 'mcp-unused-data', 'medical.db')));
        child.stdin.end(); await closed;
        const loaded = fs.readdirSync(coverage).flatMap(file => JSON.parse(fs.readFileSync(path.join(coverage, file), 'utf8')).result as { url: string }[]);
        assert.ok(loaded.some(script => script.url.endsWith('/packages/agent-client/src/visit-client.ts')));
        assert.ok(!loaded.some(script => /better-sqlite3|\/lib\/(?:db-server|sqlite-schema-open)\./u.test(script.url)));
    } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await closed; await f.cleanup(); }
});

test('the file-descriptor oracle detects a real synthetic SQLite connection as its positive control', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-agent-fd-control-')), file = path.join(root, 'synthetic-control.db');
    const child = spawn(process.execPath, ['-e', "const Database=require('better-sqlite3');const db=new Database(process.argv[1]);db.exec('CREATE TABLE synthetic(id INTEGER)');process.stdout.write('READY\\n');setInterval(()=>{},1000);", file], { stdio: ['ignore', 'pipe', 'pipe'] });
    const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
    try {
        await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('SYNTHETIC_FD_CONTROL_TIMEOUT')), 5000); child.stdout.once('data', () => { clearTimeout(timer); resolve(); }); });
        const { execFileSync } = await import('node:child_process');
        assert.match(execFileSync('lsof', ['-a', '-p', String(child.pid), '-Fn'], { encoding: 'utf8' }), /synthetic-control\.db(?:\n|$)/u);
    } finally { child.kill('SIGTERM'); await closed; fs.rmSync(root, { recursive: true, force: true }); }
});

test('cancellation after one committed note leaves an open recoverable cassette and never sends close or structured proposals', async () => {
    const f = await fixture(), controller = new AbortController();
    try {
        f.afterNote(() => controller.abort());
        await assert.rejects(prepareAndDepositAgentVisit(f.credentials, f.principal.agentRef, f.file, cf, undefined, undefined, controller.signal), error => error instanceof AgentClientError && error.code === 'AGENT_CANCELLED');
        assert.equal(f.rows()[0].status, 'open');
        assert.deepEqual(JSON.parse(f.rows()[0].itemsCiphertext).map((item: { kind: string }) => item.kind), ['pdf', 'note']);
        assert.ok(!f.events.includes('visita.chiudi')); assert.ok(!f.events.includes('visita.proponi.terapia'));
    } finally { await f.cleanup(); }
});

test('CLI pairing prints only the comparison code and completes only after approval, retaining the secret in owner-only files', async () => {
    const f = await fixture();
    try {
        const requested = await cli(['collega', '--credenziali', f.credentials, '--origine', f.origin, '--nome', 'Synthetic CLI pairing'], f.root);
        assert.equal(requested.code, 0, requested.stderr); const receipt = JSON.parse(requested.stdout);
        assert.match(receipt.code, /^[A-F0-9]{8}$/u); assert.equal(receipt.status, 'pending');
        const file = path.join(f.credentials, 'pairing-' + receipt.requestId + '.json');
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.ok(!requested.stdout.includes(saved.claim));
        if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
        const pending = await cli(['completa', '--credenziali', f.credentials, '--richiesta', receipt.requestId], f.root);
        assert.equal(pending.code, 0, pending.stderr); assert.equal(JSON.parse(pending.stdout).status, 'pending');
        assert.ok(!fs.existsSync(path.join(f.credentials, receipt.requestId + '.json')));
        f.pairings.approve(receipt.requestId, receipt.code, f.mandate.id, f.actorRef, f.generation);
        const approved = await cli(['completa', '--credenziali', f.credentials, '--richiesta', receipt.requestId], f.root);
        assert.equal(approved.code, 0, approved.stderr); assert.equal(JSON.parse(approved.stdout).status, 'approved');
        const credential = JSON.parse(fs.readFileSync(path.join(f.credentials, receipt.requestId + '.json'), 'utf8'));
        assert.ok(!approved.stdout.includes(credential.token)); assert.ok(!approved.stderr.includes(credential.token));
        assert.equal(f.run(() => f.pairings.principal(credential.token))?.agentRef, receipt.requestId);
    } finally { await f.cleanup(); }
});

test('an enabled ambient HTTP proxy cannot receive or block the loopback deposit', async () => {
    const f = await fixture();
    try {
        const result = await cli(['deposita', '--credenziali', f.credentials, '--agente', f.principal.agentRef, '--estrazione', f.file, '--cf', cf, '--visita', randomUUID()], f.root,
            { NODE_USE_ENV_PROXY: '1', HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1', NO_PROXY: '' });
        assert.equal(result.code, 0, result.stderr); assert.equal(JSON.parse(result.stdout).status, 'closed');
    } finally { await f.cleanup(); }
});

test('a database-shaped input is rejected before opening its file descriptor', async () => {
    const f = await fixture(), file = path.join(f.files, 'synthetic-input.db'), open = fs.openSync; let opened = 0;
    try {
        fs.writeFileSync(file, f.database.serialize());
        fs.openSync = ((target: fs.PathLike, ...args: unknown[]) => { if (String(target) === file) opened++; return Reflect.apply(open, fs, [target, ...args]); }) as typeof fs.openSync;
        assert.throws(() => prepareAgentVisit(f.mandate.publicKey, f.principal.agentRef, f.mandate.id, file, cf), /AGENT_INPUT_INVALID/);
        assert.equal(opened, 0);
    } finally { fs.openSync = open; await f.cleanup(); }
});


test('the real CLI reads a bounded fiscal code from stdin without putting it in process arguments', async () => {
    const f = await fixture();
    try {
        const result = await cli(['deposita', '--credenziali', f.credentials, '--agente', f.principal.agentRef, '--estrazione', f.file, '--cf', '-', '--visita', randomUUID()], f.root, {}, cf + '\n');
        assert.equal(result.code, 0, result.stderr);
        assert.equal(JSON.parse(result.stdout).status, 'closed');
        assert.ok(!JSON.stringify(result).includes(cf));
        assert.ok(f.bodies.every(body => !body.includes(cf)));
    } finally { await f.cleanup(); }
});

test('oversized or empty stdin is refused without depositing or echoing its content', async () => {
    const f = await fixture();
    try {
        for (const input of ['', cf.repeat(16)]) {
            const result = await cli(['deposita', '--credenziali', f.credentials, '--agente', f.principal.agentRef, '--estrazione', f.file, '--cf', '-', '--visita', randomUUID()], f.root, {}, input);
            assert.equal(result.code, 1);
            assert.deepEqual(JSON.parse(result.stderr), { error: 'AGENT_INPUT_INVALID' });
            assert.ok(!JSON.stringify(result).includes(cf));
        }
        assert.equal(f.rows().length, 0);
        assert.deepEqual(f.events, []);
    } finally { await f.cleanup(); }
});

test('the CLI saves a renewable registration privately and pulls the current mandate without printing its tokens', async () => {
    const f = await fixture();
    try {
        const requested = await cli(['collega', '--credenziali', f.credentials, '--origine', f.origin, '--nome', 'Synthetic renewable CLI'], f.root);
        assert.equal(requested.code, 0, requested.stderr);
        const { requestId, code } = JSON.parse(requested.stdout);
        f.pairings.approve(requestId, code, f.mandate.id, f.actorRef, f.generation, true);
        const completed = await cli(['completa', '--credenziali', f.credentials, '--richiesta', requestId], f.root);
        assert.equal(completed.code, 0, completed.stderr);
        assert.deepEqual(JSON.parse(completed.stdout), { agentRef: requestId, status: 'registered' });
        const stored = readAgentRegistration(f.credentials, requestId)!;
        assert.match(stored.token, /^mfr_/u);
        assert.ok(!JSON.stringify(completed).includes(stored.token));
        if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(f.credentials, requestId + '.registration.json')).mode & 0o777, 0o600);

        f.installRegistration();
        const pulled = await cli(['ritira', '--credenziali', f.credentials, '--agente', f.principal.agentRef], f.root);
        assert.equal(pulled.code, 0, pulled.stderr);
        assert.equal(JSON.parse(pulled.stdout).mandateRef, f.mandate.id);
        assert.ok(!JSON.stringify(pulled).includes(f.token));
        assert.ok(!JSON.stringify(pulled).includes(f.longToken));
    } finally { await f.cleanup(); }
});

for (const mode of ['expired', 'refused'] as const) test(`the CLI automatically pulls on a ${mode} mandate before encrypting a new visit`, async () => {
    const f = await fixture();
    try {
        f.installRegistration();
        saveAgentCredential(f.credentials, { agentRef: f.principal.agentRef, mandateRef: f.mandate.id, origin: f.origin,
            token: 'mfa_' + 'Y'.repeat(43), expiresAt: Date.now() + (mode === 'expired' ? -1000 : 3600000) });
        const result = await cli(['deposita', '--credenziali', f.credentials, '--agente', f.principal.agentRef, '--estrazione', f.file,
            '--cf', cf, '--visita', randomUUID()], f.root);
        assert.equal(result.code, 0, result.stderr);
        assert.equal(JSON.parse(result.stdout).status, 'closed');
        assert.equal(f.pulls(), 1);
    } finally { await f.cleanup(); }
});
