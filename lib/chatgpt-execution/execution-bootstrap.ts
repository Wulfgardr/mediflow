/* @Codex — host bootstrap expectations; contracts remain runtime-independent. */
import { dirname, isAbsolute, join, normalize } from 'node:path';
import { ExecutionError } from './execution-contract';
/** Pure bootstrap validation shared by login and the concrete issuer.
 * Parameterized inputs are expectations only: none of these helpers issues
 * custody, a transport, consent or an execution authority. This low-level
 * placement keeps the login -> issuer dependency acyclic. */
const object = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ExecutionError('protocol_error');
    return value as Record<string, unknown>;
};
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/u.test(value);

/* @Codex: current binary expectation, separate from the historical C1 receipt.
 * This declaration grants no authority. The Mac issuer verifies the actual
 * binary, version and all 24 freshly generated schema digests before initialize;
 * exact readback and privately owned, current custody are still required.
 */
const CURRENT_PROTOCOL_RUNTIME = Object.freeze({
    binaryVersion: '0.153.4',
    binarySha256: 'b973d440acac501fd2594a43e7ca9ce41e0a65b9dfb28d0d7a7837c99e1261e3',
} as const);

/** Shared request shape, not an observation. */
export function executionInitializationParams() {
    return { clientInfo: { name: 'mediflow_synthetic_product', title: 'MediFlow synthetic synthesis', version: '0.8.6' }, capabilities: { experimentalApi: true } };
}

/** Existing, pinned execution-host layout; no filesystem discovery or env read. */
export function expectedExecutionEnvironment(executionCwd: string) {
    if (!text(executionCwd, 4096) || !isAbsolute(executionCwd) || normalize(executionCwd) !== executionCwd
        || join(dirname(executionCwd), 'work') !== executionCwd) throw new ExecutionError('unqualified_boundary');
    const platformOs = process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : process.platform === 'linux' ? 'linux' : null;
    if (!platformOs) throw new ExecutionError('unqualified_boundary');
    return Object.freeze({ codexHome: join(dirname(executionCwd), 'codex'), platformOs, platformFamily: process.platform === 'win32' ? 'windows' : 'unix' });
}
export function assertExecutionInitialization(raw: unknown, executionCwd: string, substrate: Readonly<{ codexVersion: string; codexSha256: string }>): void {
    const response = object(raw), expected = expectedExecutionEnvironment(executionCwd);
    if (substrate.codexVersion !== CURRENT_PROTOCOL_RUNTIME.binaryVersion
        || substrate.codexSha256 !== CURRENT_PROTOCOL_RUNTIME.binarySha256
        || Object.keys(response).some(key => !['userAgent', 'codexHome', 'platformOs', 'platformFamily'].includes(key))
        || !text(response.userAgent, 1024)
        || !response.userAgent.split(/[^0-9A-Za-z.-]+/u).includes(CURRENT_PROTOCOL_RUNTIME.binaryVersion)
        || response.codexHome !== expected.codexHome || response.platformOs !== expected.platformOs
        || response.platformFamily !== expected.platformFamily) throw new ExecutionError('unqualified_boundary');
}

/** All fixed config expectations derive from the attached TOML, not invented keys. */
export function executionConfigFromToml(source: string): Readonly<Record<string, unknown>> {
    const root: Record<string, unknown> = {}; let section = root;
    for (const line of source.split('\n').map(line => line.trim()).filter(Boolean)) {
        if (line.startsWith('[')) {
            section = root;
            for (const part of line.slice(1, -1).split('.')) section = (section[part] ??= {}) as Record<string, unknown>;
        } else {
            const index = line.indexOf(' = ');
            if (index < 1) throw new ExecutionError('unqualified_boundary');
            section[line.slice(0, index)] = JSON.parse(line.slice(index + 3));
        }
    }
    return root;
}
