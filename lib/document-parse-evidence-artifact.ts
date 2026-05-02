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
    type DocumentEvidenceSourceGovernance,
} from './document-evidence-pack';
/* @Codex */
import { normalizeDocumentInput } from './document-input-normalization';

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
        sectionMap?: DocumentParseEvidenceSectionMap;
        parserDiagnostics: {
            rawTextChars: number;
            lineCount: number;
            qualityReason?: string;
        };
    };
    evidenceMemory: {
        facts: DocumentEvidenceFact[];
        sourceGovernance?: DocumentEvidenceSourceGovernance;
    };
}

/* @Codex */
export interface BuildDocumentParseEvidenceArtifactInput extends BuildDocumentEvidencePackInput {
    attachmentId?: string;
    qualityReason?: string;
}

/* @Codex */
export type DocumentParseEvidenceSectionKind =
    | 'diagnosis'
    | 'discharge_medication'
    | 'current_or_ward_medication'
    | 'recommendations'
    | 'followup'
    | 'functional_status'
    | 'care_setting'
    | 'other'
    | 'ambiguous';

/* @Codex */
export interface DocumentParseEvidenceSectionMap {
    sections: Array<{ id: string; order: number; page: number; title: string; kind: DocumentParseEvidenceSectionKind; snippet: string }>;
    factAnchors: Array<{
        factId: string;
        factKind: DocumentEvidenceFact['kind'];
        page: number;
        sectionId: string;
        sectionTitle: string;
        sectionKind: DocumentParseEvidenceSectionKind;
        snippet: string;
        confidence: 'exact' | 'section' | 'fallback';
    }>;
    conflicts: Array<{
        id: string;
        type: 'medication_context_overlap';
        factIds: string[];
        sectionIds: string[];
        message: string;
        snippets: string[];
    }>;
    diagnostics: {
        sectionCount: number;
        anchoredFactCount: number;
        unanchoredFactCount: number;
        conflictCount: number;
    };
}

type DocumentParseEvidenceSection = DocumentParseEvidenceSectionMap['sections'][number];
type DocumentParseEvidenceFactAnchor = DocumentParseEvidenceSectionMap['factAnchors'][number];

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

const MAX_SECTION_SNIPPET_CHARS = 260;
const MAX_ANCHOR_SNIPPET_CHARS = 220;

const MEDICATION_TOKEN_STOPWORDS = new Set('alla allo con del della delle dello degli dei di il la le lo nel nella nelle per terapia dimissione reparto corrente domiciliare sospendere sospesa sospeso proseguire assumere compressa compresse cp cps ore mattino sera pranzo cena die'.split(' '));

function compactForSection(value: string | null | undefined, maxChars: number): string {
    const normalized = (value ?? '').replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    return normalized.length <= maxChars
        ? normalized
        : `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}...`;
}

function classifySection(title: string, content = ''): DocumentParseEvidenceSectionKind {
    const normalized = normalizeComparableText(`${title} ${content.slice(0, 140)}`);
    if (!normalized) return 'other';
    if (/\bdiagnos\w*\b/.test(normalized)) return 'diagnosis';
    if (/\b(stato funzionale|deambul|cammino|autonomia|mobilit|ausilio)\b/.test(normalized)) return 'functional_status';
    if (/\b(adi|assistenza domiciliare|setting assistenziale|caregiver|rsa)\b/.test(normalized)) return 'care_setting';
    if (/\b(indicazion\w*|raccomandazion\w*|prescrizion\w*)\b/.test(normalized)) return 'recommendations';
    if (/\b(follow up|followup|controll\w*|visita|rivalut\w*)\b/.test(normalized)) return 'followup';
    if (/\bterapia\b/.test(normalized)) {
        if (/\b(dimission\w*|consigliata)\b/.test(normalized)) return 'discharge_medication';
        if (/\b(reparto|corrente|in atto|ingresso|domiciliare)\b/.test(normalized)) return 'current_or_ward_medication';
        return 'ambiguous';
    }
    return 'other';
}

