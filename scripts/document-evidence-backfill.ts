#!/usr/bin/env node

/* @Codex */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import {
    DOCUMENT_EVIDENCE_BACKFILL_PLAN_SCHEMA_VERSION,
    buildDocumentEvidenceBackfillPlan,
    type DocumentEvidenceBackfillAttachmentInput,
    type DocumentEvidenceBackfillDecision,
    type DocumentEvidenceBackfillPlan,
} from '../lib/domain/documents/document-evidence-backfill';

type CliArgs = {
    input: string | null;
    out: string | null;
    markdownOut: string | null;
    rebuildExisting: boolean;
    redactSalt: string | null;
    help: boolean;
};

type RedactedBackfillPlanItem = {
    attachmentHash: string;
    patientHash: string;
    fileNameHash: string;
    fileKind: string;
    decision: DocumentEvidenceBackfillDecision;
    reason: string;
    textSource?: string;
    textChars: number;
    existingArtifactSnapshotPresent: boolean;
    existingArtifactValid: boolean;
    candidateMetrics?: DocumentEvidenceBackfillPlan['items'][number]['candidateMetrics'];
};

type RedactedBackfillPlan = {
    schemaVersion: 'mediflow.document_evidence_backfill_plan.redacted.v1';
    sourceSchemaVersion: typeof DOCUMENT_EVIDENCE_BACKFILL_PLAN_SCHEMA_VERSION;
    generatedAt: string;
    input: {
        pathHash: string;
        format: 'json' | 'jsonl';
    };
    options: DocumentEvidenceBackfillPlan['options'];
    redaction: {
        strategy: 'sha256-first-16';
        salt: 'provided' | 'random-run';
        rawTextIncluded: false;
        candidateArtifactsIncluded: false;
    };
    totals: DocumentEvidenceBackfillPlan['totals'];
    decisionCounts: Record<DocumentEvidenceBackfillDecision, number>;
    items: RedactedBackfillPlanItem[];
};

function usage(): string {
    return [
        'Usage:',
        '  npm run plan:document-evidence-backfill -- --input <attachments.json|jsonl> [--out plan.redacted.json] [--markdown-out plan.redacted.md] [--rebuild-existing] [--redact-salt <salt>]',
        '',
        'Input rows must contain id, patientId, fileName, createdAt, and optional summarySnapshot, rawMarkdown, parseEvidenceArtifactSnapshot, qualityStatus, qualityReason.',
        'The generated JSON/Markdown reports are redacted by default and do not include raw text or candidate artifacts.',
    ].join('\n');
}

function parseArgs(argv: string[]): CliArgs {
    const args: CliArgs = {
        input: null,
        out: null,
        markdownOut: null,
        rebuildExisting: false,
        redactSalt: null,
        help: false,
    };

    for (let index = 2; index < argv.length; index += 1) {
        const value = argv[index];

        if (value === '--help' || value === '-h') {
            args.help = true;
        } else if (value === '--input' && argv[index + 1]) {
            args.input = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--out' && argv[index + 1]) {
            args.out = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--markdown-out' && argv[index + 1]) {
            args.markdownOut = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--rebuild-existing') {
            args.rebuildExisting = true;
        } else if (value === '--redact-salt' && argv[index + 1]) {
            args.redactSalt = argv[index + 1];
            index += 1;
        } else {
            throw new Error(`Unknown or incomplete argument: ${value}`);
        }
    }

    return args;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function optionalString(value: unknown): string | null | undefined {
    if (value === null || value === undefined) return value;
    if (typeof value !== 'string') throw new Error('Optional text fields must be strings when present.');
    return value;
}

function normalizeAttachment(value: unknown, index: number): DocumentEvidenceBackfillAttachmentInput {
    if (!isRecord(value)) throw new Error(`Input row ${index + 1} is not an object.`);

    const { id, patientId, fileName, createdAt } = value;
    if (typeof id !== 'string' || !id.trim()) throw new Error(`Input row ${index + 1} is missing id.`);
    if (typeof patientId !== 'string' || !patientId.trim()) throw new Error(`Input row ${index + 1} is missing patientId.`);
    if (typeof fileName !== 'string' || !fileName.trim()) throw new Error(`Input row ${index + 1} is missing fileName.`);
    if (typeof createdAt !== 'string' || !createdAt.trim()) throw new Error(`Input row ${index + 1} is missing createdAt.`);

    const qualityStatus = value.qualityStatus;
    if (
        qualityStatus !== undefined
        && qualityStatus !== null
        && qualityStatus !== 'green'
        && qualityStatus !== 'yellow'
        && qualityStatus !== 'red'
    ) {
        throw new Error(`Input row ${index + 1} has invalid qualityStatus.`);
    }

    return {
        id,
        patientId,
        fileName,
        createdAt,
        summarySnapshot: optionalString(value.summarySnapshot),
        rawMarkdown: optionalString(value.rawMarkdown),
        parseEvidenceArtifactSnapshot: optionalString(value.parseEvidenceArtifactSnapshot),
        qualityStatus,
        qualityReason: optionalString(value.qualityReason),
    };
}

function readInput(filePath: string): {
    attachments: DocumentEvidenceBackfillAttachmentInput[];
    format: 'json' | 'jsonl';
} {
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (!raw) return { attachments: [], format: 'json' };

    if (raw.startsWith('[')) {
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) throw new Error('JSON input must be an array.');
        return {
            attachments: parsed.map((item, index) => normalizeAttachment(item, index)),
            format: 'json',
        };
    }

    const rows = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    return {
        attachments: rows.map((line, index) => normalizeAttachment(JSON.parse(line) as unknown, index)),
        format: 'jsonl',
    };
}

