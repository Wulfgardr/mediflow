/* @Codex */
import 'server-only';

/* @Codex */
import fs from 'fs';
/* @Codex */
import os from 'os';
/* @Codex */
import path from 'path';
/* @Codex */
import Database from 'better-sqlite3';
/* @Codex */
import {
    SISS_SESSION_OBSERVED_MODULE_LABELS,
    type SissSessionCheckpoint,
    type SissSessionHealth,
    type SissSessionObservedModule,
    type SissSessionStatusResponse,
} from './siss-session-shared';

type AtlasHistoryRow = {
    url: string;
    title: string;
    visitedAt: string | null;
};

type AtlasHistorySource = {
    browserProfile: string | null;
    rows: AtlasHistoryRow[];
    warning: string | null;
};

const ATLAS_HISTORY_ROOTS = [
    path.join(os.homedir(), 'Library', 'Application Support', 'com.openai.atlas', 'browser-data', 'host'),
    path.join(os.homedir(), 'Library', 'Application Support', 'com.openai.atlas.beta', 'browser-data', 'host'),
] as const;

const SISS_SESSION_RECENT_WINDOW_MS = 1000 * 60 * 60 * 8;

/* @Codex */
export function resolveSissObservedModuleFromUrl(url: string): SissSessionObservedModule | null {
    const normalized = url.trim().toLowerCase();
    if (!normalized) return null;
    if (normalized.includes('/menusiss')) return 'menu';
    if (normalized.includes('/prescrizione') || normalized.includes('/prescrittivoregionale')) return 'prescription';
    if (normalized.includes('/opefseie') || normalized.includes('/fse/')) return 'fse';
    if (normalized.includes('/gaia') || normalized.includes('/anagrafe/')) return 'registry';
    return null;
}

function resolveSissSessionHealth(observedAt: string | null, now: Date): SissSessionHealth {
    if (!observedAt) return 'none';
    const observedTime = Date.parse(observedAt);
    if (!Number.isFinite(observedTime)) return 'stale';
    return now.getTime() - observedTime <= SISS_SESSION_RECENT_WINDOW_MS ? 'recent' : 'stale';
}

function pickLatestObservation(rows: AtlasHistoryRow[], predicate: (row: AtlasHistoryRow) => boolean): string | null {
    for (const row of rows) {
        if (predicate(row) && row.visitedAt) {
            return row.visitedAt;
        }
    }

    return null;
}

/* @Codex */
export function buildSissSessionStatusFromHistory(
    rows: AtlasHistoryRow[],
    options: {
        browserProfile?: string | null;
        warning?: string | null;
        now?: Date;
    } = {},
): SissSessionStatusResponse {
    const now = options.now ?? new Date();
    const remoteSignatureAt = pickLatestObservation(
        rows,
        (row) => row.url.includes('/ssoauth/LoginRemoteSign'),
    );
    const roleSelectionAt = pickLatestObservation(
        rows,
        (row) => row.url.includes('/ssoauth/ConfirmSelectedRole'),
    );

    let lastModule: SissSessionObservedModule | null = null;
    let lastModuleAt: string | null = null;

    for (const row of rows) {
        const module = resolveSissObservedModuleFromUrl(row.url);
        if (!module || !row.visitedAt) continue;
        lastModule = module;
        lastModuleAt = row.visitedAt;
        break;
    }

    const checkpoints: SissSessionCheckpoint[] = [
        {
            key: 'remote-signature',
            label: 'Firma remota',
            health: resolveSissSessionHealth(remoteSignatureAt, now),
            observedAt: remoteSignatureAt,
        },
        {
            key: 'role-selection',
            label: 'Selezione ruolo',
            health: resolveSissSessionHealth(roleSelectionAt, now),
            observedAt: roleSelectionAt,
        },
        ...Object.entries(SISS_SESSION_OBSERVED_MODULE_LABELS).map(([module, label]) => {
            const observedAt = pickLatestObservation(
                rows,
                (row) => resolveSissObservedModuleFromUrl(row.url) === module,
            );

            return {
                key: module as SissSessionObservedModule,
                label,
                health: resolveSissSessionHealth(observedAt, now),
                observedAt,
            };
        }),
    ];

    const sessionObservedAt = lastModuleAt ?? roleSelectionAt ?? remoteSignatureAt;

    return {
        status: rows.length > 0 ? 'available' : 'unavailable',
        source: 'atlas-history',
        checkedAt: now.toISOString(),
        browserProfile: options.browserProfile ?? null,
        warning: options.warning ?? null,
        sessionHealth: resolveSissSessionHealth(sessionObservedAt, now),
        lastModule,
        lastModuleLabel: lastModule ? SISS_SESSION_OBSERVED_MODULE_LABELS[lastModule] : null,
        lastModuleAt,
        checkpoints,
    };
}

