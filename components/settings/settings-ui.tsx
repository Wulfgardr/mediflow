import Link from 'next/link';

/* @Codex WUL-229 — settings primitives now defer to the liquid-glass tier classes from globals.css */
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
        // @Codex WUL-229 — section intro now uses MediFlow ink/muted tokens for headings
        <div className="space-y-1">
            <p className="section-kicker">{kicker}</p>
            <h2 className="text-2xl font-semibold tracking-tight" style={{ color: 'var(--mf-ink)' }}>{title}</h2>
            <p className="max-w-3xl text-sm leading-6" style={{ color: 'var(--mf-muted)' }}>{description}</p>
        </div>
    );
}

// WUL-297 — transitional placeholder while sections migrate from the monolithic settings page.
export function SettingsMigrationPlaceholder({
    kicker,
    title,
    legacyHref,
    legacyLabel,
}: {
    kicker: string;
    title: string;
    legacyHref: string;
    legacyLabel: string;
}) {
    return (
        <section className="space-y-4">
            <SettingsSectionIntro
                kicker={kicker}
                title={title}
                description="Questa sezione è in migrazione verso la nuova struttura delle impostazioni."
            />
            <div className={SETTINGS_CARD_CLASS}>
                <p className="text-sm" style={{ color: 'var(--mf-muted)' }}>
                    Nel frattempo la funzione resta disponibile nella pagina Impostazioni completa.
                </p>
                <Link href={legacyHref} className={`${SETTINGS_SECONDARY_BUTTON_CLASS} mt-4 inline-flex`}>
                    {legacyLabel}
                </Link>
            </div>
        </section>
    );
}
