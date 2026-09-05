/* @Codex */

export const DOCUMENT_SYNTHESIS_PREVIEW_WIRE_SCHEMA_VERSION = 'mediflow.document-synthesis.preview-wire.v1' as const;

type Citation = Readonly<{ label: string; quote: string; startByte: number; endByte: number; quoteSha256: string }>;
type ProviderReceipt = Readonly<{
    schemaVersion: 'mediflow.document-synthesis.provider-binding.v1'; capability: 'document_synthesis';
    registryTask: 'reasoning'; provider: 'ollama'; model: string; venue: 'local_process';
    egress: 'none'; fallback: 'none'; runtimeReadiness: 'required';
}>;
type FabricReceipt = Readonly<{
    schemaVersion: 'mediflow.ai.fabric-resolution.v1'; capability: 'document_synthesis'; class: 'generative';
    venue: 'local_process'; egressProfile: Readonly<{ id: 'local_only'; version: 'mediflow.ai.egress-profile.v1'; egress: 'none' }>;
    provider: 'ollama'; model: string; fallbackCount: 0;
}>;
export type DocumentSynthesisPreviewWire = Readonly<{
    schemaVersion: typeof DOCUMENT_SYNTHESIS_PREVIEW_WIRE_SCHEMA_VERSION;
    status: 'available';
    publication: Readonly<{
        output: Readonly<{ schemaVersion: 'mediflow.ai.extract.v1'; task: 'document_synthesis'; summary: string; qualityLevel: 'green' | 'yellow' | 'red' }>;
        citations: readonly Citation[];
        receipt: Readonly<{
            schemaVersion: 'mediflow.document-synthesis.publication-receipt.v1'; capability: 'document_synthesis';
            outputSha256: string; claimCitationsDigestSha256: readonly number[]; sourceSetDigestSha256: readonly number[];
            providerBindingReceipt: ProviderReceipt; reviewOnly: true; applyPolicy: 'none'; writesPerformed: 0;
        }>;
        provenance: Readonly<{
            schemaVersion: 'mediflow.document-synthesis.publication-provenance.v1'; capability: 'document_synthesis';
            sourceSetAuthority: 'application_host'; inputDigestScope: 'ordered_normalized_provider_projection_set';
            citationSupport: 'provider_declared_host_membership_and_locator_validated'; modelCausality: 'not_established';
            fabricProvenance: Readonly<{
                schemaVersion: 'mediflow.ai.fabric-provenance.v1'; capability: 'document_synthesis'; venue: 'local_process';
                provider: 'ollama'; model: string; preprocessing: readonly ['context_minimization']; receipt: FabricReceipt;
            }>;
        }>;
    }>;
}>;

const SHA = /^[a-f0-9]{64}$/u;
const LABEL = /^S(?:[1-9]|[12][0-9]|3[0-2])$/u;

function record(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) return null;
        const own = Reflect.ownKeys(value);
        if (own.length !== keys.length || own.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
        const output: Record<string, unknown> = Object.create(null);
        for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
            output[key] = descriptor.value;
        }
        return output;
    } catch { return null; }
}

function text(value: unknown, maximum: number): string | null {
    return typeof value === 'string' && value.length > 0 && value.length <= maximum
        && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) ? value : null;
}

function bytes(value: unknown): readonly number[] | null {
    if (!Array.isArray(value) || value.length !== 32) return null;
    const output: number[] = [];
    for (let index = 0; index < value.length; index += 1) {
        const byte = value[index];
        if (!Number.isSafeInteger(byte) || byte < 0 || byte > 255) return null;
        output[index] = byte;
    }
    return Object.freeze(output);
}

function citations(value: unknown): readonly Citation[] | null {
    if (!Array.isArray(value) || value.length < 1 || value.length > 32) return null;
    const output: Citation[] = [];
    for (let index = 0; index < value.length; index += 1) {
        const item = record(value[index], ['label', 'quote', 'startByte', 'endByte', 'quoteSha256']);
        const quote = item && text(item.quote, 12_000);
        if (!item || item.label !== `S${index + 1}` || !LABEL.test(item.label as string) || !quote
            || !Number.isSafeInteger(item.startByte) || !Number.isSafeInteger(item.endByte)
            || (item.startByte as number) < 0 || (item.endByte as number) <= (item.startByte as number)
            || typeof item.quoteSha256 !== 'string' || !SHA.test(item.quoteSha256)) return null;
        output[index] = Object.freeze({ label: item.label as string, quote, startByte: item.startByte as number, endByte: item.endByte as number, quoteSha256: item.quoteSha256 });
    }
    return Object.freeze(output);
}