function slugifySectionId(title: string, index: number): string {
    const slug = normalizeComparableText(title)
        .split(/\s+/)
        .slice(0, 6)
        .join('-');
    return `section:${index + 1}:${slug || 'untitled'}`;
}

function buildRawSections(rawMarkdown: string): Array<{ title: string; content: string }> {
    const normalized = normalizeDocumentInput(rawMarkdown);
    if (normalized.sections.length > 0) {
        return normalized.sections.map((section) => ({
            title: section.heading,
            content: section.content,
        }));
    }

    const fallback = normalized.normalizedText.trim() || rawMarkdown.trim();
    return fallback ? [{ title: 'Narrative', content: fallback }] : [];
}

function derivePageNumber(rawMarkdown: string, sectionText: string): number {
    const pages = rawMarkdown.split(/\f+/);
    if (pages.length <= 1) return 1;
    const sectionProbe = normalizeComparableText(sectionText).slice(0, 120);
    if (!sectionProbe) return 1;

    const index = pages.findIndex((page) => normalizeComparableText(page).includes(sectionProbe));
    return index >= 0 ? index + 1 : 1;
}

function buildSections(rawMarkdown: string): DocumentParseEvidenceSection[] {
    return buildRawSections(rawMarkdown).map((section, index) => ({
        id: slugifySectionId(section.title, index),
        order: index + 1,
        page: derivePageNumber(rawMarkdown, `${section.title} ${section.content}`),
        title: section.title,
        kind: classifySection(section.title, section.content),
        snippet: compactForSection(section.content, MAX_SECTION_SNIPPET_CHARS),
    }));
}

function sectionSearchText(section: DocumentParseEvidenceSection): string {
    return normalizeComparableText(`${section.title} ${section.snippet}`);
}

function bestSectionForFact(
    fact: DocumentEvidenceFact,
    sections: DocumentParseEvidenceSection[],
): { section: DocumentParseEvidenceSection; confidence: DocumentParseEvidenceFactAnchor['confidence'] } | undefined {
    if (sections.length === 0) return undefined;

    const label = normalizeComparableText(fact.label);
    const excerpt = normalizeComparableText(fact.excerpt);
    const exact = sections.find((section) => {
        const sectionText = sectionSearchText(section);
        return Boolean(label && sectionText.includes(label)) || Boolean(excerpt && sectionText.includes(excerpt));
    });
    if (exact) return { section: exact, confidence: 'exact' };

    const kindPreferred = sections.find((section) => {
        if (fact.kind === 'problem') return section.kind === 'diagnosis';
        if (fact.kind === 'followup') return section.kind === 'followup' || section.kind === 'recommendations';
        if (fact.kind === 'care_setting') return section.kind === 'care_setting' || section.kind === 'recommendations';
        if (fact.kind === 'functional_status') return section.kind === 'functional_status' || section.kind === 'recommendations';
        if (fact.kind === 'medication') {
            return section.kind === 'discharge_medication'
                || section.kind === 'current_or_ward_medication'
                || section.kind === 'ambiguous';
        }
        return false;
    });
    if (kindPreferred) return { section: kindPreferred, confidence: 'section' };

    return { section: sections[0], confidence: 'fallback' };
}

function buildFactAnchors(
    facts: DocumentEvidenceFact[],
    sections: DocumentParseEvidenceSection[],
): DocumentParseEvidenceFactAnchor[] {
    return facts
        .map((fact): DocumentParseEvidenceFactAnchor | undefined => {
            const match = bestSectionForFact(fact, sections);
            if (!match) return undefined;

            return {
                factId: fact.id,
                factKind: fact.kind,
                page: match.section.page,
                sectionId: match.section.id,
                sectionTitle: match.section.title,
                sectionKind: match.section.kind,
                snippet: compactForSection(fact.excerpt || match.section.snippet, MAX_ANCHOR_SNIPPET_CHARS),
                confidence: match.confidence,
            };
        })
        .filter((anchor): anchor is DocumentParseEvidenceFactAnchor => Boolean(anchor));
}

