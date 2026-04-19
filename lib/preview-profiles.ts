/* @Codex */
export const PREVIEW_PROFILE_SETTING_KEY = 'devPreviewProfile';
/* @Codex */
export const PREVIEW_PROFILES_ENABLED = process.env.NODE_ENV !== 'production';

/* @Codex */
export type PreviewProfileId =
    | 'base'
    | 'liquid-glass-ui'
    | 'ai-stack-preview'
    | 'smart-import-review-v2'
    | 'siss-context-preview';

/* @Codex */
export type PreviewProfileKind = 'base' | 'liquid_glass' | 'ai_stack' | 'smart_import' | 'siss_context';

/* @Codex */
export type PreviewProfileFlag =
    | 'liquid-shell'
    | 'frosted-sidebar'
    | 'ai-preview'
    | 'smart-import-review'
    | 'siss-context-preview';

/* @Codex */
export interface PreviewProfile {
    id: PreviewProfileId;
    label: string;
    description: string;
    kind: PreviewProfileKind;
    featureFlags: readonly PreviewProfileFlag[];
    sourceBranch: string;
    sourceCommit?: string;
    notes?: string;
    targetUrl?: string;
}

/* @Codex */
export const PREVIEW_PROFILE_FLAG_LABELS: Record<PreviewProfileFlag, string> = {
    'liquid-shell': 'Shell Liquid Glass',
    'frosted-sidebar': 'Sidebar accentata',
    'ai-preview': 'Badge AI preview',
    'smart-import-review': 'Review import esplicita',
    'siss-context-preview': 'Contesto paziente SISS',
};

/* @Codex */
export const PREVIEW_PROFILES: readonly PreviewProfile[] = [
    {
        id: 'base',
        label: 'Base',
        description: 'Esperienza standard del checkout corrente, senza stack sperimentali attivi.',
        kind: 'base',
        featureFlags: [],
        sourceBranch: 'main / base',
        notes: 'Nessun toggle aggiuntivo: la UI resta sul profilo stabile locale.',
    },
    {
        id: 'liquid-glass-ui',
        label: 'Liquid Glass UI',
        description: 'Shell piu liquida e separazione piu netta tra chrome e contenuto clinico.',
        kind: 'liquid_glass',
        featureFlags: ['liquid-shell', 'frosted-sidebar'],
        sourceBranch: 'WUL-130 / current checkout',
        notes: 'Pensato per testare la nuova direzione visiva senza cambiare branch o worktree.',
    },
    {
        id: 'ai-stack-preview',
        label: 'AI Stack Preview',
        description: 'Profilo dedicato ai workstream AI, insight e diagnostica locale.',
        kind: 'ai_stack',
        featureFlags: ['liquid-shell', 'ai-preview'],
        sourceBranch: 'WUL-123 / AI stack',
        notes: 'Prima slice compatibile con toggle runtime sul checkout corrente.',
    },
    {
        id: 'smart-import-review-v2',
        label: 'Smart Import Review v2',
        description: 'Preview per verificare percorsi review-first nell’import operatore.',
        kind: 'smart_import',
        featureFlags: ['smart-import-review'],
        sourceBranch: 'WUL-124 / Smart Import',
        notes: 'Estendibile in futuro a preview locali su porte dedicate tramite targetUrl.',
    },
    {
        id: 'siss-context-preview',
        label: 'SISS Context Preview',
        description: 'Preview del pannello contestuale SISS/FSE sul paziente, con readiness locale ed handoff assistito.',
        kind: 'siss_context',
        featureFlags: ['siss-context-preview'],
        sourceBranch: 'WUL-178 / patient-context SISS',
        sourceCommit: '532dc7f5',
        notes: 'Attiva il nuovo pannello contestuale senza sostituire in modo permanente il flusso stabile del checkout.',
    },
];

/* @Codex */
const PREVIEW_PROFILES_BY_ID = new Map(
    PREVIEW_PROFILES.map((profile) => [profile.id, profile] as const)
);

/* @Codex */
export function previewProfileIdFromSetting(value?: string | null): PreviewProfileId {
    const normalized = value?.trim() as PreviewProfileId | undefined;
    if (!normalized || !PREVIEW_PROFILES_BY_ID.has(normalized)) return 'base';
    return normalized;
}

/* @Codex */
export function getPreviewProfileById(profileId?: string | null): PreviewProfile {
    return PREVIEW_PROFILES_BY_ID.get(previewProfileIdFromSetting(profileId)) ?? PREVIEW_PROFILES[0];
}
