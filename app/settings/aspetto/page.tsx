'use client';

// WUL-297 Aspetto: moved from the monolithic settings page.

/* @Codex */
import { useRuntimeTwinDesign } from '@/components/runtime-twin-design';
import { ThemeToggle } from '@/components/theme-toggle';
import { useUIAccessibility } from '@/components/ui-accessibility-provider';
import { usePrivacy } from '@/components/privacy-provider';
import { SettingsSectionIntro } from '@/components/settings/settings-ui';
import styles from '@/components/settings/settings-lume.module.css';

export default function SettingsAppearancePage() {
    const {
        reduceMotion,
        setReduceMotion,
    } = useUIAccessibility();
    const { isPrivacyMode, togglePrivacyMode } = usePrivacy();
    /* @Codex */
    const { enabled, proposal, composition, setComposition, setProposal } = useRuntimeTwinDesign();

    return (
        <section data-testid="settings-appearance-section">
            <SettingsSectionIntro kicker="Postazione" title="Aspetto" description="Tema, movimento e accessibilità per una lettura adatta al lavoro clinico." />
            {enabled && <fieldset className={styles.settingsRows} data-testid="settings-navigation-layout">
                <legend>Navigazione</legend>
                {([
                    { value: 'stream', title: 'Barra superiore', detail: 'Diario come ingresso della cartella' },
                    { value: 'workbench', title: 'Barra laterale', detail: 'Riepilogo come ingresso della cartella' },
                ] as const).map(({value, title, detail}) => <label key={value} className={styles.settingRow}>
                    <span><strong>{title}</strong><span>{detail}</span></span>
                    <input type="radio" name="navigation-layout" value={value} aria-label={title}
                        checked={proposal && composition === value}
                        onChange={() => { setComposition(value); setProposal(true); }} />
                </label>)}
            </fieldset>}
            <div className={styles.settingsRows} data-testid="ui-accessibility-controls">
                <h3>Tema e movimento</h3>
                <div className={styles.settingRow}>
                    <span><strong>Tema interfaccia</strong><span>Giorno, Grafite o il tema del sistema.</span></span><ThemeToggle />
                </div>
                <button type="button" onClick={() => setReduceMotion(!reduceMotion)} aria-pressed={reduceMotion} className={styles.settingRow}>
                    <span><strong>Riduci movimento</strong><span>Riduce le transizioni durante il lavoro.</span></span>
                    <span>{reduceMotion ? 'Attivo' : 'Disattivo'}</span>
                </button>
                <button type="button" onClick={togglePrivacyMode} aria-pressed={isPrivacyMode} data-testid="settings-privacy-mode-pointer" className={styles.settingRow}>
                    <span><strong>Privacy Mode</strong><span>Offusca i dati identificativi. Disponibile anche nell’intestazione.</span></span>
                    <span>{isPrivacyMode ? 'Attiva' : 'Spenta'}</span>
                </button>
            </div>
            <p className={styles.supportingCopy} data-testid="ui-style-runtime-notice">Schede, strumenti e impostazioni usano lo stesso spazio operativo.</p>
        </section>
    );
}
