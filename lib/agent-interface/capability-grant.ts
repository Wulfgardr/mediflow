/* @Codex */
import {
    AGENT_INTERFACE_CAPABILITY_SCHEMA,
    AGENT_INTERFACE_MANIFEST_SCHEMA,
    type AgentInterfaceCapability,
    type AgentInterfaceSourceClassifications,
    type AgentInterfaceSourceKind,
    type AgentInterfaceStage,
    validateAgentInterfaceManifest,
} from './manifest.ts';

export type AgentDelegableStage = Exclude<AgentInterfaceStage, 'apply'>;
const DELEGABLE_STAGES = new Set<AgentDelegableStage>(['observe', 'read', 'compute', 'propose', 'preview']);
const STAGE_RANK: Readonly<Record<AgentDelegableStage, number>> = Object.freeze({ observe: 0, read: 1, compute: 2, propose: 3, preview: 4 });

/** Admission material only; broker-owned physician session and lease state remain mandatory. */
export type ManifestResolvedCapabilityGrant = Readonly<{
    capabilityId: string;
    manifestSchemaVersion: typeof AGENT_INTERFACE_MANIFEST_SCHEMA;
    capabilitySchemaVersion: typeof AGENT_INTERFACE_CAPABILITY_SCHEMA;
    headlessDisposition: 'available';
    authorityProfile: 'agent_session_context_lease';
    manifestMaximumStage: AgentDelegableStage;
    maximumStage: AgentDelegableStage;
    requiredContext: readonly string[];
    venue: readonly string[];
    egress: 'none';
    fallback: 'denied_by_contract';
    sources: AgentInterfaceSourceClassifications;
}>;

type FailureReason = 'MANIFEST_INVALID' | 'GRANT_REQUEST_INVALID' | 'CAPABILITY_NOT_FOUND'
    | 'CAPABILITY_NOT_GRANTABLE' | 'STAGE_NOT_DELEGABLE' | 'STAGE_EXCEEDS_MANIFEST'
    | 'GRANT_SNAPSHOT_INVALID' | 'GRANT_SNAPSHOT_MISMATCH';
export type AgentCapabilityGrantResolution = Readonly<{ ok: true; grant: ManifestResolvedCapabilityGrant }>
    | Readonly<{ ok: false; reason: FailureReason }>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isText(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}
function fail(reason: FailureReason): AgentCapabilityGrantResolution {
    return Object.freeze({ ok: false, reason });
}
function freezeSources(value: AgentInterfaceSourceClassifications): AgentInterfaceSourceClassifications {
    const copy: Partial<Record<AgentInterfaceSourceKind, readonly string[]>> = {};
    for (const [kind, identifiers] of Object.entries(value)) {
        copy[kind as AgentInterfaceSourceKind] = Object.freeze([...(identifiers ?? [])]);
    }
    return Object.freeze(copy);
}
// @Codex: malformed manifests fail before security-bound fields are copied.
export function resolveAgentCapabilityGrant(manifest: unknown, request: unknown): AgentCapabilityGrantResolution {
    try {
        const [manifestSnapshot, requestSnapshot] = structuredClone([manifest, request]);
        if (validateAgentInterfaceManifest(manifestSnapshot).length > 0) return fail('MANIFEST_INVALID');
        if (!isRecord(requestSnapshot) || !isText(requestSnapshot.capabilityId) || !isText(requestSnapshot.maximumStage)) return fail('GRANT_REQUEST_INVALID');
        if (!DELEGABLE_STAGES.has(requestSnapshot.maximumStage as AgentDelegableStage)) return fail('STAGE_NOT_DELEGABLE');
        const capability = (manifestSnapshot as readonly AgentInterfaceCapability[]).find((item) => item.id === requestSnapshot.capabilityId);
        if (!capability) return fail('CAPABILITY_NOT_FOUND');
        if (capability.headlessDisposition !== 'available' || capability.authorityProfile !== 'agent_session_context_lease') return fail('CAPABILITY_NOT_GRANTABLE');
        if (!DELEGABLE_STAGES.has(capability.maximumStage as AgentDelegableStage)) return fail('STAGE_NOT_DELEGABLE');
        const maximumStage = requestSnapshot.maximumStage as AgentDelegableStage;
        const manifestMaximumStage = capability.maximumStage as AgentDelegableStage;
        if (STAGE_RANK[maximumStage] > STAGE_RANK[manifestMaximumStage]) return fail('STAGE_EXCEEDS_MANIFEST');
        return Object.freeze({ ok: true, grant: Object.freeze({
            capabilityId: capability.id,
            manifestSchemaVersion: capability.schemaVersion,
            capabilitySchemaVersion: capability.capabilitySchemaVersion,
            headlessDisposition: 'available',
            authorityProfile: 'agent_session_context_lease',
            manifestMaximumStage,
            maximumStage,
            requiredContext: Object.freeze([...capability.requiredContext]),
            venue: Object.freeze([...capability.venue]),
            egress: capability.egress,
            fallback: capability.fallback,
            sources: freezeSources(capability.sources),
        }) });
    } catch {
        return fail('MANIFEST_INVALID');
    }
}

function sameArray(value: unknown, expected: readonly string[]): boolean {
    return Array.isArray(value) && Object.keys(value).length === value.length && Object.keys(value).every((key, index) => key === String(index)) && value.length === expected.length
        && value.every((item, index) => item === expected[index]);
}
function sameSources(value: unknown, expected: AgentInterfaceSourceClassifications): boolean {
    if (!isRecord(value) || Object.keys(value).length !== Object.keys(expected).length) return false;
    return Object.entries(expected).every(([kind, identifiers]) => sameArray(value[kind], identifiers ?? []));
}
// @Codex: candidate stays untrusted; success returns a fresh current-manifest snapshot.
export function revalidateAgentCapabilityGrant(manifest: unknown, candidate: unknown): AgentCapabilityGrantResolution {
    try {
        const [manifestSnapshot, candidateSnapshot] = structuredClone([manifest, candidate]);
        if (!isRecord(candidateSnapshot) || !isText(candidateSnapshot.capabilityId) || !isText(candidateSnapshot.maximumStage)) return fail('GRANT_SNAPSHOT_INVALID');
        const resolved = resolveAgentCapabilityGrant(manifestSnapshot, { capabilityId: candidateSnapshot.capabilityId, maximumStage: candidateSnapshot.maximumStage });
        if (!resolved.ok) return resolved;
        const grant = resolved.grant;
        const exact = Object.keys(candidateSnapshot).length === Object.keys(grant).length
            && candidateSnapshot.manifestSchemaVersion === grant.manifestSchemaVersion
            && candidateSnapshot.capabilitySchemaVersion === grant.capabilitySchemaVersion
            && candidateSnapshot.headlessDisposition === grant.headlessDisposition
            && candidateSnapshot.authorityProfile === grant.authorityProfile
            && candidateSnapshot.manifestMaximumStage === grant.manifestMaximumStage
            && candidateSnapshot.egress === grant.egress && candidateSnapshot.fallback === grant.fallback
            && sameArray(candidateSnapshot.requiredContext, grant.requiredContext)
            && sameArray(candidateSnapshot.venue, grant.venue) && sameSources(candidateSnapshot.sources, grant.sources);
        return exact ? resolved : fail('GRANT_SNAPSHOT_MISMATCH');
    } catch {
        return fail('GRANT_SNAPSHOT_INVALID');
    }
}
