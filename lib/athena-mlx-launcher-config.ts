/* @Codex */
import fs from 'node:fs';
import path from 'node:path';

/** Host-owned runner path only. Undefined is optional; invalid explicit values never select uvx. */
export function resolveAthenaMlxGenerateBin(value: string | undefined): string | undefined {
    if (value === undefined) return undefined;
    try {
        if (typeof value !== 'string' || value.length === 0 || value !== value.trim()
            || !path.isAbsolute(value) || path.basename(value) !== 'mlx_lm.generate') {
            throw new Error('invalid');
        }
        // Preserve the existing runner policy: follow host-owned links, require a regular executable.
        // This validates availability, not interpreter/model readiness or filesystem immutability.
        if (!fs.statSync(value).isFile()) throw new Error('invalid');
        fs.accessSync(value, fs.constants.X_OK);
    } catch {
        throw new Error('ATHENA MLX direct runner configuration rejected.');
    }
    return value;
}
