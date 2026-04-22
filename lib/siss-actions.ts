/* @Codex */
export const SISS_ACTIONS = ['menu.open', 'prescription.create', 'fse.lookup', 'registry.lookup'] as const;

/* @Codex */
export type SissAction = (typeof SISS_ACTIONS)[number];
