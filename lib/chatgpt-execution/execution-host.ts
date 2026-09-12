/* @Codex — legacy utility compatibility; Mac custody lives in execution-mac-qualification. */
import 'server-only';
import type { spawn } from 'node:child_process';
import { ExecutionError, type ExecutionTransport } from './execution-contract';
import type { ExecutionDiagnostic } from './execution-transport';

/** Signal only the owned ChildProcess while its leader has not exited. */
export function terminateOwnedExecutionLeader(child: Pick<ReturnType<typeof spawn>, 'pid' | 'exitCode' | 'signalCode' | 'kill'> | undefined, signal: NodeJS.Signals): boolean {
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return false;
    try { return child.kill(signal); } catch { return false; }
}

/** Passive group observation only; errors/permission failures are not exit evidence. */
function groupAbsent(pid: number): boolean {
    try { process.kill(-pid, 0); return false; }
    catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; }
}

/** @internal Bounded host seam; tests inject observations without probing OS processes. */
export async function waitForOwnedExecutionGroupExit(pid: number | undefined, timeoutMs: number,
    observeAbsent: (pid: number) => boolean = groupAbsent): Promise<boolean> {
    // A failed spawn with no PID never created a group.
    if (pid === undefined) return true;
    if (!Number.isSafeInteger(pid) || pid <= 1 || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 1000) return false;
    const deadline = performance.now() + timeoutMs;
    do {
        try {
            const absent = observeAbsent(pid);
            if (performance.now() >= deadline) return false;
            if (absent === true) return true;
        } catch { return false; }
        const remaining = deadline - performance.now();
        if (remaining <= 0) return false;
        await new Promise(resolve => setTimeout(resolve, Math.min(20, remaining)));
    } while (performance.now() < deadline);
    return false;
}

export type QualifiedExecutionHost = Readonly<{
    transport: ExecutionTransport; cwd: string; boundaryQualified(): boolean;
    close(): Promise<boolean>; cleanupComplete(): boolean;
}>;

/** No sentinel, static pin or direct host call can grant product qualification.
 * Use prepareMacProductQualification + createReviewedMacProductPlatform. The
 * reviewed platform hands off the very process that supplied its evidence. */
export async function createQualifiedExecutionHost(_binaryPath: string, _lifetimeMs = 300_000,
    _diagnostic?: (event: ExecutionDiagnostic) => void): Promise<QualifiedExecutionHost> {
    throw new ExecutionError('unqualified_boundary');
}
