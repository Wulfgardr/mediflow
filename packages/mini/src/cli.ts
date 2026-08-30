import { argv, exit, stdin, stdout } from 'node:process';
import { MINI_HEADLESS_REFERENTIAL_STATUSES } from './headless-referential-status';

/* @Codex */
const SCHEMA_VERSION = 'mediflow.mini.transport.v1';
const MAX_INPUT_BYTES = 16 * 1024;
const JSON_STRING = '"(?:[^"\\\\\\u0000-\\u001f]|\\\\(?:["\\\\/bfnrt]|u[0-9a-fA-F]{4}))*"';
const COMMAND_FIRST = new RegExp(
  `^[ \\t\\r\\n]*\\{[ \\t\\r\\n]*"command"[ \\t\\r\\n]*:[ \\t\\r\\n]*(${JSON_STRING})[ \\t\\r\\n]*,[ \\t\\r\\n]*"args"[ \\t\\r\\n]*:[ \\t\\r\\n]*\\{[ \\t\\r\\n]*\\}[ \\t\\r\\n]*\\}[ \\t\\r\\n]*$`,
);
const ARGS_FIRST = new RegExp(
  `^[ \\t\\r\\n]*\\{[ \\t\\r\\n]*"args"[ \\t\\r\\n]*:[ \\t\\r\\n]*\\{[ \\t\\r\\n]*\\}[ \\t\\r\\n]*,[ \\t\\r\\n]*"command"[ \\t\\r\\n]*:[ \\t\\r\\n]*(${JSON_STRING})[ \\t\\r\\n]*\\}[ \\t\\r\\n]*$`,
);

type OutputFormat = 'json' | 'ndjson';
type ErrorCode = 'INVALID_REQUEST' | 'TRANSPORT_UNBOUND';

function finish(code: number, output: string): void {
  stdout.write(output, () => exit(code));
}

function fail(code: ErrorCode, exitCode: number): void {
  finish(exitCode, `${JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    ok: false,
    error: { code },
  })}\n`);
}

function serialize(format: OutputFormat): string {
  if (format === 'ndjson') {
    let output = '';
    for (let index = 0; index < MINI_HEADLESS_REFERENTIAL_STATUSES.length; index += 1) {
      output += `${JSON.stringify({ index, item: MINI_HEADLESS_REFERENTIAL_STATUSES[index]! })}\n`;
    }
    return output;
  }

  const items = [] as (typeof MINI_HEADLESS_REFERENTIAL_STATUSES)[number][];
  for (let index = 0; index < MINI_HEADLESS_REFERENTIAL_STATUSES.length; index += 1) {
    items[index] = MINI_HEADLESS_REFERENTIAL_STATUSES[index]!;
  }
  return `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, ok: true, items })}\n`;
}

let format: OutputFormat;
if (argv.length === 2) {
  format = 'json';
} else if (argv.length === 3 && argv[2] === '--help') {
  finish(0, 'Usage: mediflow-mini [--format json|ndjson] < request.json\n');
  format = 'json';
} else if (argv.length === 4 && argv[2] === '--format'
  && (argv[3] === 'json' || argv[3] === 'ndjson')) {
  format = argv[3];
} else {
  fail('INVALID_REQUEST', 2);
  format = 'json';
}

if ((argv.length === 2) || (argv.length === 4 && argv[2] === '--format'
  && (argv[3] === 'json' || argv[3] === 'ndjson'))) {
  const bytes = Buffer.alloc(MAX_INPUT_BYTES);
  let byteLength = 0;
  let settled = false;

  stdin.on('data', (chunk: Buffer) => {
    if (settled) return;
    if (!Buffer.isBuffer(chunk) || byteLength + chunk.length > MAX_INPUT_BYTES) {
      settled = true;
      stdin.removeAllListeners('data');
      stdin.removeAllListeners('end');
      stdin.destroy();
      fail('INVALID_REQUEST', 2);
      return;
    }
    chunk.copy(bytes, byteLength);
    byteLength += chunk.length;
  });

  stdin.on('end', () => {
    if (settled) return;
    settled = true;
    let input: string;
    try {
      input = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, byteLength));
    } catch {
      fail('INVALID_REQUEST', 2);
      return;
    }
    const match = COMMAND_FIRST.exec(input) ?? ARGS_FIRST.exec(input);
    if (match === null) {
      fail('INVALID_REQUEST', 2);
      return;
    }
    const command = JSON.parse(match[1]!) as string;
    if (command !== 'capabilities') {
      fail('TRANSPORT_UNBOUND', 69);
      return;
    }
    finish(0, serialize(format));
  });
}
