#!/usr/bin/env node

/* @Codex */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import {
    DOCUMENT_SOURCE_PROVENANCE_AUDIT_SCHEMA_VERSION,
    buildDocumentSourceProvenanceAuditReport,
    type DocumentSourceProvenanceArchiveCandidate,
    type DocumentSourceProvenanceAttachmentInput,
    type DocumentSourceProvenanceAuditReport,
    type DocumentSourceProvenanceCategory,
} from '../lib/domain/documents/document-source-provenance-audit';

type CliArgs = {
    input: string | null;
    out: string | null;
    markdownOut: string | null;
    redactSalt: string | null;
    minSummaryChars: number | null;
    help: boolean;
};

type RedactedProvenanceItem = {
    attachmentHash: string;
    patientHash: string;
    fileNameHash: string;
    fileKind: string;
    category: DocumentSourceProvenanceCategory;
    reason: string;
    nextStep: DocumentSourceProvenanceAuditReport['items'][number]['nextStep'];
    evidence: DocumentSourceProvenanceAuditReport['items'][number]['evidence'];
};

type RedactedProvenanceReport = {
    schemaVersion: 'mediflow.document_source_provenance_audit.redacted.v1';
    sourceSchemaVersion: typeof DOCUMENT_SOURCE_PROVENANCE_AUDIT_SCHEMA_VERSION;
    generatedAt: string;
    input: {
        pathHash: string;
        format: 'json' | 'jsonl';
    };
    redaction: {
        strategy: 'sha256-first-16';
        salt: 'provided' | 'random-run';
        rawTextIncluded: false;
        candidateArtifactsIncluded: false;
    };
    safety: DocumentSourceProvenanceAuditReport['safety'];
    options: DocumentSourceProvenanceAuditReport['options'];
    totals: DocumentSourceProvenanceAuditReport['totals'];
    items: RedactedProvenanceItem[];
};

function usage(): string {
    return [
        'Usage:',
        '  npm run audit:document-source-provenance -- --input <manifest.json|jsonl> [--out report.redacted.json] [--markdown-out report.redacted.md] [--min-summary-chars <n>] [--redact-salt <salt>]',
        '',
        'Input rows must contain id, patientId, fileName, and optional mimeType, storedBinaryBytes, hasStoredBinary, summarySnapshotChars, hasSummarySnapshot, archiveCandidates.',
        'The audit is read-only and emits redacted categories only: stored_binary, summary_only, archive_match_candidate, ambiguous, unrecoverable.',
    ].join('\n');
}

function parseArgs(argv: string[]): CliArgs {
    const args: CliArgs = {
        input: null,
        out: null,
        markdownOut: null,
        redactSalt: null,
        minSummaryChars: null,
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
        } else if (value === '--min-summary-chars' && argv[index + 1]) {
            args.minSummaryChars = Math.max(1, Number.parseInt(argv[index + 1], 10) || 24);
            index += 1;
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

function optionalBoolean(value: unknown, field: string): boolean | null | undefined {
    if (value === null || value === undefined) return value;
    if (typeof value !== 'boolean') throw new Error(`${field} must be boolean when present.`);
    return value;
}

function optionalString(value: unknown, field: string): string | null | undefined {
    if (value === null || value === undefined) return value;
    if (typeof value !== 'string') throw new Error(`${field} must be string when present.`);
    return value;
}

function optionalNumber(value: unknown, field: string): number | null | undefined {
    if (value === null || value === undefined) return value;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`${field} must be a finite number when present.`);
    }
    return value;
}

function normalizeArchiveCandidate(value: unknown, rowIndex: number, candidateIndex: number): DocumentSourceProvenanceArchiveCandidate {
    if (!isRecord(value)) {
        throw new Error(`Input row ${rowIndex + 1} archive candidate ${candidateIndex + 1} is not an object.`);
    }
    if (
        value.matchKind !== 'hash'
        && value.matchKind !== 'filename'
        && value.matchKind !== 'metadata'
        && value.matchKind !== 'byte_size'
    ) {
        throw new Error(`Input row ${rowIndex + 1} archive candidate ${candidateIndex + 1} has invalid matchKind.`);
    }
    if (typeof value.patientScoped !== 'boolean') {
        throw new Error(`Input row ${rowIndex + 1} archive candidate ${candidateIndex + 1} is missing patientScoped.`);
    }

    return {
        matchKind: value.matchKind,
        patientScoped: value.patientScoped,
        collisionCount: optionalNumber(value.collisionCount, 'collisionCount'),
        bytes: optionalNumber(value.bytes, 'bytes'),
    };
}

