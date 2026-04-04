/* @Codex */
import type { DocumentDiagnosisSuggestion, DocumentInsight, DocumentQualityLevel } from './db';
/* @Codex */
import type { DocumentIntelligenceCasePack } from './document-intelligence-case-pack';
/* @Codex */
import {
    DOCUMENT_EVIDENCE_PACK_SCHEMA_VERSION,
    buildDocumentEvidencePack,
    type BuildDocumentEvidencePackInput,
    type DocumentEvidenceFact,
    type DocumentEvidencePack,
} from './document-evidence-pack';

/* @Codex */
export const DOCUMENT_PARSE_EVIDENCE_ARTIFACT_SCHEMA_VERSION = 'mediflow.document_parse_evidence_artifact.v1';

/* @Codex */
export interface DocumentParseEvidenceArtifact {
    schemaVersion: typeof DOCUMENT_PARSE_EVIDENCE_ARTIFACT_SCHEMA_VERSION;
    source: {
        documentInsightId: string;
        attachmentId?: string;
        fileName: string;
        documentDate: string;
        qualityLevel?: DocumentQualityLevel;
    };
    parseBundle: {
        summary: string;
        rawMarkdownExcerpt: string;
        parserDiagnostics: {
            rawTextChars: number;
            lineCount: number;
            qualityReason?: string;
        };
    };
    evidenceMemory: {
        facts: DocumentEvidenceFact[];
    };
}

/* @Codex */
export interface BuildDocumentParseEvidenceArtifactInput extends BuildDocumentEvidencePackInput {
    attachmentId?: string;
    qualityReason?: string;
}

/* @Codex */
export interface DocumentParseEvidenceArtifactEvaluation {
    presentKinds: DocumentEvidenceFact['kind'][];
    missingKinds: DocumentEvidenceFact['kind'][];
    leakedNegativeAssertions: string[];
}

