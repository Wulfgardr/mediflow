/* @Codex */
import { fileURLToPath } from 'node:url';

export const MINI_EXIT = Object.freeze({ OK: 0, USAGE: 2, BROKER_UNAVAILABLE: 69 });
export const MINI_STDIN_MAX_BYTES = 16 * 1024;
export const MINI_HELP = `MediFlow Mini transport candidate

Usage: npm run --silent mini -- [--format json|ndjson]
       printf '{"command":"opaque.intent","args":{}}' | npm run --silent mini --

This candidate only validates and renders transport envelopes. It does not bind
an application service or execute a command.
`;

type Format = 'json' | 'ndjson';
type TransportRequest = Readonly<{ command: string; args: Record<string, unknown> }>;
export type MiniTransport = Readonly<{ format: Format; request: TransportRequest }>;
export type MiniRun = Readonly<{ exitCode: number; stdout: string; stderr: string }>;

function parseFormat(argv: readonly string[]): Format | null {
    let format: Format = 'json'; let seen = false;
    for (let index = 0; index < argv.length; index += 1) {
        if (argv[index] !== '--format' || seen) return null;
        const value = argv[index + 1];
        if (value !== 'json' && value !== 'ndjson') return null;
        format = value;
        seen = true;
        index += 1;
    }
    return format;
}

function hasDuplicateObjectKeys(raw: string): boolean {
    const objectKeys: Array<Set<string> | null> = [];
    for (let index = 0; index < raw.length; index += 1) {
        const character = raw[index];
        if (character === '{') { objectKeys.push(new Set()); continue; }
        if (character === '[') { objectKeys.push(null); continue; }
        if (character === '}' || character === ']') { objectKeys.pop(); continue; }
        if (character !== '"') continue;
        const start = index;
        for (index += 1; index < raw.length; index += 1) {
            if (raw[index] === '\\') { index += 1; continue; }
            if (raw[index] === '"') break;
        }
        let next = index + 1;
        while (/\s/u.test(raw[next] ?? '')) next += 1;
        const keys = objectKeys.at(-1);
        if (raw[next] !== ':' || !keys) continue;
        const key = JSON.parse(raw.slice(start, index + 1)) as string;
        if (keys.has(key)) return true;
        keys.add(key);
    }
    return false;
}

function parseEnvelope(raw: string): TransportRequest | null {
    try {
        const value = JSON.parse(raw);
        if (hasDuplicateObjectKeys(raw)) return null;
        if (typeof value !== 'object' || value === null || Array.isArray(value)
            || Object.keys(value).sort().join(',') !== 'args,command'
            || typeof value.command !== 'string' || typeof value.args !== 'object'
            || value.args === null || Array.isArray(value.args)) return null;
        return { command: value.command, args: value.args as Record<string, unknown> };
    } catch {
        return null;
    }
}

export function parseMiniTransport(argv: readonly string[], stdin: string): MiniTransport | null {
    const format = parseFormat(argv);
    if (!format) return null;
    const request = parseEnvelope(stdin);
    return request ? { format, request } : null;
}

export function renderMiniTransport(value: Record<string, unknown>, format: Format): string {
    if (format === 'json') return `${JSON.stringify(value, null, 2)}\n`;
    const items = value.items;
    if (!Array.isArray(items)) return `${JSON.stringify(value)}\n`;
    if (items.length === 0) return `${JSON.stringify({ index: null, item: null })}\n`;
    for (let index = 0; index < items.length; index += 1) {
        if (!Object.hasOwn(items, index)) return `${JSON.stringify({ error: 'NDJSON_SPARSE_ITEMS', index })}\n`;
    }
    return items.map((item, index) => JSON.stringify({ index, item })).join('\n') + '\n';
}

function failure(error: string, exitCode: number, format: Format): MiniRun {
    return {
        exitCode,
        stdout: renderMiniTransport({ schemaVersion: 'mediflow.mini.transport.v1', ok: false, error }, format),
        stderr: '',
    };
}

export function runMiniTransport(argv: readonly string[], stdin = '', inputTooLarge = false): MiniRun {
    if (argv.includes('--help') || argv.includes('-h')) return { exitCode: MINI_EXIT.OK, stdout: MINI_HELP, stderr: '' };
    const parsedFormat = parseFormat(argv); const format = parsedFormat ?? 'json';
    if (!parsedFormat) return failure('USAGE', MINI_EXIT.USAGE, format);
    if (inputTooLarge) return failure('INPUT_TOO_LARGE', MINI_EXIT.USAGE, format);
    if (!parseMiniTransport(argv, stdin)) return failure('USAGE', MINI_EXIT.USAGE, format);
    return failure('TRANSPORT_UNBOUND', MINI_EXIT.BROKER_UNAVAILABLE, format);
}

async function main(): Promise<void> {
    const argv = process.argv.slice(2);
    let stdin = ''; let inputBytes = 0; let inputTooLarge = false;
    if (parseFormat(argv) !== null && !process.stdin.isTTY && !argv.includes('--help') && !argv.includes('-h')) {
        process.stdin.setEncoding('utf8');
        for await (const chunk of process.stdin) {
            inputBytes += Buffer.byteLength(chunk, 'utf8');
            if (inputBytes > MINI_STDIN_MAX_BYTES) { inputTooLarge = true; process.stdin.destroy(); break; }
            stdin += chunk;
        }
    }
    const result = runMiniTransport(argv, stdin, inputTooLarge);
    process.stdout.write(result.stdout); process.stderr.write(result.stderr); process.exitCode = result.exitCode;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) void main();
