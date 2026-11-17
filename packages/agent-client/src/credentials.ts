import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

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
    try {
        const origin = new URL(item.origin);
        return origin.origin === item.origin && origin.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(origin.hostname);
    } catch { return false; }
}
function directoryFor(value: string): string {
    const blocked = ['Documents', 'Desktop', 'Downloads', 'Library/Mobile Documents', 'Library/CloudStorage'].map(relative => path.join(os.homedir(), relative));
    if (blocked.some(root => inside(root, path.resolve(value)))) throw unavailable();
    let existing = path.resolve(value);
    const suffix: string[] = [];
    while (!fs.existsSync(existing)) { suffix.unshift(path.basename(existing)); const parent = path.dirname(existing); if (parent === existing) throw unavailable(); existing = parent; }
    const physical = path.join(fs.realpathSync(existing), ...suffix);
    if (blocked.some(root => inside(root, physical))) throw unavailable();
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
export function saveAgentCredential(directory: string, value: AgentCredential): void {
    if (!credential(value)) throw unavailable();
    const root = directoryFor(directory), destination = path.join(root, `${value.agentRef}.json`);
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
export function readAgentCredential(directory: string, agentRef: string, now = Date.now()): AgentCredential | null {
    if (!/^[a-f0-9-]{36}$/u.test(agentRef)) throw unavailable();
    const file = path.join(directoryFor(directory), `${agentRef}.json`);
    let descriptor: number;
    try { descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw unavailable(); }
    try {
        const stat = fs.fstatSync(descriptor);
        if (!privateFile(stat) || stat.size > 4096) throw unavailable();
        const value: unknown = JSON.parse(fs.readFileSync(descriptor, 'utf8'));
        if (!credential(value) || value.agentRef !== agentRef) throw unavailable();
        return value.expiresAt > now ? value : null;
    } catch { throw unavailable(); }
    finally { fs.closeSync(descriptor); }
}
