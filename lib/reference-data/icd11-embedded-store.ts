import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { normalizeWhoText, parseWhoTabulation, WhoCatalogError, type WhoCatalogEntry, type WhoCatalogManifest } from './icd11-embedded-parser';

export type WhoCatalogStatus = Readonly<{ state: 'ready' | 'absent' | 'unverified'; enabled: boolean; revision: number;
    manifest: WhoCatalogManifest | null; previousAvailable: boolean; searchEngine: 'fts5' | 'like' }>;
type StoredGeneration = { id: string; manifest: string; original: Buffer };
export type WhoCatalogPreview = { previewId: string; expectedRevision: number; manifest: WhoCatalogManifest };

export function createWhoCatalogStore(databasePath: string) {
    const db = new Database(databasePath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
    db.pragma('busy_timeout = 5000');
    db.transaction(() => db.exec(`CREATE TABLE IF NOT EXISTS icd_catalog_generations (id TEXT PRIMARY KEY, manifest TEXT NOT NULL, original BLOB NOT NULL);
        CREATE TABLE IF NOT EXISTS icd_catalog_entries (id INTEGER PRIMARY KEY, generation TEXT NOT NULL,
            code TEXT NOT NULL, uri TEXT NOT NULL, title TEXT NOT NULL, chapter TEXT NOT NULL,
            leaf INTEGER NOT NULL, residual INTEGER NOT NULL, normalized TEXT NOT NULL, UNIQUE(generation, code));
        CREATE TABLE IF NOT EXISTS icd_catalog_state (singleton INTEGER PRIMARY KEY CHECK(singleton=1),
            active TEXT, previous TEXT, staged TEXT, revision INTEGER NOT NULL);
        INSERT OR IGNORE INTO icd_catalog_state VALUES(1, NULL, NULL, NULL, 0);
        CREATE TABLE IF NOT EXISTS icd_catalog_audit (id TEXT PRIMARY KEY, operation TEXT NOT NULL,
            revision INTEGER NOT NULL, sha256 TEXT, categories INTEGER NOT NULL, actor TEXT NOT NULL, completed_at TEXT NOT NULL);`)).immediate();
    const fts = Boolean((db.prepare('SELECT sqlite_compileoption_used(?) AS enabled').get('ENABLE_FTS5') as { enabled: number }).enabled);
    if (fts) {
        db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS icd_catalog_fts USING fts5(title, content='icd_catalog_entries', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
            CREATE TRIGGER IF NOT EXISTS icd_catalog_fts_insert AFTER INSERT ON icd_catalog_entries BEGIN
                INSERT INTO icd_catalog_fts(rowid,title) VALUES(new.id,new.title); END;
            CREATE TRIGGER IF NOT EXISTS icd_catalog_fts_delete AFTER DELETE ON icd_catalog_entries BEGIN
                INSERT INTO icd_catalog_fts(icd_catalog_fts,rowid,title) VALUES('delete',old.id,old.title); END;`);
    }
    const state = () => db.prepare('SELECT active, previous, staged, revision FROM icd_catalog_state WHERE singleton=1').get() as {
        active: string | null; previous: string | null; staged: string | null; revision: number };
    const generation = (id: string) => db.prepare('SELECT * FROM icd_catalog_generations WHERE id=?').get(id) as StoredGeneration | undefined;
    const entries = (id: string): WhoCatalogEntry[] => (db.prepare('SELECT code,uri,title,chapter,leaf,residual FROM icd_catalog_entries WHERE generation=? ORDER BY code').all(id) as (Omit<WhoCatalogEntry, 'leaf' | 'residual'> & { leaf: number; residual: number })[])
        .map(row => ({ ...row, leaf: Boolean(row.leaf), residual: Boolean(row.residual) }));
    const verified = new Map<string, WhoCatalogManifest>();
    const prune = () => {
        const retained = 'SELECT active FROM icd_catalog_state WHERE active IS NOT NULL UNION SELECT previous FROM icd_catalog_state WHERE previous IS NOT NULL UNION SELECT staged FROM icd_catalog_state WHERE staged IS NOT NULL';
        db.prepare(`DELETE FROM icd_catalog_entries WHERE generation NOT IN (${retained})`).run();
        db.prepare(`DELETE FROM icd_catalog_generations WHERE id NOT IN (${retained})`).run();
        verified.clear();
    };
    function verify(id: string): WhoCatalogManifest {
        const found = generation(id);
        if (!found) throw new WhoCatalogError('Catalogo WHO non verificato');
        const parsed = parseWhoTabulation(found.original, JSON.parse(found.manifest));
        const ordered = [...parsed.entries].sort((a, b) => a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
        if (JSON.stringify(entries(id)) !== JSON.stringify(ordered)) throw new WhoCatalogError('Indice WHO non corrispondente al file originale');
        if (fts) db.prepare("INSERT INTO icd_catalog_fts(icd_catalog_fts,rank) VALUES('integrity-check',1)").run();
        verified.set(id, parsed.manifest);
        return parsed.manifest;
    }
    function status(): WhoCatalogStatus {
        const current = state();
        let manifest: WhoCatalogManifest | null = null;
        let validity: WhoCatalogStatus['state'] = current.active ? 'unverified' : 'absent';
        if (current.active) {
            try { manifest = verified.get(current.active) ?? verify(current.active); validity = 'ready'; }
            catch { verified.delete(current.active); }
        }
        return { state: validity, enabled: true, revision: current.revision, manifest,
            previousAvailable: current.previous !== null, searchEngine: fts ? 'fts5' : 'like' };
    }
    const guardRevision = (revision: number) => {
        if (!Number.isSafeInteger(revision) || state().revision !== revision) throw new WhoCatalogError('Il catalogo WHO è cambiato. Rileggi lo stato prima di continuare.', 409);
    };
    const audit = (operation: string, manifest: WhoCatalogManifest, revision: number, actor: string) => {
        db.prepare('INSERT INTO icd_catalog_audit VALUES(?,?,?,?,?,?,?)').run(randomUUID(), operation, revision,
            manifest.sha256, manifest.categories, actor, new Date().toISOString());
    };
    function stage(original: Uint8Array, expectedRevision: number, assertCurrent: () => void, actor: string, expectedManifest?: unknown): WhoCatalogPreview {
        const parsed = parseWhoTabulation(original, expectedManifest), id = randomUUID();
        assertCurrent();
        db.transaction(() => {
            guardRevision(expectedRevision); assertCurrent();
            const current = state();
            db.prepare('INSERT INTO icd_catalog_generations VALUES(?,?,?)').run(id, JSON.stringify(parsed.manifest), original);
            const insert = db.prepare('INSERT INTO icd_catalog_entries(generation,code,uri,title,chapter,leaf,residual,normalized) VALUES(?,?,?,?,?,?,?,?)');
            for (const row of parsed.entries) insert.run(id, row.code, row.uri, row.title, row.chapter, +row.leaf, +row.residual, normalizeWhoText(row.title));
            if (current.staged && current.staged !== current.active && current.staged !== current.previous) {
                db.prepare('DELETE FROM icd_catalog_entries WHERE generation=?').run(current.staged);
                db.prepare('DELETE FROM icd_catalog_generations WHERE id=?').run(current.staged);
                verified.delete(current.staged);
            }
            db.prepare('UPDATE icd_catalog_state SET staged=? WHERE singleton=1').run(id);
            audit('preview', parsed.manifest, current.revision, actor); prune(); assertCurrent();
        }).immediate();
        return { previewId: id, expectedRevision, manifest: parsed.manifest };
    }
    function activate(previewId: string, expectedRevision: number, assertCurrent: () => void, actor: string): WhoCatalogStatus {
        db.transaction(() => {
            guardRevision(expectedRevision); assertCurrent();
            const current = state();
            if (current.staged !== previewId) throw new WhoCatalogError('Anteprima WHO scaduta. Scarica di nuovo il catalogo.', 409);
            const manifest = verify(previewId);
            db.prepare('UPDATE icd_catalog_state SET active=?,previous=active,staged=NULL,revision=revision+1 WHERE singleton=1').run(previewId);
            audit('activate', manifest, current.revision + 1, actor);
            prune();
            assertCurrent();
        }).immediate();
        return status();
    }
    function rollback(expectedRevision: number, assertCurrent: () => void, actor: string): WhoCatalogStatus {
        db.transaction(() => {
            guardRevision(expectedRevision); assertCurrent();
            const current = state();
            if (!current.previous) throw new WhoCatalogError('Nessun catalogo WHO precedente disponibile', 409);
            const manifest = verify(current.previous);
            db.prepare('UPDATE icd_catalog_state SET active=previous,previous=active,staged=NULL,revision=revision+1 WHERE singleton=1').run();
            audit('rollback', manifest, current.revision + 1, actor); prune(); assertCurrent();
        }).immediate();
        return status();
    }
    function requireActive() {
        const s = status(), id = state().active;
        if (s.state !== 'ready' || !id || !s.manifest) throw new WhoCatalogError('Catalogo WHO assente o non verificato', 503);
        return { id, manifest: s.manifest };
    }
    function findCode(code: string): WhoCatalogEntry | null {
        const active = requireActive();
        const raw = db.prepare('SELECT code,uri,title,chapter,leaf,residual FROM icd_catalog_entries WHERE generation=? AND code=?').get(active.id, code) as (Omit<WhoCatalogEntry, 'leaf' | 'residual'> & { leaf: number; residual: number }) | undefined;
        return raw ? { ...raw, leaf: Boolean(raw.leaf), residual: Boolean(raw.residual) } : null;
    }
    function search(query: string): { entries: WhoCatalogEntry[]; partial: boolean; manifest: WhoCatalogManifest } {
        const active = requireActive(), normalized = normalizeWhoText(query);
        if (!query.trim() || Buffer.byteLength(query) > 160 || /[\u0000-\u001f\u007f<>\u202a-\u202e\u2066-\u2069]/u.test(query)) throw new WhoCatalogError('Ricerca WHO non valida', 400);
        const exact = findCode(query.trim().toUpperCase());
        let found: WhoCatalogEntry[] = [];
        if (normalized) {
            const rows = fts
                ? db.prepare('SELECT e.code,e.uri,e.title,e.chapter,e.leaf,e.residual FROM icd_catalog_fts JOIN icd_catalog_entries e ON e.id=icd_catalog_fts.rowid WHERE icd_catalog_fts MATCH ? AND e.generation=? ORDER BY rank,e.code LIMIT 26')
                    .all(normalized.split(' ').filter(Boolean).map(token => `"${token}"*`).join(' AND '), active.id)
                : db.prepare("SELECT code,uri,title,chapter,leaf,residual FROM icd_catalog_entries WHERE generation=? AND normalized LIKE ? ESCAPE '\\' ORDER BY code LIMIT 26")
                    .all(active.id, `%${normalized.replace(/[\\%_]/gu, '\\$&').replace(/ /gu, '%')}%`);
            found = (rows as (Omit<WhoCatalogEntry, 'leaf' | 'residual'> & { leaf: number; residual: number })[]).map(row => ({ ...row, leaf: Boolean(row.leaf), residual: Boolean(row.residual) }));
        }
        const combined = exact ? [exact, ...found.filter(row => row.code !== exact.code)] : found;
        return { entries: combined.slice(0, 25), partial: combined.length > 25, manifest: active.manifest };
    }
    function recordAcquisitionFailure(actor: string): void {
        db.transaction(() => db.prepare('INSERT INTO icd_catalog_audit VALUES(?,?,?,?,?,?,?)').run(randomUUID(),
            'acquisition_failed', state().revision, null, 0, actor, new Date().toISOString())).immediate();
    }
    return { status, stage, activate, rollback, search, findCode, recordAcquisitionFailure, close: () => db.close() };
}
export type WhoCatalogStore = ReturnType<typeof createWhoCatalogStore>;
