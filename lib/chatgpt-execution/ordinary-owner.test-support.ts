/* @Codex */
/* SYNTHETIC TEST DOUBLE ONLY. NOT the external owner, admission or production API.
 * Exercises negative and critical-section contracts; cannot prove real owner parity. */
import { types } from 'node:util';
export function syntheticOwner() {
    type Cell = { live: boolean; ports: Set<object>; generation: object };
    type Port = { cell: Cell; callbacks: Map<object, () => void>; live: boolean };
    const sessions = new WeakMap<object, Cell>(), ports = new WeakMap<object, Port>();
    const uses = new WeakMap<object, { port: Port; live: boolean }>();
    let critical = false, poisoned = false;
    const stats = { mints: 0, releases: 0, reentries: 0, commits: 0, failCommit: false, failRegister: false, throwBinding: false };
    const enter = () => { if (critical) { poisoned = true; stats.reentries++; return false; } return true; };
    const port = (raw: unknown) => raw && typeof raw === 'object' && !types.isProxy(raw) ? ports.get(raw) : undefined;
    const readUse = (raw: unknown) => raw && typeof raw === 'object' ? uses.get(raw) : undefined;
    const valid = (p: Port | undefined): p is Port => !!p && p.live && p.cell.live;
    function issue(expiresAt = Date.now() + 300_000) {
        const session = Object.freeze({ id: 'synthetic-session', userId: 'synthetic-user', expiresAt });
        sessions.set(session, { live: true, ports: new Set(), generation: Object.freeze({}) }); return session;
    }
    function retire(session: object) {
        const cell = sessions.get(session); if (!cell) return;
        cell.live = false; critical = true;
        try { for (const raw of cell.ports) { const p = ports.get(raw)!; for (const callback of [...p.callbacks.values()]) callback(); } }
        finally { critical = false; }
    }
    const api = {
        mintResourcePort(raw: unknown) {
            if (!enter() || !raw || typeof raw !== 'object' || types.isProxy(raw)) return null;
            const cell = sessions.get(raw); if (!cell?.live) return null;
            const token = Object.freeze({}); ports.set(token, { cell, live: true, callbacks: new Map() }); cell.ports.add(token); stats.mints++; return token;
        },
        releaseResourcePort(raw: unknown) {
            if (!enter()) return false; const p = port(raw); if (!p) return false;
            p.live = false; p.cell.ports.delete(raw as object); p.callbacks.clear(); ports.delete(raw as object); stats.releases++; return true;
        },
        beginResourceUse(raw: unknown) {
            if (!enter()) return null; const p = port(raw); if (!valid(p)) return null;
            const token = Object.freeze({}); uses.set(token, { port: p, live: true }); return token;
        },
        abortResourceUse(raw: unknown) { if (!enter()) return false; const u = readUse(raw); if (!u) return false; u.live = false; uses.delete(raw as object); return true; },
        commitResourceUse(raw: unknown) {
            if (!enter()) return false; const u = readUse(raw); if (!u || !u.live || !valid(u.port)) return false;
            u.live = false; uses.delete(raw as object); if (stats.failCommit) return false; stats.commits++; return true;
        },
        withCurrentResourceBinding(raw: unknown, operation: (binding: { authenticationGeneration: object }) => unknown) {
            if (!enter()) return false; const u = readUse(raw); if (!u || !u.live || !valid(u.port)) return false;
            critical = true; poisoned = false; let result;
            try { result = operation({ authenticationGeneration: u.port.cell.generation }); } finally { critical = false; }
            if (stats.throwBinding) throw new Error('synthetic binding failure after callback');
            return result === undefined && !poisoned && u.live && valid(u.port);
        },
        registerPrivateResource(raw: unknown, callback: () => void) {
            if (!enter()) return null; const p = port(raw); if (!valid(p) || stats.failRegister) return null;
            const token = Object.freeze({}); p.callbacks.set(token, callback); return token;
        },
        unregisterPrivateResource(raw: unknown, token: object) { if (!enter()) return false; return port(raw)?.callbacks.delete(token) ?? false; },
    };
    return { api, stats, issue, retire };
}
