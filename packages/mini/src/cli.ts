/* @Codex */
import { fileURLToPath } from 'node:url';

import {
    createSyntheticTrustedAgentService, type AgentServiceError, type AgentServiceResult, type TrustedAgentService,
} from '../../../lib/agent-interface/trusted-service';

export const MINI_EXIT = Object.freeze({ OK: 0, USAGE: 2, AUTHORITY: 3, NOT_FOUND: 4, APPLY_DENIED: 5, BROKER_UNAVAILABLE: 69 });
export const MINI_HELP = `MediFlow Mini — synthetic, read-only pilot

Usage: mediflow-mini --synthetic [--format json|ndjson] <command>
       printf '{"command":"whoami","args":{}}' | mediflow-mini --synthetic

Commands:
  whoami
  capabilities
  patient search <query>
  patient show <opaque-patient-ref>
  open-loops <opaque-patient-ref>
  draft preview <opaque-patient-ref>
  apply <opaque-patient-ref>        always denied

Without --synthetic, Mini denies access because no live broker is available.
Exit codes: 0 success, 2 usage, 3 authority, 4 not found,
            5 apply denied, 69 broker unavailable.
`;

type Format = 'json' | 'ndjson';
type CliRequest = Readonly<{ command: string; args: Record<string, unknown> }>;
export type MiniRun = Readonly<{ exitCode: number; stdout: string; stderr: string }>;

function failure(error: string, exitCode: number, format: Format, receipt?: unknown): MiniRun {
    return { exitCode, stdout: render({ schemaVersion: 'mediflow.mini.output.v1', ok: false, error, ...(receipt ? { receipt } : {}) }, format), stderr: '' };
}
function parsePipe(raw: string): CliRequest | null {
    try {
        const value = JSON.parse(raw);
        if (typeof value !== 'object' || value === null || Array.isArray(value)
            || Object.keys(value).sort().join(',') !== 'args,command'
            || typeof value.command !== 'string' || typeof value.args !== 'object'
            || value.args === null || Array.isArray(value.args)) return null;
        return { command: value.command, args: value.args as Record<string, unknown> };
    } catch { return null; }
}
function parseCommand(words: readonly string[]): CliRequest | null {
    if (words.length === 1 && (words[0] === 'whoami' || words[0] === 'capabilities')) return { command: words[0], args: {} };
    if (words[0] === 'patient' && words[1] === 'search' && words.length >= 3) return { command: 'patient.search', args: { query: words.slice(2).join(' ') } };
    if (words[0] === 'patient' && words[1] === 'show' && words.length === 3) return { command: 'patient.show', args: { patientRef: words[2] } };
    if (words[0] === 'open-loops' && words.length === 2) return { command: 'open-loops', args: { patientRef: words[1] } };
    if (words[0] === 'draft' && words[1] === 'preview' && words.length === 3) return { command: 'draft.preview', args: { patientRef: words[2] } };
    if (words[0] === 'apply' && words.length === 2) return { command: 'apply', args: { patientRef: words[1] } };
    return null;
}
function render(value: Record<string, unknown>, format: Format): string {
    if (format === 'json') return `${JSON.stringify(value, null, 2)}\n`;
    const data = value.data;
    if (!Array.isArray(data)) return `${JSON.stringify(value)}\n`;
    if (!data.length) return `${JSON.stringify({ ...value, index: null, data: null })}\n`;
    return data.map((item, index) => JSON.stringify({ ...value, index, data: item })).join('\n') + '\n';
}
function exitFor(error: AgentServiceError): number {
    if (error === 'REQUEST_INVALID') return MINI_EXIT.USAGE;
    if (error === 'PATIENT_NOT_FOUND') return MINI_EXIT.NOT_FOUND;
    if (error === 'APPLY_DENIED') return MINI_EXIT.APPLY_DENIED;
    return MINI_EXIT.AUTHORITY;
}

export function runMini(argv: readonly string[], stdin = '', injected?: TrustedAgentService): MiniRun {
    if (argv.includes('--help') || argv.includes('-h')) return { exitCode: MINI_EXIT.OK, stdout: MINI_HELP, stderr: '' };
    let synthetic = false; let format: Format = 'json'; const words: string[] = [];
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--synthetic') synthetic = true;
        else if (arg === '--format' && (argv[index + 1] === 'json' || argv[index + 1] === 'ndjson')) format = argv[++index] as Format;
        else if (arg.startsWith('-')) return failure('USAGE', MINI_EXIT.USAGE, format);
        else words.push(arg);
    }
    if (!synthetic) return failure('BROKER_UNAVAILABLE', MINI_EXIT.BROKER_UNAVAILABLE, format);
    const request = words.length ? parseCommand(words) : parsePipe(stdin);
    if (!request) return failure('USAGE', MINI_EXIT.USAGE, format);
    const service = injected ?? createSyntheticTrustedAgentService().service;
    const result: AgentServiceResult = service.execute({
        credential: 'synthetic-agent-credential', requestId: 'mini-request-0001', command: request.command, args: request.args,
    });
    if (!result.ok) return failure(result.error, exitFor(result.error), format, result.receipt);
    return { exitCode: MINI_EXIT.OK, stdout: render({ schemaVersion: 'mediflow.mini.output.v1', ok: true, data: result.data, receipt: result.receipt }, format), stderr: '' };
}

async function main(): Promise<void> {
    let stdin = '';
    if (!process.stdin.isTTY) { process.stdin.setEncoding('utf8'); for await (const chunk of process.stdin) stdin += chunk; }
    const result = runMini(process.argv.slice(2), stdin);
    process.stdout.write(result.stdout); process.stderr.write(result.stderr); process.exitCode = result.exitCode;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) void main();
