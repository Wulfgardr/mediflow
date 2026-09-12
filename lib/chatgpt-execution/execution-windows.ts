/* @Codex — an empty home or a nominal process group is not Windows confinement. */
import 'server-only';
import { ExecutionError } from './execution-contract';
import type { QualificationSnapshot } from '../chatgpt-product/product-contract';
export const WINDOWS_EXECUTION_QUALIFICATION: QualificationSnapshot = Object.freeze({ platform: 'win32', state: 'unsupported',
    revision: 'windows-whole-process-substrate-missing-v1', missing: Object.freeze([
        'windows.prelaunch-server-and-descendant-confinement', 'windows.filesystem-ipc-local-services-and-egress-boundary',
        'windows.immutable-runtime-and-protocol-pins', 'windows.non-escaping-owned-resources-and-bounded-drain',
    ]) });
export async function createWindowsExecutionHost(): Promise<never> { throw new ExecutionError('unqualified_boundary'); }
