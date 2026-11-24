import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AgentCredential, AgentRegistrationCredential } from '../../packages/agent-client/src/credentials';
import {
    AGENT_PATIENT_CONTEXT_MAX_BYTES,
    AGENT_PATIENT_CONTEXT_SCHEMA,
    type AgentPatientContextEnvelope,
} from '../agent-local-kit-context-contract';

export class LocalKitPathError extends Error {
    constructor(readonly code: 'LOCAL_KIT_PATH_INVALID' | 'LOCAL_KIT_WRITE_FAILED' = 'LOCAL_KIT_PATH_INVALID') {
        super(code);
    }
}

const BLOCKED_HOME_FOLDERS = ['Documents', 'Desktop', 'Downloads', 'Library/Mobile Documents', 'Library/CloudStorage'];
const MAX_DEPOSITO_BYTES = 65536;
export const LOCAL_KIT_CONTEXT_DIR_NAME = 'contesto-pazienti';
const CONTEXT_FILE_RE = /^([a-f0-9]{64})\.json$/u;

function isInside(root: string, target: string): boolean {
    const relative = path.relative(root, target);
    return !relative || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

function isBlockedSyncedPath(candidate: string): boolean {
    const home = os.homedir();
    const blocked = BLOCKED_HOME_FOLDERS.map(relative => path.join(home, relative));
    if (blocked.some(root => isInside(root, candidate))) return true;
    const physicalBlocked = blocked.map(root => (fs.existsSync(root) ? fs.realpathSync(root) : root));
    return physicalBlocked.some(root => isInside(root, candidate));
}

function isOwnedByCurrentUser(stat: fs.Stats): boolean {
    return process.platform === 'win32' || stat.uid === process.getuid?.();
}

function isPrivateFile(stat: fs.Stats): boolean {
    return stat.isFile() && stat.nlink === 1 && isOwnedByCurrentUser(stat)
        && (process.platform === 'win32' || (stat.mode & 0o7777) === 0o600);
}

export function defaultLocalKitPath(): string {
    return path.join(os.homedir(), 'Antigravity', 'mf-ambulatorio-kit');
}

export function isValidLoopbackOrigin(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    try {
        const origin = new URL(value);
        return origin.origin === value && origin.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(origin.hostname);
    } catch {
        return false;
    }
}

export function validateLocalKitDirectory(rawPath: string): string {
    if (typeof rawPath !== 'string' || !rawPath.trim() || rawPath.trim() !== rawPath
        || /[\x00-\x1f\x7f]/u.test(rawPath) || !path.isAbsolute(rawPath)) {
        throw new LocalKitPathError('LOCAL_KIT_PATH_INVALID');
    }
    const resolved = path.resolve(rawPath);
    if (isBlockedSyncedPath(resolved)) throw new LocalKitPathError('LOCAL_KIT_PATH_INVALID');
    let stat: fs.Stats;
    try {
        stat = fs.lstatSync(resolved);
    } catch {
        throw new LocalKitPathError('LOCAL_KIT_PATH_INVALID');
    }
    if (stat.isSymbolicLink() || !stat.isDirectory() || !isOwnedByCurrentUser(stat)) {
        throw new LocalKitPathError('LOCAL_KIT_PATH_INVALID');
    }
    const physical = fs.realpathSync(resolved);
    if (isBlockedSyncedPath(physical)) throw new LocalKitPathError('LOCAL_KIT_PATH_INVALID');
    const physicalStat = fs.lstatSync(physical);
    if (physicalStat.isSymbolicLink() || !physicalStat.isDirectory() || !isOwnedByCurrentUser(physicalStat)) {
        throw new LocalKitPathError('LOCAL_KIT_PATH_INVALID');
    }
    return physical;
}

export function readDepositoJson(kitPath: string): Record<string, unknown> {
    const physicalKitDir = validateLocalKitDirectory(kitPath);
    const depositoPath = path.join(physicalKitDir, 'deposito.json');
    let fd: number | undefined;
    try {
        fd = fs.openSync(depositoPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        const stat = fs.fstatSync(fd);
        if (!stat.isFile() || stat.nlink !== 1 || !isOwnedByCurrentUser(stat) || stat.size > MAX_DEPOSITO_BYTES) {
            throw new LocalKitPathError('LOCAL_KIT_PATH_INVALID');
        }
        const parsed: unknown = JSON.parse(fs.readFileSync(fd, 'utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new LocalKitPathError('LOCAL_KIT_PATH_INVALID');
        }
        return parsed as Record<string, unknown>;
    } catch (error) {
        if (error instanceof LocalKitPathError) throw error;
        throw new LocalKitPathError('LOCAL_KIT_PATH_INVALID');
    } finally {
        if (fd !== undefined) fs.closeSync(fd);
    }
}

function physicalPathOf(target: string): string {
    const rest: string[] = [];
    let current = target;
    while (!fs.existsSync(current)) {
        const parent = path.dirname(current);
        if (parent === current) return target;
        rest.unshift(path.basename(current));
        current = parent;
    }
    return path.join(fs.realpathSync(current), ...rest);
}

export function resolveKitCredentialsDirectory(kitPath: string, deposito: Record<string, unknown>): string {
    const rawResolvedKit = path.resolve(kitPath);
    const physicalKitDir = validateLocalKitDirectory(kitPath);
    let relative: string;
    if (typeof deposito.credenziali === 'string' && deposito.credenziali.trim().length > 0) {
        const candidate = deposito.credenziali.trim();
        if (/[\x00-\x1f\x7f]/u.test(candidate) || !path.isAbsolute(candidate)) {
            throw new LocalKitPathError('LOCAL_KIT_PATH_INVALID');
        }
        const resolvedCandidate = physicalPathOf(path.resolve(candidate));
        if (isInside(physicalKitDir, resolvedCandidate)) {
            relative = path.relative(physicalKitDir, resolvedCandidate);
        } else if (isInside(rawResolvedKit, resolvedCandidate)) {
            relative = path.relative(rawResolvedKit, resolvedCandidate);
        } else {
            throw new LocalKitPathError('LOCAL_KIT_PATH_INVALID');
        }
        if (!relative || relative === '.' || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
            throw new LocalKitPathError('LOCAL_KIT_PATH_INVALID');
        }
    } else {
        relative = '.agente';
    }

    const segments = relative.split(path.sep).filter(Boolean);
    if (!segments.length) throw new LocalKitPathError('LOCAL_KIT_PATH_INVALID');

    let current = physicalKitDir;
    for (const segment of segments) {
        current = path.join(current, segment);
        if (fs.existsSync(current)) {
            const stat = fs.lstatSync(current);
            if (stat.isSymbolicLink() || !stat.isDirectory() || !isOwnedByCurrentUser(stat)) {
                throw new LocalKitPathError('LOCAL_KIT_PATH_INVALID');
            }
        }
    }

    if (!fs.existsSync(current)) {
        fs.mkdirSync(current, { recursive: true, mode: 0o700 });
    }
    const finalStat = fs.lstatSync(current);
    if (finalStat.isSymbolicLink() || !finalStat.isDirectory() || !isOwnedByCurrentUser(finalStat)
        || (process.platform !== 'win32' && (finalStat.mode & 0o7777) !== 0o700)) {
        throw new LocalKitPathError('LOCAL_KIT_PATH_INVALID');
    }
    return current;
}

function writeAtomicPrivateFile(directory: string, filename: string, content: string, requirePrivateExisting: boolean): void {
    const destination = path.join(directory, filename);
    try {
        const stat = fs.lstatSync(destination);
        if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1 || !isOwnedByCurrentUser(stat)
            || (requirePrivateExisting && !isPrivateFile(stat))) {
            throw new LocalKitPathError('LOCAL_KIT_WRITE_FAILED');
        }
    } catch (error) {
        if (error instanceof LocalKitPathError) throw error;
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new LocalKitPathError('LOCAL_KIT_WRITE_FAILED');
    }
    const temporary = path.join(directory, `.mediflow-${randomUUID()}.tmp`);
    let owned = false;
    try {
        const fd = fs.openSync(
            temporary,
            fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
            0o600,
        );
        owned = true;
        try {
            fs.writeFileSync(fd, content, 'utf8');
            fs.fsyncSync(fd);
        } finally {
            fs.closeSync(fd);
        }
        fs.renameSync(temporary, destination);
        owned = false;
    } catch {
        throw new LocalKitPathError('LOCAL_KIT_WRITE_FAILED');
    } finally {
        if (owned) fs.unlinkSync(temporary);
    }
}

export function writeLocalKitCredentials(
    kitPath: string,
    access: AgentCredential,
    registration: AgentRegistrationCredential,
): void {
    const physicalKitDir = validateLocalKitDirectory(kitPath);
    const deposito = readDepositoJson(physicalKitDir);
    const credsDir = resolveKitCredentialsDirectory(kitPath, deposito);
    const accessFile = `${access.agentRef}.json`;
    const registrationFile = `${registration.agentRef}.registration.json`;
    writeAtomicPrivateFile(credsDir, accessFile, JSON.stringify(access), true);
    writeAtomicPrivateFile(credsDir, registrationFile, JSON.stringify(registration), true);
    const updatedDeposito = { ...deposito, agente: access.agentRef };
    writeAtomicPrivateFile(physicalKitDir, 'deposito.json', JSON.stringify(updatedDeposito, null, 2) + '\n', false);
}

function unlinkSafeRegularFile(directory: string, filename: string): void {
    const target = path.join(directory, filename);
    let stat: fs.Stats;
    try {
        stat = fs.lstatSync(target);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw new LocalKitPathError('LOCAL_KIT_WRITE_FAILED');
    }
    if (stat.isSymbolicLink() || !stat.isFile() || !isOwnedByCurrentUser(stat)) {
        throw new LocalKitPathError('LOCAL_KIT_PATH_INVALID');
    }
    fs.unlinkSync(target);
}

export function removeLocalKitCredentials(kitPath: string, agentRef: string): void {
    if (!/^[a-f0-9-]{36}$/u.test(agentRef)) return;
    let physicalKitDir: string;
    try {
        physicalKitDir = validateLocalKitDirectory(kitPath);
    } catch {
        return;
    }
    let deposito: Record<string, unknown>;
    try {
        deposito = readDepositoJson(physicalKitDir);
    } catch {
        return;
    }
    try {
        const credsDir = resolveKitCredentialsDirectory(kitPath, deposito);
        unlinkSafeRegularFile(credsDir, `${agentRef}.json`);
        unlinkSafeRegularFile(credsDir, `${agentRef}.registration.json`);
    } catch {
    }
    if (deposito.agente === agentRef) {
        const updatedDeposito = { ...deposito, agente: null };
        writeAtomicPrivateFile(physicalKitDir, 'deposito.json', JSON.stringify(updatedDeposito, null, 2) + '\n', false);
    }
    try {
        clearLocalKitPatientContexts(physicalKitDir);
    } catch {
    }
}

function resolveKitContextDirectory(kitPath: string, createIfMissing: boolean): string | null {
    const physicalKitDir = validateLocalKitDirectory(kitPath);
    const contextDir = path.join(physicalKitDir, LOCAL_KIT_CONTEXT_DIR_NAME);
    if (!fs.existsSync(contextDir)) {
        if (!createIfMissing) return null;
        fs.mkdirSync(contextDir, { mode: 0o700 });
    }
    const stat = fs.lstatSync(contextDir);
    if (stat.isSymbolicLink() || !stat.isDirectory() || !isOwnedByCurrentUser(stat)
        || (process.platform !== 'win32' && (stat.mode & 0o7777) !== 0o700)) {
        throw new LocalKitPathError('LOCAL_KIT_PATH_INVALID');
    }
    return contextDir;
}

export type LocalKitPatientContextSummary = {
    cfHash: string;
    taxCodeLast4: string;
    exportedAt: number;
    expiresAt: number;
};

export function listLocalKitPatientContexts(kitPath: string, nowMs = Date.now()): LocalKitPatientContextSummary[] {
    const contextDir = resolveKitContextDirectory(kitPath, false);
    if (!contextDir) return [];
    const items: LocalKitPatientContextSummary[] = [];
    for (const name of fs.readdirSync(contextDir)) {
        const match = CONTEXT_FILE_RE.exec(name);
        if (!match) continue;
        const filePath = path.join(contextDir, name);
        let fd: number | undefined;
        try {
            fd = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
            const stat = fs.fstatSync(fd);
            if (!isPrivateFile(stat) || stat.size > AGENT_PATIENT_CONTEXT_MAX_BYTES + 4096) continue;
            const parsed = JSON.parse(fs.readFileSync(fd, 'utf8')) as Partial<AgentPatientContextEnvelope>;
            if (parsed.schema !== AGENT_PATIENT_CONTEXT_SCHEMA
                || typeof parsed.expiresAt !== 'number'
                || typeof parsed.exportedAt !== 'number'
                || !parsed.patient
                || parsed.patient.cfHash !== match[1]
                || typeof parsed.patient.taxCodeLast4 !== 'string') {
                continue;
            }
            if (parsed.expiresAt <= nowMs) {
                fs.closeSync(fd);
                fd = undefined;
                unlinkSafeRegularFile(contextDir, name);
                continue;
            }
            items.push({
                cfHash: match[1],
                taxCodeLast4: parsed.patient.taxCodeLast4,
                exportedAt: parsed.exportedAt,
                expiresAt: parsed.expiresAt,
            });
        } catch {
        } finally {
            if (fd !== undefined) fs.closeSync(fd);
        }
    }
    items.sort((a, b) => b.exportedAt - a.exportedAt);
    return items;
}

export function writeLocalKitPatientContext(kitPath: string, envelope: AgentPatientContextEnvelope, nowMs = Date.now()): void {
    const contextDir = resolveKitContextDirectory(kitPath, true);
    if (!contextDir) throw new LocalKitPathError('LOCAL_KIT_PATH_INVALID');
    const filename = `${envelope.patient.cfHash}.json`;
    if (!CONTEXT_FILE_RE.test(filename)) throw new LocalKitPathError('LOCAL_KIT_WRITE_FAILED');
    listLocalKitPatientContexts(kitPath, nowMs);
    writeAtomicPrivateFile(contextDir, filename, JSON.stringify(envelope, null, 2) + '\n', true);
}

export function removeLocalKitPatientContext(kitPath: string, cfHash: string): void {
    const filename = `${cfHash}.json`;
    if (!CONTEXT_FILE_RE.test(filename)) return;
    const contextDir = resolveKitContextDirectory(kitPath, false);
    if (!contextDir) return;
    unlinkSafeRegularFile(contextDir, filename);
}

export function clearLocalKitPatientContexts(kitPath: string): number {
    const contextDir = resolveKitContextDirectory(kitPath, false);
    if (!contextDir) return 0;
    let removed = 0;
    for (const name of fs.readdirSync(contextDir)) {
        if (!CONTEXT_FILE_RE.test(name)) continue;
        try {
            unlinkSafeRegularFile(contextDir, name);
            removed += 1;
        } catch {
        }
    }
    return removed;
}