/* @Codex */
function normalizeComparableText(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/* @Codex */
function countNonEmptyLines(value: string): number {
    return value
        .replace(/\r/g, '\n')
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .length;
}

/* @Codex */
function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/* @Codex */
export function buildDocumentParseEvidenceArtifact(
    input: BuildDocumentParseEvidenceArtifactInput,
): DocumentParseEvidenceArtifact {
    const evidencePack = buildDocumentEvidencePack(input);

    return {
        schemaVersion: DOCUMENT_PARSE_EVIDENCE_ARTIFACT_SCHEMA_VERSION,
        source: {
            documentInsightId: input.documentInsightId,
            attachmentId: input.attachmentId,
            fileName: input.fileName,
            documentDate: input.documentDate,
            qualityLevel: input.qualityLevel,
        },
        parseBundle: {
            summary: input.summary,
            rawMarkdownExcerpt: input.rawMarkdown,
            parserDiagnostics: {
                rawTextChars: input.rawMarkdown.length,
                lineCount: countNonEmptyLines(input.rawMarkdown),
                qualityReason: input.qualityReason,
            },
        },
        evidenceMemory: {
            facts: evidencePack.facts,
        },
    };
}

/* @Codex */
export function projectDocumentEvidencePack(
    artifact: DocumentParseEvidenceArtifact,
): DocumentEvidencePack {
    return {
        schemaVersion: DOCUMENT_EVIDENCE_PACK_SCHEMA_VERSION,
        source: {
            documentInsightId: artifact.source.documentInsightId,
            fileName: artifact.source.fileName,
            documentDate: artifact.source.documentDate,
            qualityLevel: artifact.source.qualityLevel,
        },
        facts: artifact.evidenceMemory.facts,
    };
}

/* @Codex */
export function projectDocumentInsightFromArtifact(
    artifact: DocumentParseEvidenceArtifact,
): DocumentInsight {
    const qualityLevel = artifact.source.qualityLevel
        || (artifact.parseBundle.parserDiagnostics.qualityReason ? 'yellow' : undefined);

    return {
        id: artifact.source.documentInsightId,
        attachmentId: artifact.source.attachmentId,
        date: new Date(artifact.source.documentDate),
        fileName: artifact.source.fileName,
        rawMarkdown: artifact.parseBundle.rawMarkdownExcerpt,
        summary: artifact.parseBundle.summary,
        quality: qualityLevel
            ? {
                level: qualityLevel,
                ...(artifact.parseBundle.parserDiagnostics.qualityReason
                    ? { reason: artifact.parseBundle.parserDiagnostics.qualityReason }
                    : {}),
            }
            : undefined,
        evidencePack: projectDocumentEvidencePack(artifact),
    };
}

/* @Codex */
export function serializeDocumentParseEvidenceArtifact(
    artifact: DocumentParseEvidenceArtifact,
): string {
    return JSON.stringify(artifact);
}

/* @Codex */
export function parseDocumentParseEvidenceArtifactSnapshot(
    value: unknown,
): DocumentParseEvidenceArtifact | undefined {
    const parsed = typeof value === 'string'
        ? (() => {
            try {
                return JSON.parse(value) as unknown;
            } catch {
                return undefined;
            }
        })()
        : value;

    if (!isRecord(parsed)) return undefined;
    if (parsed.schemaVersion !== DOCUMENT_PARSE_EVIDENCE_ARTIFACT_SCHEMA_VERSION) return undefined;
    if (!isRecord(parsed.source) || !isRecord(parsed.parseBundle) || !isRecord(parsed.evidenceMemory)) return undefined;
    if (
        typeof parsed.source.documentInsightId !== 'string'
        || typeof parsed.source.fileName !== 'string'
        || typeof parsed.source.documentDate !== 'string'
    ) {
        return undefined;
    }
    if (
        typeof parsed.parseBundle.summary !== 'string'
        || typeof parsed.parseBundle.rawMarkdownExcerpt !== 'string'
        || !isRecord(parsed.parseBundle.parserDiagnostics)
        || typeof parsed.parseBundle.parserDiagnostics.rawTextChars !== 'number'
        || typeof parsed.parseBundle.parserDiagnostics.lineCount !== 'number'
        || !Array.isArray(parsed.evidenceMemory.facts)
    ) {
        return undefined;
    }

    return parsed as unknown as DocumentParseEvidenceArtifact;
}

/* @Codex */
export function evaluateDocumentParseEvidenceArtifact(
    casePack: DocumentIntelligenceCasePack,
    artifact: DocumentParseEvidenceArtifact,
): DocumentParseEvidenceArtifactEvaluation {
    const presentKinds = Array.from(new Set(artifact.evidenceMemory.facts.map((fact) => fact.kind)));
    const requiredKinds = casePack.expectedEvidencePack?.requiredKinds || [];
    const missingKinds = requiredKinds.filter((kind) => !presentKinds.includes(kind));

    const factSearchSpace = artifact.evidenceMemory.facts
        .flatMap((fact) => [fact.label, fact.excerpt])
        .map((value) => normalizeComparableText(value))
        .filter(Boolean);

    const leakedNegativeAssertions = casePack.negativeAssertions
        .filter((assertion) => {
            const normalized = normalizeComparableText(assertion.label);
            if (!normalized) return false;

            return factSearchSpace.some((candidate) => (
                candidate.includes(normalized)
                || normalized.includes(candidate)
            ));
        })
        .map((assertion) => assertion.label);

    return {
        presentKinds,
        missingKinds,
        leakedNegativeAssertions,
    };
}

/* @Codex */
export function toDocumentDiagnosisSuggestionsFromArtifactFacts(
    artifact: DocumentParseEvidenceArtifact,
): DocumentDiagnosisSuggestion[] {
    return artifact.evidenceMemory.facts
        .filter((fact) => fact.kind === 'problem' && fact.code && fact.system)
        .map((fact) => ({
            code: fact.code as string,
            description: fact.label,
            system: fact.system as DocumentDiagnosisSuggestion['system'],
            evidence: fact.excerpt,
            confidence: fact.origin === 'documented' ? 'high' : 'medium',
        }));
}
