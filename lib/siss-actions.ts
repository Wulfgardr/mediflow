/* @Codex */
export const SISS_ACTIONS = ['menu.open', 'prescription.create', 'prosthetics.open', 'fse.lookup', 'registry.lookup'] as const;

/* @Codex */
export type SissAction = (typeof SISS_ACTIONS)[number];
