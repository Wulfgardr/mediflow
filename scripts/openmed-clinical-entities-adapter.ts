#!/usr/bin/env node

/* @Codex */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';

type CorpusEntry = {
    id: string;
    inputText: string;
};

type RunnerReadyMessage = {
    type: 'ready';
    device: string;
    pipelineDevice: number;
    diseaseModel: string;
    pharmaModel: string;
    confidenceThreshold: number;
};

type RunnerStartupErrorMessage = {
    type: 'startup_error';
    error: string;
};

type RunnerResultMessage = {
    id: string | null;
    schemaVersion?: string;
    entities?: unknown[];
    error?: string;
};

type PendingRequest = {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.dirname(__dirname);
const DEFAULT_PYTHON_PATH = path.join(PROJECT_ROOT, '.venv_openmed', 'bin', 'python');
const RUNNER_PATH = path.join(__dirname, 'openmed-clinical-entities-runner.py');
const STARTUP_TIMEOUT_MS = Number.parseInt(process.env.MEDIFLOW_OPENMED_STARTUP_TIMEOUT_MS || '300000', 10);
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.MEDIFLOW_OPENMED_REQUEST_TIMEOUT_MS || '180000', 10);
const CLOSE_TIMEOUT_MS = Number.parseInt(process.env.MEDIFLOW_OPENMED_CLOSE_TIMEOUT_MS || '2000', 10);

let runnerPromise: Promise<RunnerClient> | null = null;

function resolvePythonExecutable() {
    if (process.env.MEDIFLOW_OPENMED_PYTHON) return process.env.MEDIFLOW_OPENMED_PYTHON;
    if (fs.existsSync(DEFAULT_PYTHON_PATH)) return DEFAULT_PYTHON_PATH;
    return 'python3.12';
}

function formatRunnerFailure(message: string, stderrLines: string[]) {
    const stderr = stderrLines.join('\n').trim();
    return stderr ? `${message}\n${stderr}` : message;
}

class RunnerClient {
    private child: ChildProcessWithoutNullStreams;
    private ready: Promise<RunnerReadyMessage>;
    private exited: Promise<void>;
    private pending = new Map<string, PendingRequest>();
    private nextId = 0;
    private stderrLines: string[] = [];
    private stdout: readline.Interface;
    private stderr: readline.Interface;

    constructor() {
        const python = resolvePythonExecutable();
        this.child = spawn(python, [RUNNER_PATH], {
            cwd: PROJECT_ROOT,
            env: {
                ...process.env,
                HF_HUB_DISABLE_TELEMETRY: '1',
                TRANSFORMERS_NO_ADVISORY_WARNINGS: '1',
            },
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        this.stdout = readline.createInterface({ input: this.child.stdout });
        this.stderr = readline.createInterface({ input: this.child.stderr });
        this.exited = new Promise<void>((resolve) => {
            this.child.once('exit', () => {
                this.stdout.close();
                this.stderr.close();
                resolve();
            });
        });

        this.ready = new Promise<RunnerReadyMessage>((resolve, reject) => {
            const startupTimeout = setTimeout(() => {
                reject(new Error(formatRunnerFailure(
                    `OpenMed clinical runner did not become ready within ${STARTUP_TIMEOUT_MS}ms.`,
                    this.stderrLines,
                )));
            }, STARTUP_TIMEOUT_MS);

            this.stdout.on('line', (line) => {
                const parsed = this.parseMessage(line);
                if (!parsed) return;

                if ('type' in parsed && parsed.type === 'ready') {
                    clearTimeout(startupTimeout);
                    resolve(parsed);
                    return;
                }

                if ('type' in parsed && parsed.type === 'startup_error') {
                    clearTimeout(startupTimeout);
                    reject(new Error(formatRunnerFailure(parsed.error, this.stderrLines)));
                    return;
                }

                this.handleResult(parsed);
            });

            this.stderr.on('line', (line) => {
                this.stderrLines = [...this.stderrLines.slice(-39), line];
            });

            this.child.once('error', (error) => {
                clearTimeout(startupTimeout);
                reject(error);
            });

            this.child.once('exit', (code, signal) => {
                clearTimeout(startupTimeout);
                const error = new Error(formatRunnerFailure(
                    `OpenMed clinical runner exited before readiness (code=${code ?? 'null'}, signal=${signal ?? 'null'}).`,
                    this.stderrLines,
                ));
                reject(error);
                this.failAllPending(error);
                runnerPromise = null;
            });
        });

        process.once('exit', () => {
            if (!this.child.killed) this.child.kill();
        });
    }

    async waitUntilReady() {
        return this.ready;
    }

    async analyze(text: string) {
        await this.waitUntilReady();

        const id = `openmed-clinical-${++this.nextId}`;
        const payload = JSON.stringify({ id, text });

        return new Promise<unknown>((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`OpenMed clinical runner timed out after ${REQUEST_TIMEOUT_MS}ms.`));
            }, REQUEST_TIMEOUT_MS);

            this.pending.set(id, {
                resolve,
                reject,
                timeout,
            });

            this.child.stdin.write(`${payload}\n`);
        });
    }

    async close() {
        if (!this.child.stdin.destroyed) {
            this.child.stdin.end();
        }
        if (!this.child.killed && this.child.exitCode === null && this.child.signalCode === null) {
            this.child.kill();
        }
        await Promise.race([
            this.exited,
            new Promise<void>((resolve) => {
                setTimeout(() => {
                    if (this.child.exitCode === null && this.child.signalCode === null) {
                        this.child.kill('SIGKILL');
                    }
                    resolve();
                }, CLOSE_TIMEOUT_MS);
            }),
        ]);
        await this.exited;
    }

    private parseMessage(line: string) {
        try {
            return JSON.parse(line) as RunnerReadyMessage | RunnerStartupErrorMessage | RunnerResultMessage;
        } catch {
            return null;
        }
    }

    private handleResult(message: RunnerResultMessage) {
        if (!message.id) return;

        const pending = this.pending.get(message.id);
        if (!pending) return;

        clearTimeout(pending.timeout);
        this.pending.delete(message.id);

        if (message.error) {
            pending.reject(new Error(message.error));
            return;
        }

        pending.resolve({
            schemaVersion: message.schemaVersion,
            entities: message.entities,
        });
    }

    private failAllPending(error: Error) {
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timeout);
            pending.reject(error);
        }
        this.pending.clear();
    }
}

async function getRunnerClient() {
    if (!runnerPromise) {
        runnerPromise = (async () => {
            const client = new RunnerClient();
            await client.waitUntilReady();
            return client;
        })().catch((error) => {
            runnerPromise = null;
            throw error;
        });
    }

    return runnerPromise;
}

async function disposeRunnerClient() {
    if (!runnerPromise) return;

    const client = await runnerPromise.catch(() => null);
    runnerPromise = null;
    client?.close();
}

/* @Codex */
export function createAdapter() {
    return {
        name: 'openmed_clinical_entities',
        async run(entry: CorpusEntry) {
            const client = await getRunnerClient();
            return client.analyze(entry.inputText);
        },
        async dispose() {
            await disposeRunnerClient();
        },
    };
}

export default createAdapter;
