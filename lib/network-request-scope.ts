/** An assertion about the already authenticated scope, never a scope grant. */
export const NETWORK_EXPECTED_SCOPE_HEADER = 'x-mediflow-expected-ambulatory-id';
export const NETWORK_SCOPE_REQUEST_BINDING = 'expected-ambulatory-id-v1';

export function bindNetworkRequestScope(request: Request, effectiveAmbulatoryId: string | null): string | null {
    if (!effectiveAmbulatoryId) return null;
    const expected = request.headers.get(NETWORK_EXPECTED_SCOPE_HEADER);
    // Existing clients retain their documented cookie/default resolution.
    if (expected === null) return effectiveAmbulatoryId;
    // Compare the canonical opaque-ID encoding directly. Empty, malformed,
    // double-encoded and combined duplicate header values cannot select a scope.
    try {
        return expected === encodeURIComponent(effectiveAmbulatoryId) ? effectiveAmbulatoryId : null;
    } catch {
        return null;
    }
}
