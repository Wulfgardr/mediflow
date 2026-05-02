/* @Codex */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type UpdateSource = 'runtime-env' | 'local-manifest' | 'none';

export type UpdateManifest = {
    version?: string;
    url?: string;
    channel?: string;
    notes?: string[] | string;
};

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

export function compareReleaseVersions(left?: string | null, right?: string | null) {
    const leftParts = left?.trim().match(SEMVER_RE)?.slice(1, 4).map(Number);
    const rightParts = right?.trim().match(SEMVER_RE)?.slice(1, 4).map(Number);
    if (!leftParts || !rightParts) return 0;

    for (let index = 0; index < 3; index += 1) {
        if (leftParts[index] !== rightParts[index]) return leftParts[index] > rightParts[index] ? 1 : -1;
    }
    return 0;
}

function normalizeNotes(value: UpdateManifest['notes']) {
    const notes = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\r?\n/) : [];
    return notes.map((item) => String(item).replace(/^[-*]\s*/, '').trim()).filter(Boolean).slice(0, 6);
}

export function parseLatestChangelog(markdown: string) {
    const lines = markdown.split(/\r?\n/);
    const start = lines.findIndex((line) => /^##\s+\[/.test(line));
    if (start === -1) return { title: null as string | null, notes: [] as string[] };

    const notes: string[] = [];
    for (const line of lines.slice(start + 1)) {
        if (/^##\s+\[/.test(line)) break;
        const bullet = line.match(/^-\s+(.+)/)?.[1]?.trim();
        if (bullet) notes.push(bullet);
        if (notes.length >= 6) break;
    }
    return { title: lines[start].replace(/^##\s+/, '').trim(), notes };
}

function readPackageVersion(cwd: string) {
    try {
        return (JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as { version?: string }).version || '0.0.0';
    } catch {
        return process.env.npm_package_version || '0.0.0';
    }
}

function readLocalManifest(cwd: string): UpdateManifest | null {
    const manifestPath = process.env.MEDIFLOW_UPDATE_MANIFEST_PATH;
    if (!manifestPath) return null;

    try {
        const resolvedPath = manifestPath.startsWith('/') ? manifestPath : join(cwd, manifestPath);
        return JSON.parse(readFileSync(resolvedPath, 'utf8')) as UpdateManifest;
    } catch {
        return null;
    }
}

export function buildUpdateAwarenessPayload(options: {
    currentVersion: string;
    manifest?: UpdateManifest | null;
    fallbackNotes?: string[];
    fallbackChangelogTitle?: string | null;
    checkedAt?: Date;
}) {
    const manifestVersion = options.manifest?.version?.trim();
    const envVersion = process.env.MEDIFLOW_AVAILABLE_VERSION?.trim();
    const availableVersion = manifestVersion || envVersion || null;
    const source: UpdateSource = manifestVersion ? 'local-manifest' : envVersion ? 'runtime-env' : 'none';
    const notes = normalizeNotes(options.manifest?.notes || process.env.MEDIFLOW_UPDATE_NOTES);

    return {
        currentVersion: options.currentVersion,
        availableVersion,
        updateAvailable: compareReleaseVersions(availableVersion, options.currentVersion) > 0,
        source,
        channel: options.manifest?.channel || process.env.MEDIFLOW_UPDATE_CHANNEL || 'local',
        updateUrl: options.manifest?.url || process.env.MEDIFLOW_UPDATE_URL || null,
        notes: notes.length ? notes : (options.fallbackNotes ?? []),
        changelogTitle: options.fallbackChangelogTitle ?? null,
        checkedAt: (options.checkedAt ?? new Date()).toISOString(),
    };
}

export function readUpdateAwarenessPayload(cwd = process.cwd()) {
    let changelog = { title: null as string | null, notes: [] as string[] };
    try {
        changelog = parseLatestChangelog(readFileSync(join(cwd, 'CHANGELOG.md'), 'utf8'));
    } catch {
        // Keep the route available in packaged builds that do not ship the changelog.
    }

    return buildUpdateAwarenessPayload({
        currentVersion: readPackageVersion(cwd),
        manifest: readLocalManifest(cwd),
        fallbackNotes: changelog.notes,
        fallbackChangelogTitle: changelog.title,
    });
}
