import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import {
    parseAgentPatientContextInput,
    sealAgentPatientContextEnvelope,
} from '../agent-local-kit-context-contract';
import {
    clearLocalKitPatientContexts,
    listLocalKitPatientContexts,
    LOCAL_KIT_CONTEXT_DIR_NAME,
    LocalKitPathError,
    removeLocalKitCredentials,
    writeLocalKitCredentials,
    writeLocalKitPatientContext,
} from './agent-local-kit-files';

function makeKitFixture(root: string) {
    const kitDir = path.join(root, 'kit');
    fs.mkdirSync(kitDir, { mode: 0o700 });
    const credsDir = path.join(kitDir, '.agente');
    fs.writeFileSync(
        path.join(kitDir, 'deposito.json'),
        JSON.stringify({
            origine: 'http://127.0.0.1:3000',
            mediflow: '/synthetic/mediflow/corrente',
            node: '/synthetic/node',
            credenziali: credsDir,
            agente: null,
        }, null, 2) + '\n',
        { mode: 0o600 },
    );
    return { kitDir, credsDir };
}

const syntheticKey = randomBytes(32);

function sampleEnvelope(taxCode: string, nowMs: number) {
    const reference = createHmac('sha256', syntheticKey).update(taxCode).digest('hex');
    const parsed = parseAgentPatientContextInput({
        patient: { taxCodeLast4: taxCode.slice(-4) },
        diagnoses: [{ description: 'Ipertensione' }],
        therapies: [],
        exemptions: [],
        allergies: [],
        observations: [],
        recentNotes: [],
        openCheckups: [],
    });
    assert.ok(parsed);
    return sealAgentPatientContextEnvelope(parsed, reference, nowMs);
}

test('writes private 0700/0600 context files, auto-purges expired entries, and clears them on disconnect', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-kit-context-files-'));
    try {
        const { kitDir } = makeKitFixture(root);
        const now = 1_750_000_000_000;
        const first = sampleEnvelope('RSSMRA80A01H501U', now);
        const expired = sampleEnvelope('VRDLGI75B12F205X', now - 25 * 60 * 60 * 1000);

        writeLocalKitPatientContext(kitDir, first, now);
        writeLocalKitPatientContext(kitDir, expired, now - 25 * 60 * 60 * 1000);

        const contextDir = path.join(kitDir, LOCAL_KIT_CONTEXT_DIR_NAME);
        const dirStat = fs.lstatSync(contextDir);
        assert.equal(dirStat.isSymbolicLink(), false);
        assert.equal(dirStat.mode & 0o7777, 0o700);

        const fileStat = fs.lstatSync(path.join(contextDir, `${first.patient.cfHash}.json`));
        assert.equal(fileStat.isSymbolicLink(), false);
        assert.equal(fileStat.mode & 0o7777, 0o600);

        const active = listLocalKitPatientContexts(kitDir, now);
        assert.equal(active.length, 1);
        assert.equal(active[0]?.cfHash, first.patient.cfHash);
        assert.equal(active[0]?.taxCodeLast4, '501U');
        assert.equal(fs.existsSync(path.join(contextDir, `${expired.patient.cfHash}.json`)), false);

        const agentRef = randomUUID();
        writeLocalKitCredentials(
            kitDir,
            { agentRef, mandateRef: randomUUID(), token: 'mfa_' + randomBytes(32).toString('base64url'), expiresAt: now + 3600_000, origin: 'http://127.0.0.1:3000' },
            { agentRef, token: 'mfr_' + randomBytes(32).toString('base64url'), origin: 'http://127.0.0.1:3000' },
            randomBytes(32).toString('hex'),
        );
        removeLocalKitCredentials(kitDir, agentRef);
        assert.equal(listLocalKitPatientContexts(kitDir, now).length, 0);
        assert.equal(fs.existsSync(path.join(contextDir, `${first.patient.cfHash}.json`)), false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('rejects symlink context directory and clears contexts explicitly', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-kit-context-symlink-'));
    try {
        const { kitDir } = makeKitFixture(root);
        const outside = path.join(root, 'outside');
        fs.mkdirSync(outside, { mode: 0o700 });
        fs.symlinkSync(outside, path.join(kitDir, LOCAL_KIT_CONTEXT_DIR_NAME));
        const env = sampleEnvelope('RSSMRA80A01H501U', Date.now());
        assert.throws(() => writeLocalKitPatientContext(kitDir, env), LocalKitPathError);

        fs.unlinkSync(path.join(kitDir, LOCAL_KIT_CONTEXT_DIR_NAME));
        writeLocalKitPatientContext(kitDir, env);
        assert.equal(clearLocalKitPatientContexts(kitDir), 1);
        assert.equal(clearLocalKitPatientContexts(kitDir), 0);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