function providerReceipt(value: unknown): ProviderReceipt | null {
    const item = record(value, ['schemaVersion', 'capability', 'registryTask', 'provider', 'model', 'venue', 'egress', 'fallback', 'runtimeReadiness']);
    const model = item && text(item.model, 256);
    return item && item.schemaVersion === 'mediflow.document-synthesis.provider-binding.v1' && item.capability === 'document_synthesis'
        && item.registryTask === 'reasoning' && item.provider === 'ollama' && model && item.venue === 'local_process'
        && item.egress === 'none' && item.fallback === 'none' && item.runtimeReadiness === 'required'
        ? Object.freeze({ schemaVersion: item.schemaVersion, capability: item.capability, registryTask: item.registryTask, provider: item.provider, model, venue: item.venue, egress: item.egress, fallback: item.fallback, runtimeReadiness: item.runtimeReadiness }) as ProviderReceipt : null;
}

function fabricReceipt(value: unknown): FabricReceipt | null {
    const item = record(value, ['schemaVersion', 'capability', 'class', 'venue', 'egressProfile', 'provider', 'model', 'fallbackCount'])
        ?? record(value, ['schemaVersion', 'capability', 'class', 'venue', 'egressProfile', 'provider', 'model', 'providerReceipt', 'fallbackCount']);
    const profile = item && record(item.egressProfile, ['id', 'version', 'egress']);
    const model = item && text(item.model, 256);
    if (!item || !profile || item.schemaVersion !== 'mediflow.ai.fabric-resolution.v1' || item.capability !== 'document_synthesis'
        || item.class !== 'generative' || item.venue !== 'local_process' || profile.id !== 'local_only'
        || profile.version !== 'mediflow.ai.egress-profile.v1' || profile.egress !== 'none' || item.provider !== 'ollama'
        || !model || item.fallbackCount !== 0) return null;
    return Object.freeze({ schemaVersion: item.schemaVersion, capability: item.capability, class: item.class, venue: item.venue, egressProfile: Object.freeze({ id: profile.id, version: profile.version, egress: profile.egress }), provider: item.provider, model, fallbackCount: 0 }) as FabricReceipt;
}

