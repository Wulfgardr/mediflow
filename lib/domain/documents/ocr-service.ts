/* @Codex */
export interface RetiredOcrExtractionResult {
    readonly status: 'review_required';
    readonly reason: 'unsupported_local_extraction';
    readonly detail: 'image_or_scan';
    readonly rawMarkdown: '';
    readonly confidence: 0;
    readonly review: 'required';
    readonly writes: 0;
    readonly apply: 'none';
    readonly candidateUse: 'blocked';
}

/**
 * Compatibility boundary for historical callers.
 *
 * Automatic image and scan extraction is retired. This function intentionally
 * accepts the former call shape without inspecting the input or reaching a
 * model provider, and it can never authorize a write or candidate use.
 */
/* @Codex */
export async function extractDocumentWithAI(
    _imageBase64: unknown,
    _mode?: unknown,
    _provider?: unknown,
    _options?: unknown,
): Promise<RetiredOcrExtractionResult> {
    return {
        status: 'review_required',
        reason: 'unsupported_local_extraction',
        detail: 'image_or_scan',
        rawMarkdown: '',
        confidence: 0,
        review: 'required',
        writes: 0,
        apply: 'none',
        candidateUse: 'blocked',
    };
}

/** Terminal availability seam retained for compatibility checks. */
/* @Codex */
export async function isOcrModelAvailable(): Promise<false> {
    return false;
}
