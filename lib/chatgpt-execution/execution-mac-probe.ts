/* boundary probe of the Mac container: targets, parsing and the per-build record.
 * The record is an observation for people and logs. It is never read back as an
 * authority: every preparation runs the probe again in its own confined process. */
import 'server-only';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { userInfo } from 'node:os';
import { dirname, isAbsolute, join, normalize, resolve } from 'node:path';
import { ExecutionError } from './execution-contract';

/** Same order and names as probe_names in mac-owner.c. */
export const MAC_BOUNDARY_PROBE_CHECKS = Object.freeze(['nproc', 'fork', 'spawn', 'thread', 'descriptors', 'owned_read',
    'owned_write', 'protected_write', 'protected_rename', 'outside_read', 'outside_write', 'home_read', 'data_read',
    'database_read', 'proxy_connect', 'loopback_other', 'unix_socket', 'mach_lookup', 'external_network'] as const);
export type MacBoundaryProbeCheck = typeof MAC_BOUNDARY_PROBE_CHECKS[number];
export type MacBoundaryProbeOutcome = 'passed' | 'failed' | 'absent';
export type MacOsSubstrate = Readonly<{ osBuild: string; osVersion: string }>;
export type MacBoundaryProbeRecord = Readonly<{
    schema: 'mediflow.mac-boundary-probe.v1';
    osBuild: string; osVersion: string; observedAt: string;
    codexSha256: string; dyldSupportSha256: string; profileSha256: string | null; probeProfileSha256: string | null;
    nativeHelperSha256: string | null;
    outcome: 'passed' | 'failed' | 'not_run';
    checks: Readonly<Partial<Record<MacBoundaryProbeCheck, MacBoundaryProbeOutcome>>>;
}>;

const BUILD = /^[0-9]{2}[A-Z][0-9]{1,5}[a-z]?$/u;
const VERSION = /^[0-9]{2}\.[0-9]{1,2}(?:\.[0-9]{1,2})?$/u;
/** Observed, never compared with a pinned value: the probe qualifies the build. */
export function readMacOsSubstrate(plist = '/System/Library/CoreServices/SystemVersion.plist'): MacOsSubstrate {
    const text = readFileSync(plist, 'utf8');
    const value = (key: string) => {
        const found = [...text.matchAll(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`, 'gu'))];
        return found.length === 1 ? found[0][1] : '';
    };
    const osBuild = value('ProductBuildVersion'), osVersion = value('ProductVersion');
    if (!BUILD.test(osBuild) || !VERSION.test(osVersion)) throw new ExecutionError('unqualified_boundary');
    return Object.freeze({ osBuild, osVersion });
}

/** Exact line, exact names and order; anything else is a probe that did not run. */
export function parseMacBoundaryProbeLine(text: string): Readonly<Record<MacBoundaryProbeCheck, MacBoundaryProbeOutcome>> | null {
    if (!/^MAC_PROBE_V2(?: [a-z_]+=[012]){19}\n$/u.test(text)) return null;
    const pairs = text.trim().split(' ').slice(1).map(pair => pair.split('='));
    if (pairs.length !== MAC_BOUNDARY_PROBE_CHECKS.length || pairs.some(([name], index) => name !== MAC_BOUNDARY_PROBE_CHECKS[index])) return null;
    const result: Record<string, MacBoundaryProbeOutcome> = {};
    for (const [name, value] of pairs) {
        // Only the database may be absent on a fresh station; nothing else.
        if (value === '2' && name !== 'database_read') return null;
        result[name] = value === '1' ? 'passed' : value === '2' ? 'absent' : 'failed';
    }
    return Object.freeze(result) as Readonly<Record<MacBoundaryProbeCheck, MacBoundaryProbeOutcome>>;
}
export function macBoundaryProbePassed(checks: MacBoundaryProbeRecord['checks']): boolean {
    return MAC_BOUNDARY_PROBE_CHECKS.every(name => checks[name] === 'passed' || name === 'database_read' && checks[name] === 'absent');
}

function safe(path: string): string {
    if (!isAbsolute(path) || normalize(path) !== path || path.length > 900 || /[\x00-\x1f\x7f]/u.test(path)) throw new ExecutionError('unqualified_boundary');
    return path;
}
function existingDirectory(path: string): string {
    let current = path;
    for (;;) {
        try { if (lstatSync(current).isDirectory()) return realpathSync(current); } catch { /* Walk up to what exists. */ }
        const parent = dirname(current);
        if (parent === current) throw new ExecutionError('unqualified_boundary');
        current = parent;
    }
}
function existingFile(path: string): boolean {
    try { return lstatSync(path).isFile(); } catch { return false; }
}
/** Real personal locations of this station, as the Web server resolves them.
 * The home comes from the account database, not from HOME. The probe only
 * attempts to open them inside the container; the host reads nothing here. */
export function macBoundaryProbeTargets(environment: NodeJS.ProcessEnv = process.env): string {
    const home = existingDirectory(safe(userInfo().homedir));
    const configured = environment.MEDIFLOW_DATA_DIR || join(userInfo().homedir, 'Library', 'Application Support', 'MediFlow');
    const data = existingDirectory(safe(resolve(configured)));
    const database = join(data, 'medical.db');
    const dns = '/var/run/mDNSResponder';
    return [home, data, existingFile(database) ? safe(database) : '-', (() => {
        try { return lstatSync(dns).isSocket() ? dns : '-'; } catch { return '-'; }
    })()].join('\n') + '\n';
}
