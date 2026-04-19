#!/usr/bin/env node

/* @Codex */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runRedactionBenchmark } from './benchmark-redaction.ts';

type Scenario = {
    name: string;
    timeoutMs?: number;
    handleDeidentify: (response: http.ServerResponse) => void;
    validateError: (error: string | undefined) => boolean;
};

type ScenarioResult = {
    name: string;
    passed: boolean;
    observedError: string | null;
    contractValidRate: number;
};

type ResilienceReport = {
    generatedAt: string;
    adapterModule: string;
    scenarios: ScenarioResult[];
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ADAPTER_MODULE = path.join(__dirname, 'openmed-redaction-adapter.ts');

function createTempCorpusFile() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-redaction-resilience-'));
    const filePath = path.join(directory, 'corpus.json');
    fs.writeFileSync(filePath, JSON.stringify([{
        id: 'resilience-single-case',
        inputText: 'Mario Rossi scrive da mario.rossi@example.it.',
        gold: {
            redactedText: '[PERSON] scrive da [EMAIL].',
            entities: [
                { type: 'person', text: 'Mario Rossi', critical: true },
                { type: 'email', text: 'mario.rossi@example.it', critical: true },
            ],
            forbiddenTokens: [
                'Mario Rossi',
                'mario.rossi@example.it',
            ],
        },
    }], null, 2), 'utf8');

    return filePath;
}

async function startScenarioServer(scenario: Scenario) {
    const server = http.createServer((request, response) => {
        if (!request.url) {
            response.statusCode = 404;
            response.end();
            return;
        }

        if (request.method === 'GET' && request.url === '/health') {
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify({ status: 'ok' }));
            return;
        }

        if (request.method === 'POST' && request.url === '/pii/deidentify') {
            scenario.handleDeidentify(response);
            return;
        }

        response.statusCode = 404;
        response.end();
    });

    await new Promise<void>((resolve, reject) => {
        server.listen(0, '127.0.0.1', () => resolve());
        server.on('error', reject);
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
        throw new Error(`Unable to resolve scenario server address for ${scenario.name}`);
    }

    return {
        baseUrl: `http://127.0.0.1:${address.port}`,
        async close() {
            await new Promise<void>((resolve, reject) => {
                server.close((error) => error ? reject(error) : resolve());
            });
        },
    };
}

function restoreEnv(key: string, value: string | undefined) {
    if (typeof value === 'string') {
        process.env[key] = value;
    } else {
        delete process.env[key];
    }
}

async function main() {
    const corpusPath = createTempCorpusFile();
    const scenarios: Scenario[] = [
        {
            name: 'http-500',
            handleDeidentify(response) {
                response.statusCode = 500;
                response.setHeader('Content-Type', 'application/json');
                response.end(JSON.stringify({ error: { message: 'forced 500 from test stub' } }));
            },
            validateError(error) {
                return typeof error === 'string' && error.includes('forced 500 from test stub');
            },
        },
        {
            name: 'invalid-payload',
            handleDeidentify(response) {
                response.setHeader('Content-Type', 'application/json');
                response.end(JSON.stringify({ deidentified_text: '[PERSON]' }));
            },
            validateError(error) {
                return error === 'OpenMed deidentify response is missing pii_entities';
            },
        },
        {
            name: 'malformed-entity',
            handleDeidentify(response) {
                response.setHeader('Content-Type', 'application/json');
                response.end(JSON.stringify({
                    deidentified_text: '[PERSON]',
                    pii_entities: [{
                        text: 'Mario Rossi',
                        label: 'FIRSTNAME',
                        start: 'bad',
                        end: 11,
                    }],
                }));
            },
            validateError(error) {
                return error === 'OpenMed deidentify response contains an entity without valid text/start/end offsets';
            },
        },
        {
            name: 'timeout',
            timeoutMs: 1000,
            handleDeidentify(response) {
                setTimeout(() => {
                    response.setHeader('Content-Type', 'application/json');
                    response.end(JSON.stringify({
                        deidentified_text: '[PERSON]',
                        pii_entities: [],
                    }));
                }, 1250);
            },
            validateError(error) {
                return typeof error === 'string' && (error.toLowerCase().includes('abort') || error.toLowerCase().includes('timeout'));
            },
        },
    ];

    const previousBaseUrl = process.env.MEDIFLOW_OPENMED_BASE_URL;
    const previousTimeout = process.env.MEDIFLOW_OPENMED_TIMEOUT_MS;
    const results: ScenarioResult[] = [];

    try {
        for (const scenario of scenarios) {
            const server = await startScenarioServer(scenario);
            try {
                process.env.MEDIFLOW_OPENMED_BASE_URL = server.baseUrl;
                process.env.MEDIFLOW_OPENMED_TIMEOUT_MS = String(scenario.timeoutMs ?? 250);
                const report = await runRedactionBenchmark({
                    corpusPath,
                    adapterModule: ADAPTER_MODULE,
                });
                const observedError = report.cases[0]?.error ?? null;
                const passed =
                    report.metrics.contractValidRate === 0
                    && Boolean(observedError)
                    && scenario.validateError(observedError ?? undefined);

                results.push({
                    name: scenario.name,
                    passed,
                    observedError,
                    contractValidRate: report.metrics.contractValidRate,
                });
            } finally {
                await server.close();
            }
        }
    } finally {
        restoreEnv('MEDIFLOW_OPENMED_BASE_URL', previousBaseUrl);
        restoreEnv('MEDIFLOW_OPENMED_TIMEOUT_MS', previousTimeout);
    }

    const output: ResilienceReport = {
        generatedAt: new Date().toISOString(),
        adapterModule: ADAPTER_MODULE,
        scenarios: results,
    };

    const failed = results.filter((scenario) => !scenario.passed);
    const serialized = JSON.stringify(output, null, 2);
    console.log(serialized);

    if (failed.length > 0) {
        process.exitCode = 1;
    }
}

const isMainModule = process.argv[1]
    ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
    : false;

if (isMainModule) {
    void main();
}
