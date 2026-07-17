import styles from './settings-lume.module.css';

/* @Codex LUME-110/68 */
export const SETTINGS_CARD_CLASS = `${styles.settingSurface} p-6 md:p-7`;
export const SETTINGS_SECTION_CARD_CLASS = `${styles.settingLayer} p-5 md:p-6`;
export const SETTINGS_INPUT_CLASS = styles.settingInput;
export const SETTINGS_LABEL_CLASS = styles.settingLabel;
export const SETTINGS_PRIMARY_BUTTON_CLASS = `${styles.primaryAction} lume-press disabled:opacity-50`;
export const SETTINGS_SECONDARY_BUTTON_CLASS = styles.secondaryAction;

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
        <div className={styles.sectionIntro}>
            <p className={styles.sectionLabel}>{kicker}</p>
            <h2>{title}</h2>
            <p>{description}</p>
        </div>
    );
}
