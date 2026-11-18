import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

export type AgentRegistrationCredential = { agentRef: string; token: string; origin: string };
export type AgentCredential = { agentRef: string; mandateRef: string; token: string; expiresAt: number; origin: string };
const unavailable = () => new Error('AGENT_CREDENTIAL_UNAVAILABLE');
const inside = (root: string, target: string) => { const relative = path.relative(root, target); return !relative || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); };
export function defaultAgentCredentialDirectory(): string {
    return process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support', 'MediFlow Agents') : path.join(os.homedir(), '.mediflow-agents');
}
function credential(value: unknown): value is AgentCredential {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const item = value as AgentCredential;
    if (Object.keys(item).sort().join(',') !== 'agentRef,expiresAt,mandateRef,origin,token'
        || ![item.agentRef, item.mandateRef].every(ref => typeof ref === 'string' && /^[a-f0-9-]{36}$/u.test(ref))
        || typeof item.token !== 'string' || !/^mfa_[A-Za-z0-9_-]{43}$/u.test(item.token) || !Number.isSafeInteger(item.expiresAt)) return false;
    return validOrigin(item.origin);
}
function validOrigin(value: string): boolean {
    try {
        const origin = new URL(value);
        return origin.origin === value && origin.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(origin.hostname);
    } catch { return false; }
}
function registration(value: unknown): value is AgentRegistrationCredential {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const item = value as AgentRegistrationCredential;
    return Object.keys(item).sort().join(',') === 'agentRef,origin,token'
        && typeof item.agentRef === 'string' && /^[a-f0-9-]{36}$/u.test(item.agentRef)
        && typeof item.token === 'string' && /^mfr_[A-Za-z0-9_-]{43}$/u.test(item.token)
        && validOrigin(item.origin);
}
export function agentPrivateDirectory(value: string): string {
    const blocked = ['Documents', 'Desktop', 'Downloads', 'Library/Mobile Documents', 'Library/CloudStorage'].map(relative => path.join(os.homedir(), relative));
    if (blocked.some(root => inside(root, path.resolve(value)))) throw unavailable();
    let existing = path.resolve(value);
    const suffix: string[] = [];
    while (!fs.existsSync(existing)) { suffix.unshift(path.basename(existing)); const parent = path.dirname(existing); if (parent === existing) throw unavailable(); existing = parent; }
    const physical = path.join(fs.realpathSync(existing), ...suffix);
    const physicalBlocked = blocked.map(root => fs.existsSync(root) ? fs.realpathSync(root) : root);
    if (physicalBlocked.some(root => inside(root, physical))) throw unavailable();
    if (fs.existsSync(value) && fs.lstatSync(value).isSymbolicLink()) throw unavailable();
    fs.mkdirSync(physical, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(physical);
    if (!stat.isDirectory() || stat.isSymbolicLink() || process.platform !== 'win32'
        && (stat.uid !== process.getuid?.() || (stat.mode & 0o7777) !== 0o700)) throw unavailable();
    return physical;
}
function privateFile(stat: fs.Stats): boolean {
    return stat.isFile() && stat.nlink === 1 && (process.platform === 'win32' || stat.uid === process.getuid?.() && (stat.mode & 0o7777) === 0o600);
}
function savePrivateRecord(directory: string, filename: string, value: AgentCredential | AgentRegistrationCredential): void {
    const root = agentPrivateDirectory(directory), destination = path.join(root, filename);
    try {
        const stat = fs.lstatSync(destination);
        if (stat.isSymbolicLink() || !privateFile(stat)) throw unavailable();
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw unavailable(); }
    const temporary = path.join(root, `.credential-${randomUUID()}.tmp`);
    let owned = false;
    try {
        const descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
        owned = true;
        try { fs.writeFileSync(descriptor, JSON.stringify(value)); fs.fsyncSync(descriptor); }
        finally { fs.closeSync(descriptor); }
        fs.renameSync(temporary, destination); owned = false;
    } catch { throw unavailable(); }
    finally { if (owned) fs.unlinkSync(temporary); }
}
function readPrivateRecord(directory: string, filename: string): unknown {
    const file = path.join(agentPrivateDirectory(directory), filename);
    let descriptor: number;
    try { descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw unavailable(); }
    try {
        const stat = fs.fstatSync(descriptor);
        if (!privateFile(stat) || stat.size > 4096) throw unavailable();
        const value: unknown = JSON.parse(fs.readFileSync(descriptor, 'utf8'));
        if (!value) throw unavailable();
        return value;
    } catch { throw unavailable(); }
    finally { fs.closeSync(descriptor); }
}

export function saveAgentCredential(directory: string, value: AgentCredential): void {
    if (!credential(value)) throw unavailable();
    savePrivateRecord(directory, `${value.agentRef}.json`, value);
}
export function readAgentCredential(directory: string, agentRef: string, now = Date.now()): AgentCredential | null {
    if (!/^[a-f0-9-]{36}$/u.test(agentRef)) throw unavailable();
    const value = readPrivateRecord(directory, `${agentRef}.json`);
    if (value === null) return null;
    if (!credential(value) || value.agentRef !== agentRef) throw unavailable();
    return value.expiresAt > now ? value : null;
}
export function saveAgentRegistration(directory: string, value: AgentRegistrationCredential): void {
    if (!registration(value)) throw unavailable();
    savePrivateRecord(directory, `${value.agentRef}.registration.json`, value);
}
export function readAgentRegistration(directory: string, agentRef: string): AgentRegistrationCredential | null {
    if (!/^[a-f0-9-]{36}$/u.test(agentRef)) throw unavailable();
    const value = readPrivateRecord(directory, `${agentRef}.registration.json`);
    if (value === null) return null;
    if (!registration(value) || value.agentRef !== agentRef) throw unavailable();
    return value;
}
