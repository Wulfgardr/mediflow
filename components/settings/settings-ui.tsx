/* @Codex Lume B3: opacità e gerarchia del modello focale per le impostazioni. */
export const SETTINGS_CARD_CLASS = 'mf-section lume-focal p-6 md:p-7';
export const SETTINGS_SECTION_CARD_CLASS = 'mf-section mf-section-tight p-5 md:p-6';
export const SETTINGS_INPUT_CLASS = 'mf-input';
export const SETTINGS_LABEL_CLASS = 'mf-field-label';
export const SETTINGS_PRIMARY_BUTTON_CLASS = 'ui-btn-primary lume-press px-5 py-2.5 disabled:opacity-50';
export const SETTINGS_SECONDARY_BUTTON_CLASS = 'mf-btn-secondary';

/* @Codex */
export function SettingsSectionIntro({
    kicker,
    title,
    description,
}: {
    kicker: string;
    title: string;
    description: string;
}) {
    return (
        <div className="space-y-1">
            <p className="section-kicker">{kicker}</p>
            <h2 className="text-2xl font-semibold tracking-tight" style={{ color: 'var(--lume-ink)' }}>{title}</h2>
            <p className="max-w-3xl text-sm leading-6" style={{ color: 'var(--lume-ink-muted)' }}>{description}</p>
        </div>
    );
}
