/* @Codex */
import 'server-only';
import type { QualifiedExecutionHost } from './execution-host';
import { readMacQualification, takeMacQualifiedHost } from './execution-mac-qualification';
import { ExecutionError } from './execution-contract';
import { EXECUTION_SUBSTRATE } from './execution-sandbox';
import { LINUX_EXECUTION_QUALIFICATION } from './execution-linux';
import { WINDOWS_EXECUTION_QUALIFICATION } from './execution-windows';
import type { QualificationSnapshot } from '../chatgpt-product/product-contract';

/** Host dependency, not a public registration/enable route. Fake only in tests. */
export type ProductExecutionPlatform = Readonly<{
    snapshot(): QualificationSnapshot;
    create(signal: AbortSignal): Promise<QualifiedExecutionHost>;
}>;
/** Read-only source disposition. Pin declarations alone never grant admission. */
export function executionPlatformSnapshot(platform: string = process.platform): QualificationSnapshot {
    if (platform === 'linux') return LINUX_EXECUTION_QUALIFICATION;
    if (platform === 'win32') return WINDOWS_EXECUTION_QUALIFICATION;
    return Object.freeze({ platform, state: platform === 'darwin' ? 'unqualified' : 'unsupported',
        revision: `held-${platform}-codex-${EXECUTION_SUBSTRATE.codexVersion}-v2`,
        missing: Object.freeze(platform === 'darwin' ? [
            // C1's supplied regeneration receipt is static evidence, not a current host witness.
            'protocol.current-runtime-pin-binding', 'protocol.exact-public-config-schema-and-readback',
            'macos.whole-process-descendants-outside-group', 'macos.current-substrate-requalification',
            'official-device-login-and-live-synthetic-acceptance',
        ] : ['platform.no-admitted-whole-process-adapter']) });
}
/**
 * Production intentionally has NO env flag, caller callback or synthetic success
 * escape. Parent must supply reviewed, version-specific qualification evidence
 * and an actual substrate adapter before replacing this held implementation.
 * The concrete candidate issuer exists, but this production root is still held.
 */
export function createProductionExecutionPlatform(): ProductExecutionPlatform {
    const snapshot = executionPlatformSnapshot();
    return Object.freeze({ snapshot: () => snapshot, async create() { throw new ExecutionError('unqualified_boundary'); } });
}

/** Structural consumer interface only. The concrete issuer privately brands its
 * authorities; this shape, a callback or deserialized receipt cannot qualify. */
export type MacProductQualificationAuthority = Readonly<{
    currentEvidence(): Readonly<{ revision: string; isCurrent(): boolean }> | null;
}>;
/** Explicit reviewed seam. No spawn here: transfer the very same observed host. */
export function createReviewedMacProductPlatform(options: {
    binaryPath: string; qualification: MacProductQualificationAuthority;
}): ProductExecutionPlatform {
    return Object.freeze({
        snapshot(): QualificationSnapshot {
            const evidence = readMacQualification(options.qualification, options.binaryPath);
            return evidence ? Object.freeze({ platform: 'darwin', state: 'qualified', revision: evidence.revision,
                missing: Object.freeze([]) }) : executionPlatformSnapshot();
        },
        create: (signal: AbortSignal) => takeMacQualifiedHost(options.qualification, options.binaryPath, signal),
    });
}