function normalizeAttachment(value: unknown, index: number): DocumentSourceProvenanceAttachmentInput {
    if (!isRecord(value)) throw new Error(`Input row ${index + 1} is not an object.`);
    const { id, patientId, fileName } = value;
    if (typeof id !== 'string' || !id.trim()) throw new Error(`Input row ${index + 1} is missing id.`);
    if (typeof patientId !== 'string' || !patientId.trim()) throw new Error(`Input row ${index + 1} is missing patientId.`);
    if (typeof fileName !== 'string' || !fileName.trim()) throw new Error(`Input row ${index + 1} is missing fileName.`);

    const archiveCandidates = value.archiveCandidates === null || value.archiveCandidates === undefined
        ? value.archiveCandidates
        : Array.isArray(value.archiveCandidates)
            ? value.archiveCandidates.map((candidate, candidateIndex) => normalizeArchiveCandidate(candidate, index, candidateIndex))
            : undefined;
    if (value.archiveCandidates !== null && value.archiveCandidates !== undefined && !Array.isArray(value.archiveCandidates)) {
        throw new Error(`Input row ${index + 1} archiveCandidates must be an array when present.`);
    }

    return {
        id,
        patientId,
        fileName,
        mimeType: optionalString(value.mimeType, 'mimeType'),
        storedBinaryBytes: optionalNumber(value.storedBinaryBytes, 'storedBinaryBytes'),
        hasStoredBinary: optionalBoolean(value.hasStoredBinary, 'hasStoredBinary'),
        summarySnapshotChars: optionalNumber(value.summarySnapshotChars, 'summarySnapshotChars'),
        hasSummarySnapshot: optionalBoolean(value.hasSummarySnapshot, 'hasSummarySnapshot'),
        archiveCandidates,
    };
}

function readInput(filePath: string): {
    attachments: DocumentSourceProvenanceAttachmentInput[];
    format: 'json' | 'jsonl';
} {
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (!raw) return { attachments: [], format: 'json' };
    if (raw.startsWith('[')) {
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) throw new Error('JSON input must be an array.');
        return { attachments: parsed.map((item, index) => normalizeAttachment(item, index)), format: 'json' };
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

function redactReport(
    report: DocumentSourceProvenanceAuditReport,
    inputPath: string,
    inputFormat: 'json' | 'jsonl',
    salt: string,
    saltMode: 'provided' | 'random-run',
): RedactedProvenanceReport {
    return {
        schemaVersion: 'mediflow.document_source_provenance_audit.redacted.v1',
        sourceSchemaVersion: DOCUMENT_SOURCE_PROVENANCE_AUDIT_SCHEMA_VERSION,
        generatedAt: report.generatedAt,
        input: {
            pathHash: hashValue(inputPath, salt),
            format: inputFormat,
        },
        redaction: {
            strategy: 'sha256-first-16',
            salt: saltMode,
            rawTextIncluded: false,
            candidateArtifactsIncluded: false,
        },
        safety: report.safety,
        options: report.options,
        totals: report.totals,
        items: report.items.map((item) => ({
            attachmentHash: hashValue(item.attachmentId, salt),
            patientHash: hashValue(item.patientId, salt),
            fileNameHash: hashValue(item.fileName, salt),
            fileKind: item.fileKind,
            category: item.category,
            reason: item.reason,
            nextStep: item.nextStep,
            evidence: item.evidence,
        })),
    };
}

function escapeMarkdownCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function renderMarkdown(report: RedactedProvenanceReport): string {
    const rows = report.items.map((item) => [
        item.attachmentHash,
        item.patientHash,
        item.fileKind,
        item.category,
        item.nextStep,
        String(item.evidence.storedBinaryBytes),
        String(item.evidence.summarySnapshotChars),
        String(item.evidence.archiveCandidateCount),
        String(item.evidence.safeArchiveCandidateCount),
    ]);

    return [
        '# Document Source Provenance Audit',
        '',
        `Schema: \`${report.schemaVersion}\``,
        `Generated: \`${report.generatedAt}\``,
        `Input format: \`${report.input.format}\``,
        `Read-only: \`${report.safety.readOnly}\``,
        `Writes attempted: \`${report.safety.writesAttempted}\``,
        `Future apply requires WUL-202 gate: \`${report.safety.futureApplyRequiresWul202Gate}\``,
        '',
        '## Totals',
        '',
        `- Attachments: ${report.totals.attachments}`,
        `- Stored binary: ${report.totals.storedBinary}`,
        `- Summary only: ${report.totals.summaryOnly}`,
        `- Archive match candidate: ${report.totals.archiveMatchCandidate}`,
        `- Ambiguous: ${report.totals.ambiguous}`,
        `- Unrecoverable: ${report.totals.unrecoverable}`,
        '',
        '## Items',
        '',
        '| Attachment | Patient | Kind | Category | Next step | Binary bytes | Summary chars | Archive candidates | Safe archive candidates |',
        '| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: |',
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
    const report = buildDocumentSourceProvenanceAuditReport(attachments, {
        minSummaryChars: args.minSummaryChars ?? undefined,
    });
    const salt = args.redactSalt || randomBytes(32).toString('hex');
    const redacted = redactReport(report, args.input, format, salt, args.redactSalt ? 'provided' : 'random-run');
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
        `document source provenance audit: ${redacted.totals.attachments} attachments`,
        `stored_binary=${redacted.totals.storedBinary}`,
        `summary_only=${redacted.totals.summaryOnly}`,
        `archive_match_candidate=${redacted.totals.archiveMatchCandidate}`,
        `ambiguous=${redacted.totals.ambiguous}`,
        `unrecoverable=${redacted.totals.unrecoverable}`,
    ].join(' ') + '\n');
}

try {
    main();
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
}