function publication(value: unknown, source: boolean): DocumentSynthesisPreviewWire['publication'] | null {
    const publication = source
        ? record(value, ['schemaVersion', 'output', 'citations', 'claims', 'receipt', 'provenance'])
        : record(value, ['output', 'citations', 'receipt', 'provenance']);
    const output = publication && (source
        ? record(publication.output, ['schemaVersion', 'task', 'summary', 'data'])
        : record(publication.output, ['schemaVersion', 'task', 'summary', 'qualityLevel']));
    const data = source && output
        ? (record(output.data, ['qualityLevel', 'medications', 'diagnoses', 'problemStatements', 'therapyCandidates', 'servicePrescriptions'])
            ?? record(output.data, ['qualityLevel', 'qualityReason', 'medications', 'diagnoses', 'problemStatements', 'therapyCandidates', 'servicePrescriptions']))
        : null;
    const qualityLevel = source ? data?.qualityLevel : output?.qualityLevel;
    const summary = output && text(output.summary, 700); const sourceCitations = publication && citations(publication.citations);
    const receipt = publication && record(publication.receipt, ['schemaVersion', 'capability', 'outputSha256', 'claimCitationsDigestSha256', 'sourceSetDigestSha256', 'providerBindingReceipt', 'reviewOnly', 'applyPolicy', 'writesPerformed']);
    const provider = receipt && providerReceipt(receipt.providerBindingReceipt); const claimDigest = receipt && bytes(receipt.claimCitationsDigestSha256); const sourceDigest = receipt && bytes(receipt.sourceSetDigestSha256);
    const provenance = publication && record(publication.provenance, ['schemaVersion', 'capability', 'sourceSetAuthority', 'inputDigestScope', 'citationSupport', 'modelCausality', 'fabricProvenance']);
    const fabric = provenance && record(provenance.fabricProvenance, ['schemaVersion', 'capability', 'venue', 'provider', 'model', 'preprocessing', 'receipt']);
    const resolution = fabric && fabricReceipt(fabric.receipt); const fabricModel = fabric && text(fabric.model, 256);
    if (!publication || (source && publication.schemaVersion !== 'mediflow.document-synthesis.publication.v1') || !output || !summary
        || output.schemaVersion !== 'mediflow.ai.extract.v1' || output.task !== 'document_synthesis'
        || !['green', 'yellow', 'red'].includes(qualityLevel as string) || !sourceCitations || !receipt || !provider || !claimDigest || !sourceDigest
        || receipt.schemaVersion !== 'mediflow.document-synthesis.publication-receipt.v1' || receipt.capability !== 'document_synthesis'
        || typeof receipt.outputSha256 !== 'string' || !SHA.test(receipt.outputSha256) || receipt.reviewOnly !== true || receipt.applyPolicy !== 'none' || receipt.writesPerformed !== 0
        || !provenance || provenance.schemaVersion !== 'mediflow.document-synthesis.publication-provenance.v1' || provenance.capability !== 'document_synthesis'
        || provenance.sourceSetAuthority !== 'application_host' || provenance.inputDigestScope !== 'ordered_normalized_provider_projection_set'
        || provenance.citationSupport !== 'provider_declared_host_membership_and_locator_validated' || provenance.modelCausality !== 'not_established'
        || !fabric || fabric.schemaVersion !== 'mediflow.ai.fabric-provenance.v1' || fabric.capability !== 'document_synthesis'
        || fabric.venue !== 'local_process' || fabric.provider !== 'ollama' || !fabricModel || !Array.isArray(fabric.preprocessing)
        || fabric.preprocessing.length !== 1 || fabric.preprocessing[0] !== 'context_minimization' || !resolution) return null;
    const wirePublication = Object.freeze({
        output: Object.freeze({ schemaVersion: 'mediflow.ai.extract.v1' as const, task: 'document_synthesis' as const, summary, qualityLevel: qualityLevel as 'green' | 'yellow' | 'red' }),
        citations: sourceCitations,
        receipt: Object.freeze({ schemaVersion: receipt.schemaVersion, capability: receipt.capability, outputSha256: receipt.outputSha256, claimCitationsDigestSha256: claimDigest, sourceSetDigestSha256: sourceDigest, providerBindingReceipt: provider, reviewOnly: true as const, applyPolicy: 'none' as const, writesPerformed: 0 as const }),
        provenance: Object.freeze({ schemaVersion: provenance.schemaVersion, capability: provenance.capability, sourceSetAuthority: provenance.sourceSetAuthority, inputDigestScope: provenance.inputDigestScope, citationSupport: provenance.citationSupport, modelCausality: provenance.modelCausality, fabricProvenance: Object.freeze({ schemaVersion: fabric.schemaVersion, capability: fabric.capability, venue: fabric.venue, provider: fabric.provider, model: fabricModel, preprocessing: Object.freeze(['context_minimization'] as const), receipt: resolution }) }),
    });
    return wirePublication as DocumentSynthesisPreviewWire['publication'];
}

export function serializeDocumentSynthesisPreviewWire(publication: unknown): DocumentSynthesisPreviewWire | null {
    const projected = publicationFromSource(publication);
    return projected ? Object.freeze({ schemaVersion: DOCUMENT_SYNTHESIS_PREVIEW_WIRE_SCHEMA_VERSION, status: 'available' as const, publication: projected }) : null;
}

function publicationFromSource(value: unknown): DocumentSynthesisPreviewWire['publication'] | null { return publication(value, true); }

export function parseDocumentSynthesisPreviewWire(value: unknown): DocumentSynthesisPreviewWire | null {
    const root = record(value, ['schemaVersion', 'status', 'publication']);
    if (!root || root.schemaVersion !== DOCUMENT_SYNTHESIS_PREVIEW_WIRE_SCHEMA_VERSION || root.status !== 'available') return null;
    const projected = publication(root.publication, false);
    return projected ? Object.freeze({ schemaVersion: DOCUMENT_SYNTHESIS_PREVIEW_WIRE_SCHEMA_VERSION, status: 'available' as const, publication: projected }) : null;
}
