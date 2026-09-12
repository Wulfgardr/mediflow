/* @Codex — no process, network, helper discovery or platform emulation. */
import 'server-only';
import { ExecutionError } from './execution-contract';
import type { QualificationSnapshot } from '../chatgpt-product/product-contract';
export const LINUX_EXECUTION_QUALIFICATION: QualificationSnapshot = Object.freeze({ platform: 'linux', state: 'unsupported',
    revision: 'linux-whole-process-substrate-missing-v1', missing: Object.freeze([
        'linux.prelaunch-server-and-descendant-confinement', 'linux.owned-filesystem-ipc-egress-boundary',
        'linux.immutable-runtime-and-protocol-pins', 'linux.bounded-owned-resource-drain',
    ]) });
export async function createLinuxExecutionHost(): Promise<never> { throw new ExecutionError('unqualified_boundary'); }