function medicationContextKey(label: string): string {
    const tokens = normalizeComparableText(label)
        .split(/\s+/)
        .filter((token) => token.length >= 4 && !/^\d/.test(token) && !MEDICATION_TOKEN_STOPWORDS.has(token));
    return tokens[0] || '';
}

function buildConflicts(
    facts: DocumentEvidenceFact[],
    anchors: DocumentParseEvidenceFactAnchor[],
): DocumentParseEvidenceSectionMap['conflicts'] {
    const conflicts: DocumentParseEvidenceSectionMap['conflicts'] = [];
    const medicationFactsById = new Map(facts.filter((fact) => fact.kind === 'medication').map((fact) => [fact.id, fact]));
    const medicationAnchors = anchors.filter((anchor) => medicationFactsById.has(anchor.factId));

    const byMedication = new Map<string, DocumentParseEvidenceFactAnchor[]>();
    for (const anchor of medicationAnchors) {
        const fact = medicationFactsById.get(anchor.factId);
        const key = fact ? medicationContextKey(fact.label) : '';
        if (!key) continue;
        const bucket = byMedication.get(key) || [];
        bucket.push(anchor);
        byMedication.set(key, bucket);
    }

    for (const [, bucket] of byMedication) {
        const contextualKinds = Array.from(new Set(bucket.map((anchor) => anchor.sectionKind).filter((kind) => (
            kind === 'discharge_medication' || kind === 'current_or_ward_medication'
        ))));
        if (contextualKinds.length < 2) continue;

        const factIds = Array.from(new Set(bucket.map((anchor) => anchor.factId)));
        const sectionIds = Array.from(new Set(bucket.map((anchor) => anchor.sectionId)));
        conflicts.push({
            id: `conflict:medication-context:${conflicts.length + 1}`,
            type: 'medication_context_overlap',
            factIds,
            sectionIds,
            message: 'Stesso farmaco riconosciuto in contesti terapeutici diversi: mantenere separati terapia corrente/reparto e terapia alla dimissione.',
            snippets: bucket.map((anchor) => anchor.snippet).slice(0, 4),
        });
    }

    return conflicts;
}

/* @Codex */
export function buildDocumentParseEvidenceSectionMap(
    rawMarkdown: string,
    facts: DocumentEvidenceFact[],
): DocumentParseEvidenceSectionMap {
    const sections = buildSections(rawMarkdown);
    const factAnchors = buildFactAnchors(facts, sections);
    const conflicts = buildConflicts(facts, factAnchors);

    return {
        sections,
        factAnchors,
        conflicts,
        diagnostics: {
            sectionCount: sections.length,
            anchoredFactCount: factAnchors.length,
            unanchoredFactCount: Math.max(0, facts.length - factAnchors.length),
            conflictCount: conflicts.length,
        },
    };
}

/* @Codex */
export function buildDocumentParseEvidenceArtifact(
    input: BuildDocumentParseEvidenceArtifactInput,
): DocumentParseEvidenceArtifact {
    const evidencePack = buildDocumentEvidencePack(input);
    const sectionMap = buildDocumentParseEvidenceSectionMap(input.rawMarkdown, evidencePack.facts);

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
            sectionMap,
            parserDiagnostics: {
                rawTextChars: input.rawMarkdown.length,
                lineCount: countNonEmptyLines(input.rawMarkdown),
                qualityReason: input.qualityReason,
            },
        },
        evidenceMemory: {
            facts: evidencePack.facts,
            sourceGovernance: evidencePack.sourceGovernance,
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
        sourceGovernance: artifact.evidenceMemory.sourceGovernance,
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
    if (
        parsed.evidenceMemory.sourceGovernance !== undefined
        && !isRecord(parsed.evidenceMemory.sourceGovernance)
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
