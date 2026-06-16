/* @Codex WUL-229: settings primitives now defer to the liquid-glass tier classes from globals.css */
export const SETTINGS_CARD_CLASS = 'mf-section p-6 md:p-7';
export const SETTINGS_SECTION_CARD_CLASS = 'mf-section mf-section-tight p-5 md:p-6';
export const SETTINGS_INPUT_CLASS = 'mf-input';
export const SETTINGS_LABEL_CLASS = 'mf-field-label';
export const SETTINGS_PRIMARY_BUTTON_CLASS = 'ui-btn-primary px-5 py-2.5 disabled:opacity-50';
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
        // @Codex WUL-229: section intro now uses MediFlow ink/muted tokens for headings
        <div className="space-y-1">
            <p className="section-kicker">{kicker}</p>
            <h2 className="text-2xl font-semibold tracking-tight" style={{ color: 'var(--mf-ink)' }}>{title}</h2>
            <p className="max-w-3xl text-sm leading-6" style={{ color: 'var(--mf-muted)' }}>{description}</p>
        </div>
    );
}
