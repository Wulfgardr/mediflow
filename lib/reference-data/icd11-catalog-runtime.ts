import type { WhoCatalogStore } from './icd11-embedded-store';
import type { Icd11WhoLocalRuntime } from './icd11-who-local-runtime';
import { WHO_EMBEDDED_BINDING, type WhoEmbeddedReadiness, type WhoEmbeddedReceipt, type WhoEmbeddedSearchResult } from './icd11-embedded-contract';
import { Icd11WhoServiceError } from './icd11-who-service';
import { isWhoCheckCode, WHO_CODE_CHECK_SCHEMA, whoCodeInfoReference, type WhoCodeCheckReceipt, type WhoCodeCheckResult } from './icd11-who-code-check-contract';

export type Icd11WhoCatalogRuntime = Readonly<{
    readiness(): WhoEmbeddedReadiness | ReturnType<Icd11WhoLocalRuntime['readiness']>;
    search(query: string, signal?: AbortSignal): Promise<WhoEmbeddedSearchResult | Awaited<ReturnType<Icd11WhoLocalRuntime['search']>>>;
    checkCode(code: string, signal?: AbortSignal): Promise<WhoCodeCheckResult>;
}>;
export function createWhoCatalogRuntime(dependencies: {
    store: WhoCatalogStore; sidecar: Icd11WhoLocalRuntime; enabled(): boolean;
    auditSearch(receipt: WhoEmbeddedReceipt): Promise<unknown>;
    auditCodeCheck(receipt: WhoCodeCheckReceipt): Promise<unknown>;
}): Icd11WhoCatalogRuntime {
    const available = () => dependencies.enabled() && dependencies.store.status().state === 'ready';
    const sidecarAllowed = () => dependencies.store.status().state !== 'unverified'
        && dependencies.sidecar.readiness().status !== 'disabled';
    function readiness(): ReturnType<Icd11WhoCatalogRuntime['readiness']> {
        const s = dependencies.store.status(), enabled = dependencies.enabled();
        if (!available() && sidecarAllowed()) return dependencies.sidecar.readiness();
        return { schemaVersion: 'mediflow.reference-data.icd11-who-readiness.v3', status: !enabled ? 'disabled' : s.state === 'ready' ? 'available' : 'unavailable',
            releaseId: '2026-01', language: 'en', deployment: 'embedded', catalogState: s.state,
            datasetSnapshotId: s.manifest ? `sha256:${s.manifest.sha256}` : null };
    }
    const assertCurrent = (revision: number, signal?: AbortSignal) => {
        if (signal?.aborted) throw new Icd11WhoServiceError('request_cancelled');
        if (!available() || dependencies.store.status().revision !== revision) throw new Icd11WhoServiceError('upstream_unavailable');
    };
    async function search(query: string, signal?: AbortSignal) {
        if (!available()) {
            if (sidecarAllowed()) return dependencies.sidecar.search(query, signal);
            throw new Icd11WhoServiceError('upstream_unavailable');
        }
        const revision = dependencies.store.status().revision, started = Date.now();
        assertCurrent(revision, signal);
        const result = dependencies.store.search(query);
        const receipt: WhoEmbeddedReceipt = { schemaVersion: 'mediflow.reference-data.icd11-search-receipt.v3',
            operation: 'mediflow.reference_data.icd11.search.v3', source: 'embedded', releaseId: '2026-01', language: 'en',
            bindingId: WHO_EMBEDDED_BINDING, datasetSnapshotId: `sha256:${result.manifest.sha256}`,
            resultCount: result.entries.length, latencyMs: Date.now() - started, completedAt: new Date().toISOString() };
        try { await dependencies.auditSearch(receipt); } catch { throw new Icd11WhoServiceError('audit_unavailable'); }
        assertCurrent(revision, signal);
        return { entries: result.entries.map(row => ({ code: row.code, description: row.title, system: 'ICD-11' as const, canonicalUri: row.uri })),
            partial: result.partial, receipt };
    }
    async function checkCode(code: string, signal?: AbortSignal): Promise<WhoCodeCheckResult> {
        if (!isWhoCheckCode(code)) throw new Icd11WhoServiceError('input_invalid');
        if (!available()) {
            if (sidecarAllowed()) return dependencies.sidecar.checkCode(code, signal);
            throw new Icd11WhoServiceError('upstream_unavailable');
        }
        if (/[&/]/u.test(code)) throw new Icd11WhoServiceError('input_invalid');
        const s = dependencies.store.status(), started = Date.now();
        assertCurrent(s.revision, signal);
        const row = dependencies.store.findCode(code);
        const receipt: WhoCodeCheckReceipt = { schemaVersion: 'mediflow.reference-data.icd11-code-check-receipt.v1',
            operation: 'mediflow.reference_data.icd11.code_check.v1', source: 'embedded', releaseId: '2026-01', language: 'en',
            bindingId: WHO_EMBEDDED_BINDING, datasetSnapshotId: `sha256:${s.manifest!.sha256}`, found: row !== null,
            checkedAt: new Date().toISOString(), latencyMs: Date.now() - started };
        try { await dependencies.auditCodeCheck(receipt); } catch { throw new Icd11WhoServiceError('audit_unavailable'); }
        assertCurrent(s.revision, signal);
        return { schemaVersion: WHO_CODE_CHECK_SCHEMA, code, status: row ? 'found' : 'not_found',
            entry: row ? { canonicalUri: whoCodeInfoReference(code), stemUri: row.uri, stemCode: row.code, stemTitle: row.title } : null, receipt };
    }
    return { readiness, search, checkCode };
}
