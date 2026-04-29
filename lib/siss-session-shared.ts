/* @Codex */
export const SISS_SESSION_HEALTH_STATES = ['recent', 'stale', 'none'] as const;
/* @Codex */
export type SissSessionHealth = (typeof SISS_SESSION_HEALTH_STATES)[number];

/* @Codex */
export const SISS_SESSION_OBSERVED_MODULES = ['menu', 'prescription', 'prosthetics', 'fse', 'registry'] as const;
/* @Codex */
export type SissSessionObservedModule = (typeof SISS_SESSION_OBSERVED_MODULES)[number];

/* @Codex */
export const SISS_SESSION_OBSERVED_MODULE_LABELS: Record<SissSessionObservedModule, string> = {
    menu: 'Menu SISS',
    prescription: 'Modulo prescrittivo',
    prosthetics: 'Protesica-RL',
    fse: 'FSE OpeFseIE',
    registry: 'Anagrafe Gaia',
};

/* @Codex */
export const SISS_SESSION_CHECKPOINT_KEYS = [
    'remote-signature',
    'role-selection',
    ...SISS_SESSION_OBSERVED_MODULES,
] as const;
/* @Codex */
export type SissSessionCheckpointKey = (typeof SISS_SESSION_CHECKPOINT_KEYS)[number];

/* @Codex */
export type SissSessionCheckpoint = {
    key: SissSessionCheckpointKey;
    label: string;
    health: SissSessionHealth;
    observedAt: string | null;
};

/* @Codex */
export type SissSessionStatusResponse = {
    status: 'available' | 'unavailable';
    source: 'atlas-history';
    checkedAt: string;
    browserProfile: string | null;
    warning: string | null;
    sessionHealth: SissSessionHealth;
    lastModule: SissSessionObservedModule | null;
    lastModuleLabel: string | null;
    lastModuleAt: string | null;
    checkpoints: SissSessionCheckpoint[];
};
