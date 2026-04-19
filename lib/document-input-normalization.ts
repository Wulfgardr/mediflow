/* @Codex */
import { splitDocumentIntoLines } from './document-excerpt';

/* @Codex */
export type DocumentInputSourceKind = 'text' | 'ocr' | 'xml';

/* @Codex */
export type DocumentNormalizationDateHint = {
    raw: string;
    iso: string;
};

/* @Codex */
export type DocumentNormalizationSection = {
    heading: string;
    content: string;
};

/* @Codex */
export type DocumentNormalizationHints = {
    structuredNarrative: boolean;
    detectedHeadings: string[];
    normalizedDates: DocumentNormalizationDateHint[];
    negationPhrases: string[];
    temporalityPhrases: string[];
};

/* @Codex */
export type NormalizedDocumentInput = {
    sourceKind: DocumentInputSourceKind;
    normalizedText: string;
    sections: DocumentNormalizationSection[];
    hints: DocumentNormalizationHints;
};

/* @Codex */
type NormalizeDocumentInputOptions = {
    sourceKind?: DocumentInputSourceKind | 'auto';
};

/* @Codex */
const XML_SECTION_REGEX = /<(?:\w+:)?section\b[\s\S]*?<\/(?:\w+:)?section>/giu;
/* @Codex */
const XML_BREAK_TAG_REGEX = /<\/?(?:\w+:)?(?:br|p|paragraph|content|item|caption|tr|table|tbody|thead|ul|ol|list|entry|td|th)\b[^>]*>/giu;
/* @Codex */
const XML_TAG_REGEX = /<\/?(?:\w+:)?[A-Za-z0-9_-]+\b[^>]*>/gu;
/* @Codex */
const XML_ENTITY_MAP: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
};

/* @Codex */
const HEADING_KEYWORDS = [
    'anamnesi',
    'diagnosi',
    'terapia',
    'terapie',
    'farmaci',
    'allerg',
    'esami',
    'referto',
    'conclusioni',
    'indicazioni',
    'dimission',
    'ingresso',
    'valutazione',
    'follow',
    'controll',
    'decorso',
    'quesito',
    'esito',
    'motivo',
];

/* @Codex */
const HEADING_BOUNDARY_REGEX = new RegExp(
    `\\s{2,}(?=(?:${HEADING_KEYWORDS.join('|')})\\w*)`,
    'giu',
);

/* @Codex */
const NEGATION_PATTERNS = [
    /\bnega(?:to|ta|te|ti)?\b/giu,
    /\bnegativ[oaie]\b/giu,
    /\bassenza di\b/giu,
    /\bnon evidenza\b/giu,
    /\bnon si rileva\b/giu,
    /\bnon riferisce\b/giu,
    /\bsenza\b/giu,
];

/* @Codex */
const TEMPORALITY_PATTERNS = [
    /\banamnesi remota\b/giu,
    /\bpregress\w*\b/giu,
    /\bin passato\b/giu,
    /\bstoric\w*\b/giu,
    /\battual\w*\b/giu,
    /\bcronich\w*\b/giu,
    /\bfollow[\s-]?up\b/giu,
    /\bcontroll\w*\b/giu,
];

/* @Codex */
const DATE_TOKEN_REGEX = /\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/g;

/* @Codex */
function detectSourceKind(raw: string, requested: NormalizeDocumentInputOptions['sourceKind']): DocumentInputSourceKind {
    if (requested && requested !== 'auto') return requested;

    const trimmed = raw.trim();
    if (trimmed.startsWith('<') && /<(?:\w+:)?(?:ClinicalDocument|section|structuredBody|component)\b/i.test(trimmed)) {
        return 'xml';
    }

    const newlineCount = (raw.match(/\n/g) || []).length;
    const whitespaceBursts = (raw.match(/\s{2,}/g) || []).length;
    return newlineCount <= 2 && whitespaceBursts >= 4 ? 'ocr' : 'text';
}

