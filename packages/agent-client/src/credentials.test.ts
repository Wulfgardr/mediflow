import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { readAgentCredential, saveAgentCredential, type AgentCredential } from './credentials';

function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-agent-credential-'));
    const value: AgentCredential = { agentRef: randomUUID(), mandateRef: randomUUID(), token: 'mfa_' + randomBytes(32).toString('base64url'),
        expiresAt: Date.now() + 43200000, origin: 'http://127.0.0.1:43219' };
    return { root, value, file: path.join(root, `${value.agentRef}.json`), cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
test('agent credential persists in an owner-only file, reloads after restart, expires and emits no output', () => {
    const f = fixture(), output: unknown[] = [], log = console.log, error = console.error;
    console.log = (...args) => { output.push(args); }; console.error = (...args) => { output.push(args); };
    try {
        saveAgentCredential(f.root, f.value);
        if (process.platform !== 'win32') { assert.equal(fs.statSync(f.file).mode & 0o777, 0o600); assert.equal(fs.statSync(f.root).mode & 0o777, 0o700); }
        assert.equal(readAgentCredential(f.root, f.value.agentRef)?.token === f.value.token, true);
        assert.equal(readAgentCredential(f.root, f.value.agentRef, f.value.expiresAt), null);
        assert.deepEqual(fs.readdirSync(f.root), [`${f.value.agentRef}.json`]);
        assert.deepEqual(output, []);
    } finally { console.log = log; console.error = error; f.cleanup(); }
});
for (const mutation of ['token', 'origin', 'traversal', 'extra'] as const) test(`invalid credential ${mutation} creates no file and exposes no secret`, () => {
    const f = fixture();
    try {
        const value: Record<string, unknown> = { ...f.value };
        if (mutation === 'token') value.token = randomBytes(32).toString('hex');
        if (mutation === 'origin') value.origin = 'https://example.invalid';
        if (mutation === 'traversal') value.agentRef = '../../credential';
        if (mutation === 'extra') value.pin = 'synthetic-forbidden-field';
        assert.throws(() => saveAgentCredential(f.root, value as AgentCredential), error => error instanceof Error
            && error.message === 'AGENT_CREDENTIAL_UNAVAILABLE' && !error.message.includes(f.value.token));
        assert.deepEqual(fs.readdirSync(f.root), []);
    } finally { f.cleanup(); }
});
for (const name of ['Documents', 'Desktop', 'Downloads', 'Library/Mobile Documents', 'Library/CloudStorage']) test(`credential store refuses synchronized or intake root ${name} before creating anything`, () => {
    const f = fixture();
    try {
        const destination = path.join(os.homedir(), name, `synthetic-agent-denied-${randomUUID()}`);
        assert.throws(() => saveAgentCredential(destination, f.value), /AGENT_CREDENTIAL_UNAVAILABLE/);
    } finally { f.cleanup(); }
});
test('symlink, public file and public directory cannot replace the private credential boundary', { skip: process.platform === 'win32' }, () => {
    const f = fixture();
    try {
        const target = path.join(f.root, 'synthetic-target'); fs.writeFileSync(target, 'preserved', { mode: 0o600 });
        fs.symlinkSync(target, f.file);
        assert.throws(() => saveAgentCredential(f.root, f.value), /AGENT_CREDENTIAL_UNAVAILABLE/);
        assert.throws(() => readAgentCredential(f.root, f.value.agentRef), /AGENT_CREDENTIAL_UNAVAILABLE/);
        assert.equal(fs.readFileSync(target, 'utf8'), 'preserved'); fs.unlinkSync(f.file);
        saveAgentCredential(f.root, f.value); fs.chmodSync(f.file, 0o644);
        assert.throws(() => readAgentCredential(f.root, f.value.agentRef), /AGENT_CREDENTIAL_UNAVAILABLE/);
        assert.throws(() => saveAgentCredential(f.root, f.value), /AGENT_CREDENTIAL_UNAVAILABLE/);
        fs.chmodSync(f.file, 0o600); fs.chmodSync(f.root, 0o755);
        assert.throws(() => readAgentCredential(f.root, f.value.agentRef), /AGENT_CREDENTIAL_UNAVAILABLE/);
    } finally { f.cleanup(); }
});

test('a multiply linked credential cannot be loaded or replaced as an owner-only credential', () => {
    const f = fixture();
    try {
        saveAgentCredential(f.root, f.value);
        const alias = path.join(f.root, 'synthetic-linked-credential'); fs.linkSync(f.file, alias);
        assert.throws(() => readAgentCredential(f.root, f.value.agentRef), /AGENT_CREDENTIAL_UNAVAILABLE/);
        assert.throws(() => saveAgentCredential(f.root, f.value), /AGENT_CREDENTIAL_UNAVAILABLE/);
    } finally { f.cleanup(); }
});
