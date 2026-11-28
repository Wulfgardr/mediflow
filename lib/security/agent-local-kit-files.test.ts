import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import {
    readAgentCredential,
    readAgentRegistration,
    type AgentCredential,
    type AgentRegistrationCredential,
} from '../../packages/agent-client/src/credentials';
import {
    LocalKitPathError,
    readDepositoJson,
    removeLocalKitCredentials,
    resolveKitCredentialsDirectory,
    validateLocalKitDirectory,
    writeLocalKitCredentials,
} from './agent-local-kit-files';

function makeTempRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-local-kit-files-'));
}

function makeKitFixture(root: string, overrides: Record<string, unknown> = {}) {
    const kitDir = path.join(root, 'kit');
    fs.mkdirSync(kitDir, { mode: 0o700 });
    const credsDir = path.join(kitDir, '.agente');
    const deposito = {
        origine: 'http://127.0.0.1:3000',
        mediflow: '/synthetic/mediflow/corrente',
        node: '/synthetic/node',
        credenziali: credsDir,
        agente: null,
        campoExtra: 'conservato',
        ...overrides,
    };
    fs.writeFileSync(path.join(kitDir, 'deposito.json'), JSON.stringify(deposito, null, 2) + '\n', { mode: 0o600 });
    return { kitDir, credsDir, deposito };
}