/* @Codex */
function extractXmlTagContent(source: string, tagName: string): string {
    const pattern = new RegExp(
        `<(?:\\w+:)?${tagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tagName}>`,
        'iu',
    );
    return source.match(pattern)?.[1] ?? '';
}

/* @Codex */
function decodeXmlEntities(source: string): string {
    return source.replace(/&(#x?[0-9A-Fa-f]+|[A-Za-z]+);/g, (_, entity: string) => {
        if (entity.startsWith('#x') || entity.startsWith('#X')) {
            const codePoint = Number.parseInt(entity.slice(2), 16);
            return Number.isNaN(codePoint) ? '' : String.fromCodePoint(codePoint);
        }

        if (entity.startsWith('#')) {
            const codePoint = Number.parseInt(entity.slice(1), 10);
            return Number.isNaN(codePoint) ? '' : String.fromCodePoint(codePoint);
        }

        return XML_ENTITY_MAP[entity] ?? '';
    });
}

/* @Codex */
function normalizeHeadingLabel(value: string): string {
    const trimmed = value
        .replace(/\s+/g, ' ')
        .replace(/^[\s:;.,-]+|[\s:;.,-]+$/g, '')
        .trim();

    if (!trimmed) return '';
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/* @Codex */
function looksLikeHeading(line: string): boolean {
    const normalized = line
        .replace(/\s+/g, ' ')
        .replace(/[:;.,-]+$/g, '')
        .trim()
        .toLowerCase();

    if (!normalized || normalized.length > 80) return false;
    if (normalized.split(/\s+/).length > 7) return false;
    if (/\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b/.test(normalized)) return false;

    return HEADING_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

/* @Codex */
function extractInlineHeadingSection(line: string): DocumentNormalizationSection | null {
    const colonIndex = line.indexOf(':');
    if (colonIndex <= 0 || colonIndex > 80) return null;

    const heading = normalizeHeadingLabel(line.slice(0, colonIndex));
    const content = line.slice(colonIndex + 1).trim();
    if (!heading || !content || !looksLikeHeading(heading)) return null;

    return { heading, content };
}

/* @Codex */
function xmlFragmentToPlainText(fragment: string): string {
    return decodeXmlEntities(
        fragment
            .replace(/\r/g, '\n')
            .replace(XML_BREAK_TAG_REGEX, '\n')
            .replace(XML_TAG_REGEX, ' ')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/[ \t]{2,}/g, ' ')
            .trim(),
    );
}

/* @Codex */
function normalizeXmlSections(raw: string): { normalizedText: string; sections: DocumentNormalizationSection[] } {
    const matches = Array.from(raw.matchAll(XML_SECTION_REGEX));
    const sections: DocumentNormalizationSection[] = [];

    for (const match of matches) {
        const block = match[0];
        const heading = normalizeHeadingLabel(xmlFragmentToPlainText(extractXmlTagContent(block, 'title')));
        const content = xmlFragmentToPlainText(extractXmlTagContent(block, 'text'));

        if (!heading && !content) continue;
        sections.push({
            heading: heading || `Section ${sections.length + 1}`,
            content,
        });
    }

    if (sections.length === 0) {
        const fallbackContent = Array.from(
            raw.matchAll(/<(?:\w+:)?text\b[^>]*>([\s\S]*?)<\/(?:\w+:)?text>/giu),
        )
            .map((match) => xmlFragmentToPlainText(match[1]))
            .filter(Boolean)
            .join('\n\n');

        return {
            normalizedText: fallbackContent,
            sections: fallbackContent
                ? [{ heading: 'Narrative', content: fallbackContent }]
                : [],
        };
    }

    return {
        normalizedText: sections
            .map((section) => `${section.heading}:\n${section.content}`.trim())
            .join('\n\n'),
        sections,
    };
}

/* @Codex */
function normalizeFreeText(raw: string): { normalizedText: string; sections: DocumentNormalizationSection[] } {
    const cleaned = raw
        .replace(/\r/g, '\n')
        .replace(/([A-Za-zÀ-ÖØ-öø-ÿ])-\n(?=[A-Za-zÀ-ÖØ-öø-ÿ])/gu, '$1')
        .replace(/\u00A0/g, ' ')
        .replace(HEADING_BOUNDARY_REGEX, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    const lines = splitDocumentIntoLines(cleaned);
    const sections: DocumentNormalizationSection[] = [];
    const preamble: string[] = [];

    for (const line of lines) {
        const inlineSection = extractInlineHeadingSection(line);
        if (inlineSection) {
            sections.push(inlineSection);
            continue;
        }

        if (looksLikeHeading(line)) {
            sections.push({
                heading: normalizeHeadingLabel(line),
                content: '',
            });
            continue;
        }

        if (sections.length === 0) {
            preamble.push(line);
            continue;
        }

        const current = sections[sections.length - 1];
        current.content = current.content ? `${current.content}\n${line}` : line;
    }

    const normalizedSections = sections.filter((section) => section.content.trim().length > 0);
    const body = normalizedSections.length > 0
        ? [
            preamble.join('\n').trim(),
            ...normalizedSections.map((section) => `${section.heading}:\n${section.content}`.trim()),
        ]
            .filter(Boolean)
            .join('\n\n')
        : lines.join('\n');

    return {
        normalizedText: body,
        sections: normalizedSections,
    };
}

/* @Codex */
function collectNormalizedDates(text: string): DocumentNormalizationDateHint[] {
    const seen = new Set<string>();
    const dates: DocumentNormalizationDateHint[] = [];

    for (const match of text.matchAll(DATE_TOKEN_REGEX)) {
        const [raw, dayValue, monthValue, yearValue] = match;
        const day = Number.parseInt(dayValue, 10);
        const month = Number.parseInt(monthValue, 10);
        const year = Number.parseInt(yearValue.length === 2 ? `20${yearValue}` : yearValue, 10);

        if (
            Number.isNaN(day)
            || Number.isNaN(month)
            || Number.isNaN(year)
            || day < 1
            || day > 31
            || month < 1
            || month > 12
        ) {
            continue;
        }

        const iso = `${year.toString().padStart(4, '0')}-${monthValue.padStart(2, '0')}-${dayValue.padStart(2, '0')}`;
        const key = `${raw}|${iso}`;
        if (seen.has(key)) continue;

        seen.add(key);
        dates.push({ raw, iso });
    }

    return dates;
}

/* @Codex */
function collectPatternHits(text: string, patterns: RegExp[]): string[] {
    const seen = new Set<string>();
    const hits: string[] = [];

    for (const pattern of patterns) {
        for (const match of text.matchAll(pattern)) {
            const value = match[0].replace(/\s+/g, ' ').trim();
            if (!value) continue;

            const key = value.toLowerCase();
            if (seen.has(key)) continue;

            seen.add(key);
            hits.push(value);
        }
    }

    return hits;
}

/* @Codex */
export function normalizeDocumentInput(
    raw: string,
    options: NormalizeDocumentInputOptions = {},
): NormalizedDocumentInput {
    const sourceKind = detectSourceKind(raw, options.sourceKind);
    const base = sourceKind === 'xml' ? normalizeXmlSections(raw) : normalizeFreeText(raw);
    const normalizedText = base.normalizedText.trim() || raw.trim();

    return {
        sourceKind,
        normalizedText,
        sections: base.sections,
        hints: {
            structuredNarrative: sourceKind === 'xml' && base.sections.length > 0,
            detectedHeadings: base.sections.map((section) => section.heading),
            normalizedDates: collectNormalizedDates(normalizedText),
            negationPhrases: collectPatternHits(normalizedText, NEGATION_PATTERNS),
            temporalityPhrases: collectPatternHits(normalizedText, TEMPORALITY_PATTERNS),
        },
    };
}
