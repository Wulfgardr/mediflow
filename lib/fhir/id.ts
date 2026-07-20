/* @Codex */
function shortHash(value: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

/* @Codex */
export function toFhirDerivedId(
    prefix: string,
    parts: readonly string[],
    orderedPosition: number,
): string {
    const canonicalValue = parts.map((part) => `${part.length}:${part}`).join('|');
    return toFhirId(`${prefix}-${shortHash(canonicalValue)}-${orderedPosition}`, prefix);
}

/* @Codex */
export function toFhirId(value: string, fallbackPrefix: string): string {
    const normalized = value
        .trim()
        .replace(/[^A-Za-z0-9-.]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^[.-]+|[.-]+$/g, '');
    if (!normalized) return `${fallbackPrefix}-${shortHash(value)}`;

    const needsHash = normalized !== value || normalized.length > 64;
    if (!needsHash) return normalized;

    const suffix = `-${shortHash(value)}`;
    return `${normalized.slice(0, 64 - suffix.length)}${suffix}`;
}

/* @Codex */
export function toFhirFullUrl(resourceType: string, id: string): string {
    return `urn:mediflow:fhir:${resourceType}:${id}`;
}