test('writes 0700 creds dir, 0600 credential files readable by agent-client, and updates only agente in deposito.json', () => {
    const root = makeTempRoot();
    try {
        const { kitDir, credsDir } = makeKitFixture(root);
        const agentRef = randomUUID();
        const mandateRef = randomUUID();
        const access: AgentCredential = {
            agentRef,
            mandateRef,
            token: 'mfa_' + randomBytes(32).toString('base64url'),
            expiresAt: Date.now() + 3600_000,
            origin: 'http://127.0.0.1:3000',
        };
        const registration: AgentRegistrationCredential = {
            agentRef,
            token: 'mfr_' + randomBytes(32).toString('base64url'),
            origin: 'http://127.0.0.1:3000',
        };

        const patientReferenceKey = randomBytes(32).toString('hex');
        writeLocalKitCredentials(kitDir, access, registration, patientReferenceKey);

        const referenceFile = path.join(kitDir, 'riferimento-pazienti.json');
        const referenceStat = fs.lstatSync(referenceFile);
        assert.equal(referenceStat.isSymbolicLink(), false);
        assert.equal(referenceStat.mode & 0o7777, 0o600);
        assert.deepEqual(JSON.parse(fs.readFileSync(referenceFile, 'utf8')), { segreto: patientReferenceKey });

        const dirStat = fs.lstatSync(credsDir);
        assert.equal(dirStat.isSymbolicLink(), false);
        assert.equal(dirStat.mode & 0o7777, 0o700);

        const credStat = fs.lstatSync(path.join(credsDir, `${agentRef}.json`));
        const regStat = fs.lstatSync(path.join(credsDir, `${agentRef}.registration.json`));
        assert.equal(credStat.isSymbolicLink(), false);
        assert.equal(credStat.mode & 0o7777, 0o600);
        assert.equal(regStat.isSymbolicLink(), false);
        assert.equal(regStat.mode & 0o7777, 0o600);

        assert.deepEqual(readAgentCredential(credsDir, agentRef), access);
        assert.deepEqual(readAgentRegistration(credsDir, agentRef), registration);

        const updatedDeposito = readDepositoJson(kitDir);
        assert.equal(updatedDeposito.agente, agentRef);
        assert.equal(updatedDeposito.origine, 'http://127.0.0.1:3000');
        assert.equal(updatedDeposito.mediflow, '/synthetic/mediflow/corrente');
        assert.equal(updatedDeposito.node, '/synthetic/node');
        assert.equal(updatedDeposito.credenziali, credsDir);
        assert.equal(updatedDeposito.campoExtra, 'conservato');

        removeLocalKitCredentials(kitDir, agentRef);
        assert.equal(fs.existsSync(referenceFile), false);
        assert.equal(fs.existsSync(path.join(credsDir, `${agentRef}.json`)), false);
        assert.equal(fs.existsSync(path.join(credsDir, `${agentRef}.registration.json`)), false);
        const afterRemove = readDepositoJson(kitDir);
        assert.equal(afterRemove.agente, null);
        assert.equal(afterRemove.campoExtra, 'conservato');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('rejects nonexistent kit directory, symlink kit directory, symlink deposito.json, and credenziali outside kit directory', () => {
    const root = makeTempRoot();
    try {
        const missing = path.join(root, 'nonexistent');
        assert.throws(() => validateLocalKitDirectory(missing), LocalKitPathError);

        const realDir = path.join(root, 'real');
        fs.mkdirSync(realDir, { mode: 0o700 });
        const linkDir = path.join(root, 'link-kit');
        fs.symlinkSync(realDir, linkDir);
        assert.throws(() => validateLocalKitDirectory(linkDir), LocalKitPathError);

        const kitWithLinkDeposito = path.join(root, 'kit-link-dep');
        fs.mkdirSync(kitWithLinkDeposito, { mode: 0o700 });
        const externalDeposito = path.join(root, 'outside.json');
        fs.writeFileSync(externalDeposito, JSON.stringify({ origine: 'http://127.0.0.1:3000' }));
        fs.symlinkSync(externalDeposito, path.join(kitWithLinkDeposito, 'deposito.json'));
        assert.throws(() => readDepositoJson(kitWithLinkDeposito), LocalKitPathError);

        const outsideCreds = path.join(root, 'outside-creds');
        fs.mkdirSync(outsideCreds, { mode: 0o700 });
        const { kitDir } = makeKitFixture(root, { credenziali: outsideCreds });
        const deposito = readDepositoJson(kitDir);
        assert.throws(() => resolveKitCredentialsDirectory(kitDir, deposito), LocalKitPathError);

        const kitWithSymlinkCreds = path.join(root, 'kit-link-creds');
        fs.mkdirSync(kitWithSymlinkCreds, { mode: 0o700 });
        fs.symlinkSync(outsideCreds, path.join(kitWithSymlinkCreds, '.agente'));
        fs.writeFileSync(
            path.join(kitWithSymlinkCreds, 'deposito.json'),
            JSON.stringify({ origine: 'http://127.0.0.1:3000', credenziali: path.join(kitWithSymlinkCreds, '.agente') }),
            { mode: 0o600 },
        );
        assert.throws(() => resolveKitCredentialsDirectory(kitWithSymlinkCreds, readDepositoJson(kitWithSymlinkCreds)), LocalKitPathError);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('rejects synced user folders such as Documents and Desktop', () => {
    const blocked = path.join(os.homedir(), 'Documents', 'synthetic-kit-never-allowed');
    assert.throws(() => validateLocalKitDirectory(blocked), LocalKitPathError);
});

test('credenziali written through a symlinked parent of the kit resolve inside the physical kit directory', () => {
    const realRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-kit-real-'));
    const kit = path.join(realRoot, 'mf-ambulatorio-kit');
    fs.mkdirSync(kit, { mode: 0o700 });
    const alias = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-kit-alias-')), 'alias');
    fs.symlinkSync(realRoot, alias);
    const credsThroughAlias = path.join(alias, 'mf-ambulatorio-kit', '.agente');
    const physicalKit = fs.realpathSync(kit);
    const credentials = resolveKitCredentialsDirectory(physicalKit, { credenziali: credsThroughAlias });
    assert.equal(credentials, path.join(physicalKit, '.agente'));
    assert.throws(() => resolveKitCredentialsDirectory(physicalKit, { credenziali: path.join(alias, 'altrove') }));
});
