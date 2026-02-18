/* @Codex */
export type TherapyStatus = 'active' | 'suspended' | 'completed';
/* @Codex */
export type CheckupStatus = 'pending' | 'completed' | 'cancelled';

/* @Codex */
const THERAPY_STATUS_MAP: Record<string, TherapyStatus> = {
    active: 'active',
    suspended: 'suspended',
    paused: 'suspended',
    completed: 'completed',
    stopped: 'completed',
    interrupted: 'completed',
};

/* @Codex */
const CHECKUP_STATUS_MAP: Record<string, CheckupStatus> = {
    pending: 'pending',
    completed: 'completed',
    done: 'completed',
    cancelled: 'cancelled',
    canceled: 'cancelled',
};

function clean(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim().toLowerCase();
    return trimmed.length > 0 ? trimmed : null;
}

/* @Codex */
export function parseTherapyStatus(value: unknown): TherapyStatus | null {
    const key = clean(value);
    if (!key) return null;
    return THERAPY_STATUS_MAP[key] ?? null;
}

/* @Codex */
export function parseCheckupStatus(value: unknown): CheckupStatus | null {
    const key = clean(value);
    if (!key) return null;
    return CHECKUP_STATUS_MAP[key] ?? null;
}

/* @Codex */
export function normalizeTherapyStatus(value: unknown, fallback: TherapyStatus = 'active'): TherapyStatus {
    return parseTherapyStatus(value) ?? fallback;
}

/* @Codex */
export function normalizeCheckupStatus(value: unknown, fallback: CheckupStatus = 'pending'): CheckupStatus {
    return parseCheckupStatus(value) ?? fallback;
}

/* @Codex */
export function therapyStatusFilterValues(value: string): string[] {
    const normalized = parseTherapyStatus(value);
    if (!normalized) return [value.trim()];

    switch (normalized) {
        case 'active':
            return ['active'];
        case 'suspended':
            return ['suspended', 'paused'];
        case 'completed':
            return ['completed', 'stopped', 'interrupted'];
        default:
            return [value.trim()];
    }
}

/* @Codex */
export function checkupStatusFilterValues(value: string): string[] {
    const normalized = parseCheckupStatus(value);
    if (!normalized) return [value.trim()];

    switch (normalized) {
        case 'pending':
            return ['pending'];
        case 'completed':
            return ['completed', 'done'];
        case 'cancelled':
            return ['cancelled', 'canceled'];
        default:
            return [value.trim()];
    }
}