function hashValue(value: string, salt: string): string {
    return createHash('sha256')
        .update(salt)
        .update('\0')
        .update(value)
        .digest('hex')
        .slice(0, 16);
}

function fileKind(fileName: string): string {
    const extension = path.extname(fileName).toLowerCase();
    return extension && /^[.a-z0-9]+$/.test(extension) ? extension : 'unknown';
}

function emptyDecisionCounts(): Record<DocumentEvidenceBackfillDecision, number> {
    return {
        create_from_source: 0,
        create_from_summary: 0,
        rebuild_invalid_artifact: 0,
        skip_existing_artifact: 0,
        skip_no_usable_text: 0,
    };
}

function redactPlan(
    plan: DocumentEvidenceBackfillPlan,
    inputPath: string,
    inputFormat: 'json' | 'jsonl',
    salt: string,
    saltMode: 'provided' | 'random-run',
): RedactedBackfillPlan {
    const decisionCounts = plan.items.reduce((counts, item) => {
        counts[item.decision] += 1;
        return counts;
    }, emptyDecisionCounts());

    return {
        schemaVersion: 'mediflow.document_evidence_backfill_plan.redacted.v1',
        sourceSchemaVersion: DOCUMENT_EVIDENCE_BACKFILL_PLAN_SCHEMA_VERSION,
        generatedAt: plan.generatedAt,
        input: {
            pathHash: hashValue(inputPath, salt),
            format: inputFormat,
        },
        options: plan.options,
        redaction: {
            strategy: 'sha256-first-16',
            salt: saltMode,
            rawTextIncluded: false,
            candidateArtifactsIncluded: false,
        },
        totals: plan.totals,
        decisionCounts,
        items: plan.items.map((item) => ({
            attachmentHash: hashValue(item.attachmentId, salt),
            patientHash: hashValue(item.patientId, salt),
            fileNameHash: hashValue(item.fileName, salt),
            fileKind: fileKind(item.fileName),
            decision: item.decision,
            reason: item.reason,
            textSource: item.textSource,
            textChars: item.textChars,
            existingArtifactSnapshotPresent: item.existingArtifactSnapshotPresent,
            existingArtifactValid: item.existingArtifactValid,
            candidateMetrics: item.candidateMetrics,
        })),
    };
}

function escapeMarkdownCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function renderMarkdown(plan: RedactedBackfillPlan): string {
    const rows = plan.items.map((item) => [
        item.attachmentHash,
        item.patientHash,
        item.fileKind,
        item.decision,
        item.textSource || '',
        String(item.textChars),
        String(item.candidateMetrics?.factCount || 0),
        String(item.candidateMetrics?.suppressedCandidateCount || 0),
        (item.candidateMetrics?.factKinds || []).join(', '),
    ]);

    return [
        '# Document Evidence Backfill Plan',
        '',
        `Schema: \`${plan.schemaVersion}\``,
        `Generated: \`${plan.generatedAt}\``,
        `Input format: \`${plan.input.format}\``,
        `Rebuild existing: \`${plan.options.rebuildExisting}\``,
        '',
        '## Totals',
        '',
        `- Attachments: ${plan.totals.attachments}`,
        `- Candidates: ${plan.totals.candidates}`,
        `- Skipped existing: ${plan.totals.skippedExisting}`,
        `- Skipped no text: ${plan.totals.skippedNoText}`,
        `- Invalid existing artifacts: ${plan.totals.invalidExistingArtifacts}`,
        `- Candidate facts: ${plan.totals.candidateFacts}`,
        `- Candidate suppressed: ${plan.totals.candidateSuppressed}`,
        '',
        '## Items',
        '',
        '| Attachment | Patient | Kind | Decision | Source | Chars | Facts | Suppressed | Fact kinds |',
        '| --- | --- | --- | --- | --- | ---: | ---: | ---: | --- |',
        ...rows.map((row) => `| ${row.map(escapeMarkdownCell).join(' | ')} |`),
        '',
    ].join('\n');
}

function writeOutput(filePath: string, value: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, value);
}

function main(): void {
    const args = parseArgs(process.argv);
    if (args.help) {
        console.log(usage());
        return;
    }
    if (!args.input) throw new Error('Missing --input.\n\n' + usage());

    const { attachments, format } = readInput(args.input);
    const plan = buildDocumentEvidenceBackfillPlan(attachments, {
        rebuildExisting: args.rebuildExisting,
    });
    const salt = args.redactSalt || randomBytes(32).toString('hex');
    const redacted = redactPlan(plan, args.input, format, salt, args.redactSalt ? 'provided' : 'random-run');
    const json = JSON.stringify(redacted, null, 2) + '\n';

    if (args.out) {
        writeOutput(args.out, json);
    } else {
        process.stdout.write(json);
    }

    if (args.markdownOut) {
        writeOutput(args.markdownOut, renderMarkdown(redacted));
    }

    process.stderr.write([
        `document evidence backfill plan: ${redacted.totals.candidates}/${redacted.totals.attachments} candidates`,
        args.out ? `json: ${args.out}` : null,
        args.markdownOut ? `markdown: ${args.markdownOut}` : null,
    ].filter(Boolean).join('\n') + '\n');
}

try {
    main();
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
}
