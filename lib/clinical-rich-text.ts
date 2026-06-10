/* @Codex */
const ALLOWED_RICH_TEXT_TAGS = new Set([
    'p',
    'br',
    'strong',
    'em',
    'u',
    's',
    'ul',
    'ol',
    'li',
    'h1',
    'h2',
    'h3',
    'blockquote',
]);

const RICH_TEXT_HTML_PATTERN = /<\/?(?:p|br|strong|em|u|s|ul|ol|li|h[1-3]|blockquote|b|i|strike|div)\b/i;

/* @Codex */
// Matches any `<` that does NOT begin a reconstructed allowed tag token (`<tag>` or
// `</tag>`). After the allowlist pass below every legitimate tag is emitted without
// attributes, so anything else (malformed/unterminated tags the tag regex could not
// strip) is neutralized by escaping its `<` to `&lt;`.
const RESIDUAL_RICH_TEXT_LT_PATTERN = new RegExp(
    `<(?!/?(?:${Array.from(ALLOWED_RICH_TEXT_TAGS).join('|')})>)`,
    'gi',
);

const HTML_ENTITY_MAP: Record<string, string> = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
};

function decodeHtmlEntities(value: string): string {
    return value.replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (entity) => HTML_ENTITY_MAP[entity] ?? entity);
}

function normalizeRichTextAliases(value: string): string {
    return value
        .replace(/<\s*\/?\s*div\b[^>]*>/gi, (match) => (match.includes('/') ? '</p>' : '<p>'))
        .replace(/<\s*b\b[^>]*>/gi, '<strong>')
        .replace(/<\s*\/\s*b\s*>/gi, '</strong>')
        .replace(/<\s*i\b[^>]*>/gi, '<em>')
        .replace(/<\s*\/\s*i\s*>/gi, '</em>')
        .replace(/<\s*(?:strike|del)\b[^>]*>/gi, '<s>')
        .replace(/<\s*\/\s*(?:strike|del)\s*>/gi, '</s>')
        .replace(/<\s*br\s*\/?\s*>/gi, '<br>');
}

export function isClinicalRichTextHtml(value: string | null | undefined): boolean {
    return Boolean(value && RICH_TEXT_HTML_PATTERN.test(value));
}

export function sanitizeClinicalRichTextHtml(value: string | null | undefined): string {
    const input = value?.trim();
    if (!input) return '';

    let normalized = normalizeRichTextAliases(input)
        .replace(/<(script|style|iframe|object|embed|meta|link)[^>]*>[\s\S]*?<\/\1>/gi, '')
        .replace(/<(script|style|iframe|object|embed|meta|link)[^>]*\/?>/gi, '');

    // Browsers accept `/` (and whitespace) as the separator between a tag name and its
    // attributes, so `<img/src=x onerror=...>` must be matched here too; otherwise it
    // slips past the allowlist untouched. See RESIDUAL_RICH_TEXT_LT_PATTERN for the
    // unterminated-tag backstop.
    normalized = normalized.replace(/<(\/?)([a-z0-9]+)(?:[\s/][^>]*)?>/gi, (_match, slash: string, rawTag: string) => {
        const tag = rawTag.toLowerCase();
        if (!ALLOWED_RICH_TEXT_TAGS.has(tag)) return '';
        if (tag === 'br') return '<br>';
        return `<${slash}${tag}>`;
    });

    return normalized
        .replace(/<(p|h1|h2|h3|blockquote)>\s*<\/\1>/gi, '')
        .replace(/(?:<br>\s*){3,}/gi, '<br><br>')
        .replace(/\s+<\/(p|h1|h2|h3|blockquote|li|ul|ol)>/gi, '</$1>')
        .replace(RESIDUAL_RICH_TEXT_LT_PATTERN, '&lt;')
        .trim();
}

export function clinicalRichTextToPlainText(value: string | null | undefined): string {
    const input = value?.trim();
    if (!input) return '';

    const normalized = isClinicalRichTextHtml(input) ? sanitizeClinicalRichTextHtml(input) : input;

    return decodeHtmlEntities(
        normalized
            .replace(/<br>/gi, '\n')
            .replace(/<li>/gi, '\n- ')
            .replace(/<\/(?:p|h1|h2|h3|blockquote|ul|ol)>/gi, '\n')
            .replace(/<\/li>/gi, '')
            .replace(/<[^>]+>/g, ''),
    )
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/\n{2,}(?=- )/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export function compactClinicalRichText(value: string | null | undefined, maxChars = 220): string {
    const normalized = clinicalRichTextToPlainText(value).replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    if (normalized.length <= maxChars) return normalized;
    return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}...`;
}

export function isClinicalRichTextBlank(value: string | null | undefined): boolean {
    return clinicalRichTextToPlainText(value).replace(/\s+/g, '').length === 0;
}