function resolveAtlasHistoryCandidates(): Array<{ profile: string; historyPath: string; updatedAtMs: number }> {
    const candidates: Array<{ profile: string; historyPath: string; updatedAtMs: number }> = [];

    for (const root of ATLAS_HISTORY_ROOTS) {
        if (!fs.existsSync(root)) continue;

        for (const profile of fs.readdirSync(root, { withFileTypes: true })) {
            if (!profile.isDirectory()) continue;

            const historyPath = path.join(root, profile.name, 'History');
            if (!fs.existsSync(historyPath)) continue;

            let updatedAtMs = 0;
            try {
                updatedAtMs = fs.statSync(historyPath).mtimeMs;
            } catch {
                updatedAtMs = 0;
            }

            candidates.push({
                profile: profile.name,
                historyPath,
                updatedAtMs,
            });
        }
    }

    return candidates.sort((left, right) => right.updatedAtMs - left.updatedAtMs);
}

function copySqliteDb(sourcePath: string): { tempDir: string; tempPath: string } {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-siss-atlas-history-'));
    const tempPath = path.join(tempDir, 'History');
    fs.copyFileSync(sourcePath, tempPath);
    return { tempDir, tempPath };
}

function chromeTimeToIso(value: number | bigint | null | undefined): string | null {
    if (value === null || value === undefined) return null;

    const numeric = typeof value === 'bigint' ? Number(value) : value;
    if (!Number.isFinite(numeric) || numeric <= 0) return null;

    const unixMs = numeric / 1000 - 11644473600000;
    const date = new Date(unixMs);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function readRelevantAtlasHistoryRows(): AtlasHistorySource {
    const candidate = resolveAtlasHistoryCandidates()[0];
    if (!candidate) {
        return {
            browserProfile: null,
            rows: [],
            warning: 'Cronologia Atlas non disponibile su questa macchina.',
        };
    }

    const { tempDir, tempPath } = copySqliteDb(candidate.historyPath);

    try {
        const sqlite = new Database(tempPath, { readonly: true });

        try {
            const rows = sqlite.prepare(`
                SELECT
                    url,
                    title,
                    last_visit_time AS lastVisitTime
                FROM urls
                WHERE
                    url LIKE '%operatorisiss.servizirl.it/%'
                    OR url LIKE '%idpcrlmain.crs.lombardia.it/ssoauth/LoginRemoteSign%'
                    OR url LIKE '%idpcrlmain.crs.lombardia.it/ssoauth/ConfirmSelectedRole%'
                ORDER BY last_visit_time DESC
                LIMIT 200
            `).all() as Array<{ url: string | null; title: string | null; lastVisitTime: number | bigint | null }>;

            return {
                browserProfile: candidate.profile,
                rows: rows.map((row) => ({
                    url: row.url ?? '',
                    title: row.title ?? '',
                    visitedAt: chromeTimeToIso(row.lastVisitTime),
                })),
                warning: null,
            };
        } finally {
            sqlite.close();
        }
    } catch (error) {
        return {
            browserProfile: candidate.profile,
            rows: [],
            warning: error instanceof Error
                ? `Impossibile leggere la cronologia Atlas: ${error.message}`
                : 'Impossibile leggere la cronologia Atlas.',
        };
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

/* @Codex */
export function readSissSessionStatusFromAtlasHistory(): SissSessionStatusResponse {
    const source = readRelevantAtlasHistoryRows();
    return buildSissSessionStatusFromHistory(source.rows, {
        browserProfile: source.browserProfile,
        warning: source.warning,
    });
}
