/* @Codex */
import fs from 'node:fs';
import { buildLocalAbsorptionTelemetryReportFromInputs } from '../lib/local-absorption-telemetry';
import type { BuildEvidenceQueueInput } from '../lib/domain/documents/evidence-queue-contract';

function usage(): string {
    return [
        'Usage:',
        '  npm run report:local-absorption-telemetry -- --input <queue-input.json> [--out report.redacted.json]',
        '',
        'Input shape:',
        '  BuildEvidenceQueueInput[] or { "inputs": BuildEvidenceQueueInput[] }',
        '',
        'Output is PHI-safe counts only; it never prints source text, snippets, prompts or model output.',
    ].join('\n');
}

function readArgs(argv: string[]): { input?: string; out?: string; help: boolean } {
    const args: { input?: string; out?: string; help: boolean } = { help: false };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--help' || arg === '-h') args.help = true;
        else if (arg === '--input') args.input = argv[index += 1];
        else if (arg === '--out') args.out = argv[index += 1];
        else throw new Error(`Unknown argument: ${arg}`);
    }
    return args;
}

function parseInputs(value: unknown): BuildEvidenceQueueInput[] {
    const candidate = Array.isArray(value)
        ? value
        : value && typeof value === 'object' && Array.isArray((value as { inputs?: unknown }).inputs)
            ? (value as { inputs: unknown[] }).inputs
            : undefined;
    if (!candidate) throw new Error('Input must be an array or an object with an inputs array.');
    return candidate as BuildEvidenceQueueInput[];
}

async function main(): Promise<void> {
    const args = readArgs(process.argv.slice(2));
    if (args.help || !args.input) {
        console.log(usage());
        process.exit(args.help ? 0 : 1);
    }

    const input = JSON.parse(await fs.promises.readFile(args.input, 'utf8')) as unknown;
    const report = buildLocalAbsorptionTelemetryReportFromInputs(parseInputs(input));
    const rendered = `${JSON.stringify(report, null, 2)}\n`;

    if (args.out) {
        await fs.promises.writeFile(args.out, rendered, 'utf8');
    } else {
        process.stdout.write(rendered);
    }

    console.error(
        `local absorption telemetry: queues=${report.queueCount} sources=${report.totals.sources} invalidated=${report.totals.byReason.invalidated}`,
    );
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
