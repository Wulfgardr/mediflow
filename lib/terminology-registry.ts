import 'server-only';

import { eq } from 'drizzle-orm';
import {
    listTerminologySystems,
    normalizeTerminologySystem,
    type TerminologyItem,
    type TerminologySystemCode,
} from './terminology';

/* @Codex */
export const TERMINOLOGY_REGISTRY_KEY = 'terminologyRegistry';

export type TerminologyRegistryEntry = {
    system: TerminologySystemCode;
    display: string;
    version: string | null;
    source: string;
    status: 'active' | 'planned';
    updatedAt: string | null;
    notes?: string;
};

const DEFAULT_VERSIONS: Partial<Record<TerminologySystemCode, string>> = {
    LOINC: '2.78',
    UCUM: '2.1',
};

const DEFAULT_REGISTRY: TerminologyRegistryEntry[] = listTerminologySystems().map((system) => ({
    system: system.code,
    display: system.display,
    version: DEFAULT_VERSIONS[system.code] ?? null,
    source: system.source,
    status: system.status,
    updatedAt: null,
    ...(system.notes ? { notes: system.notes } : {}),
}));

function cloneRegistryEntry(entry: TerminologyRegistryEntry): TerminologyRegistryEntry {
    return { ...entry };
}

function asText(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function asDate(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function sanitizeRegistryEntry(
    value: unknown,
    fallback: TerminologyRegistryEntry,
): TerminologyRegistryEntry {
    const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    return {
        system: fallback.system,
        display: asText(record.display) ?? fallback.display,
        version: asText(record.version) ?? fallback.version,
        source: asText(record.source) ?? fallback.source,
        status: record.status === 'planned' ? 'planned' : fallback.status,
        updatedAt: asDate(record.updatedAt) ?? fallback.updatedAt,
        ...(asText(record.notes) ?? fallback.notes ? { notes: asText(record.notes) ?? fallback.notes } : {}),
    };
}

function parseRegistryValue(value: unknown): unknown {
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch {
        return [];
    }
}

/* @Codex */
export function listDefaultTerminologyRegistry(): TerminologyRegistryEntry[] {
    return DEFAULT_REGISTRY.map(cloneRegistryEntry);
}

/* @Codex */
export function mergeTerminologyRegistryEntries(value: unknown): TerminologyRegistryEntry[] {
    const items = Array.isArray(parseRegistryValue(value)) ? parseRegistryValue(value) as unknown[] : [];
    const overrides = new Map<TerminologySystemCode, unknown>();

    for (const item of items) {
        const record = item && typeof item === 'object' ? item as Record<string, unknown> : null;
        const system = normalizeTerminologySystem(record?.system);
        if (system) overrides.set(system, item);
    }

    return DEFAULT_REGISTRY.map((fallback) => sanitizeRegistryEntry(overrides.get(fallback.system), fallback));
}

/* @Codex */
export function findTerminologyRegistryEntry(
    registry: TerminologyRegistryEntry[],
    system: TerminologySystemCode,
): TerminologyRegistryEntry | null {
    return registry.find((entry) => entry.system === system) ?? null;
}

/* @Codex */
export function applyTerminologyRegistryVersion(
    item: TerminologyItem,
    entry: TerminologyRegistryEntry | null,
): TerminologyItem {
    return {
        ...item,
        version: entry?.version ?? item.version ?? null,
    };
}

/* @Codex */
export function upsertTerminologyRegistryEntry(
    current: TerminologyRegistryEntry[],
    value: unknown,
    now = new Date().toISOString(),
): TerminologyRegistryEntry[] {
    const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const system = normalizeTerminologySystem(record.system);
    if (!system) {
        throw new Error('Invalid terminology system');
    }

    return current.map((entry) => {
        if (entry.system !== system) return entry;

        const next = sanitizeRegistryEntry(record, entry);
        const changed = (
            next.display !== entry.display
            || next.version !== entry.version
            || next.source !== entry.source
            || next.status !== entry.status
            || next.notes !== entry.notes
        );

        return {
            ...next,
            updatedAt: changed ? now : entry.updatedAt,
        };
    });
}

/* @Codex */
export async function loadTerminologyRegistry(): Promise<TerminologyRegistryEntry[]> {
    const [{ dbServer }, { settings }] = await Promise.all([
        import('./db-server'),
        import('./schema'),
    ]);
    const row = await dbServer.select().from(settings).where(eq(settings.key, TERMINOLOGY_REGISTRY_KEY)).get();
    return mergeTerminologyRegistryEntries(row?.value);
}
