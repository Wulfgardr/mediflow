import 'server-only';
import { spawn, execFile } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { visitProofSchema, visitRegistrationSchema } from './agent-visit-confirmation-contract';
import { confirmationDigest, visitConfirmationPublicKey } from './agent-visit-confirmation-proof';

const execute = promisify(execFile);
const denied = () => new Error('VISIT_CONFIRMATION_NATIVE_DENIED');
const frameLimit = 1024;
const identifier = 'com.mediflow.agent-visit-confirmation';

export function nativeVisitConfirmationConfigured() {
    const helper = process.env.MEDIFLOW_VISIT_CONFIRMATION_HELPER ?? '';
    const digest = process.env.MEDIFLOW_VISIT_CONFIRMATION_HELPER_SHA256 ?? '';
    const cdhash = process.env.MEDIFLOW_VISIT_CONFIRMATION_HELPER_CDHASH ?? '';
    return process.platform === 'darwin' && path.isAbsolute(helper) && /^[a-f0-9]{64}$/u.test(digest)
        && /^[a-f0-9]{40}$/u.test(cdhash) ? { helper, digest, cdhash } : null;
}

export async function launchNativeVisitConfirmation(signal: AbortSignal) {
    const configured = nativeVisitConfirmationConfigured();
    if (!configured) throw denied();
    const executable = await realpath(configured.helper);
    const file = await stat(executable);
    if (!file.isFile() || file.size > 20_000_000 || (file.mode & 0o022) !== 0) throw denied();
    if (confirmationDigest(await readFile(executable)) !== configured.digest) throw denied();
    const requirement = '-R=anchor apple generic and identifier "' + identifier
        + '" and cdhash H"' + configured.cdhash + '" and !(entitlement["com.apple.security.get-task-allow"] exists)';
    const codesign = (args: string[]) => execute('/usr/bin/codesign', args, { signal, timeout: 5000, maxBuffer: 4096 });
    await codesign(['--verify', '--strict', requirement, executable]);
    if (confirmationDigest(await readFile(executable)) !== configured.digest) throw denied();
    signal.throwIfAborted();
    const child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'ignore'], signal, env: { PATH: '/usr/bin:/bin', NODE_ENV: 'production' } });
    const output: string[] = [];
    let buffer = '', failed = false;
    let wake: (() => void) | undefined;
    const notify = () => { wake?.(); wake = undefined; };
    const stop = () => { failed = true; child.kill(); notify(); };
    child.once('error', stop);
    child.stdin.once('error', stop);
    child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        if (buffer.length > frameLimit || output.length >= 2) { stop(); return; }
        const lines = buffer.split('\n');
        buffer = lines.pop()!;
        output.push(...lines);
        if (output.length > 2) { stop(); return; }
        notify();
    });
    let closed = false;
    child.once('exit', () => { closed = true; notify(); });
    child.once('close', () => { closed = true; notify(); });
    const assertLive = () => {
        if (failed || closed || signal.aborted || child.exitCode !== null || child.signalCode !== null) throw denied();
    };
    const read = async (index: number) => {
        while (!output[index] && !closed && !failed) await new Promise<void>(resolve => { wake = resolve; });
        signal.throwIfAborted();
        if (failed || !output[index]) throw denied();
        return JSON.parse(output[index]);
    };
    const validatePeer = async () => {
        assertLive();
        if (!child.pid) throw denied();
        const target = '+' + child.pid;
        await codesign(['--verify', '--strict', target]);
        const { stderr } = await codesign(['--display', '--verbose=4', target]);
        const code = stderr.split('\n');
        if (!code.includes('CDHash=' + configured.cdhash) || !code.includes('Identifier=' + identifier)
            || !code.some(line => /^CodeDirectory .+flags=0x[\da-f]+\([^)]*\bruntime\b[^)]*\)/u.test(line))) throw denied();
        assertLive();
    };
    try {
        const registration = visitRegistrationSchema.parse(await read(0));
        visitConfirmationPublicKey(registration.agreementPublicKey);
        visitConfirmationPublicKey(registration.signingPublicKey);
        await validatePeer();
        if (output.length !== 1) throw denied();
        let used = false;
        return Object.freeze({
            registration,
            async confirm(challenge: string, presentation: string) {
                if (used || closed || failed || signal.aborted) throw denied();
                used = true;
                child.stdin.write(JSON.stringify({ challenge: Buffer.from(challenge).toString('base64'), presentation }) + '\n');
                const proof = visitProofSchema.parse(await read(1));
                await validatePeer();
                if (buffer || output.length !== 2) throw denied();
                return proof;
            },
            assertLive,
            complete() { child.stdin.end('1'); },
            stop,
        });
    } catch (error) {
        stop();
        throw error;
    }
}
